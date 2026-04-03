import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a new tenant (church). Service-role operation — intentionally bypasses RLS.
   * Only callable from the SuperAdmin-guarded endpoint.
   *
   * Runs as a single atomic transaction:
   *   1. Insert the tenant row.
   *   2. Insert the creating user as 'admin' in tenant_memberships.
   *   3. Set the creator's last_accessed_tenant_id to the new tenant.
   *      (This fires handle_tenant_context_switch, syncing the JWT claim.)
   *
   * After this call, the super admin must call POST /auth/refresh to receive
   * a JWT with the new current_tenant_id.
   */
  async create(dto: CreateTenantDto, creatingUser: SupabaseJwtPayload): Promise<Tenant> {
    return this.dataSource.transaction(async manager => {
      const tenant = manager.create(Tenant, { name: dto.name });
      const savedTenant = await manager.save(Tenant, tenant);

      const membership = manager.create(TenantMembership, {
        userId: creatingUser.sub,
        tenantId: savedTenant.id,
        role: 'admin',
      });
      await manager.save(TenantMembership, membership);

      // Fires handle_tenant_context_switch trigger → updates auth.users JWT metadata
      await manager.update(User, { id: creatingUser.sub }, {
        lastAccessedTenantId: savedTenant.id,
      });

      this.logger.log(
        `Tenant created: ${savedTenant.id} (${savedTenant.name}) by user ${creatingUser.sub}`,
      );

      return savedTenant;
    });
  }

  /**
   * Returns a single tenant by ID using the RLS-scoped QueryRunner.
   *
   * RLS enforces isolation: if the authenticated user's current_tenant_id does
   * not match the requested tenant's id, the query returns no rows and a
   * NotFoundException is thrown. The caller cannot distinguish "not found" from
   * "access denied" — this is intentional (avoids tenant ID enumeration).
   */
  async findOne(id: string): Promise<Tenant> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied to this route.',
      );
    }

    const tenant = await context.queryRunner.manager.findOne(Tenant, {
      where: { id },
    });

    if (!tenant) {
      // Intentionally vague — prevents tenant ID enumeration
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}
