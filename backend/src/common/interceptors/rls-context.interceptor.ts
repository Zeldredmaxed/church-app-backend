import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource, QueryRunner } from 'typeorm';
import { rlsStorage, RlsContext } from '../storage/rls.storage';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * RlsContextInterceptor — the enforcement backbone of our multi-tenant security model.
 *
 * For every authenticated HTTP request, this interceptor:
 *   1. Creates a dedicated TypeORM QueryRunner (a single DB connection from the pool).
 *   2. Opens a transaction on that connection.
 *   3. Executes two SET LOCAL commands to activate RLS for this transaction:
 *        SET LOCAL role = 'authenticated'
 *        SET LOCAL "request.jwt.claims" = '<jwt_json>'
 *   4. Stores the QueryRunner in AsyncLocalStorage (rlsStorage) so any service
 *      in the call stack can retrieve it without prop-drilling.
 *   5. After the handler completes: commits the transaction and releases the connection.
 *   6. On any error: rolls back and releases.
 *
 * WHY SET LOCAL (not SET)?
 *   SET LOCAL scopes the variable to the current transaction only. Using SET would
 *   persist the tenant context on a pooled connection after it's returned to the pool,
 *   meaning the NEXT request to reuse that connection would inherit the wrong tenant.
 *   This would be a critical tenant data leak. SET LOCAL is mandatory.
 *
 * WHY AsyncLocalStorage?
 *   Node.js async context propagation lets us pass the QueryRunner through the entire
 *   async call stack (controller → service → repository) without explicitly threading
 *   it through every function parameter. Services call rlsStorage.getStore() to
 *   retrieve their scoped connection.
 *
 * USAGE:
 *   Apply to any route that performs tenant-scoped DB queries:
 *     @UseGuards(JwtAuthGuard)
 *     @UseInterceptors(RlsContextInterceptor)
 *
 *   In your service, retrieve the QueryRunner:
 *     const { queryRunner } = rlsStorage.getStore()!;
 *     const results = await queryRunner.manager.find(Post, { where: { ... } });
 *
 * NOTE: Routes that do NOT need RLS (e.g., POST /auth/login, POST /auth/signup)
 *   should NOT use this interceptor. Those services use this.dataSource.manager
 *   directly, which runs as the service role.
 */
@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RlsContextInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: SupabaseJwtPayload | undefined = request.user;

    // No authenticated user — unauthenticated route, skip RLS setup.
    if (!user) {
      return next.handle();
    }

    return new Observable(subscriber => {
      let queryRunner: QueryRunner | null = null;

      const setup = async () => {
        queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        // Step 1: Downgrade the connection role from service role to 'authenticated'.
        // This activates PostgreSQL RLS enforcement on all subsequent queries.
        await queryRunner.query(`SET LOCAL role = 'authenticated'`);

        // Step 2: Inject the JWT payload so auth.jwt() resolves in RLS policies.
        // The policies use: (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        //
        // NOTE: We use string concatenation instead of parameterized $1 because
        // PgBouncer (transaction mode) does not support parameterized SET commands.
        // The value is safe — it's JSON-stringified from our own decoded JWT, not user input.
        const claimsJson = JSON.stringify(user).replace(/'/g, "''");
        await queryRunner.query(`SET LOCAL "request.jwt.claims" = '${claimsJson}'`);

        const rlsContext: RlsContext = {
          queryRunner,
          userId: user.sub,
          currentTenantId: user.app_metadata?.current_tenant_id ?? null,
        };

        // Run the rest of the request inside this AsyncLocalStorage context
        rlsStorage.run(rlsContext, () => {
          next.handle().subscribe({
            next: val => subscriber.next(val),

            error: async err => {
              try {
                if (queryRunner?.isTransactionActive) {
                  await queryRunner.rollbackTransaction();
                }
              } catch (rollbackErr) {
                this.logger.error('Transaction rollback failed', rollbackErr);
              } finally {
                try { await queryRunner?.release(); } catch {}
              }
              subscriber.error(err);
            },

            complete: async () => {
              try {
                if (queryRunner?.isTransactionActive) {
                  await queryRunner.commitTransaction();
                }
                subscriber.complete();
              } catch (commitErr) {
                this.logger.error('Transaction commit failed', commitErr);
                try { await queryRunner?.release(); } catch {}
                subscriber.error(
                  new InternalServerErrorException('Transaction commit failed'),
                );
                return;
              }
              try { await queryRunner?.release(); } catch {}
            },
          });
        });
      };

      setup().catch(err => {
        queryRunner?.release().catch(() => {});
        subscriber.error(err);
      });
    });
  }
}
