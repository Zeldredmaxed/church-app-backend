import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { rlsStorage } from '../common/storage/rls.storage';

/**
 * Shape returned to the mobile "saved cards" screen.
 *
 * Intentionally narrow — only the fields the UI renders. Avoids leaking
 * Stripe internals (fingerprints, networks, wallets) to the client.
 */
export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/**
 * User-facing saved payment methods management.
 *
 * Mobile uses this to list, delete, and set-default the cards a user has
 * attached to their Stripe Customer (created lazily on first SetupIntent).
 *
 * IMPORTANT: every mutation MUST verify the PM is attached to THIS user's
 * Stripe customer. Without that check, a malicious client could detach or
 * default another user's card by guessing the pm_xxx id.
 */
@ApiTags('Stripe Payment Methods')
@ApiBearerAuth()
@Controller('stripe/payment-methods')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class StripePaymentMethodsController {
  private readonly logger = new Logger(StripePaymentMethodsController.name);

  constructor(private readonly stripeService: StripeService) {}

  /**
   * Loads the acting user's Stripe customer id under RLS. Returns null
   * when the user has never created a SetupIntent (no Stripe Customer
   * exists yet). Callers should treat null as "empty wallet".
   */
  private async getStripeCustomerId(): Promise<string | null> {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    const { queryRunner, userId } = ctx;

    const [row] = await queryRunner.query(
      `SELECT stripe_customer_id FROM public.users WHERE id = $1`,
      [userId],
    );
    return row?.stripe_customer_id ?? null;
  }

  /**
   * Confirms that `pmId` is attached to the acting user's Stripe
   * Customer. Throws 403 if not — never leak whether the PM exists at
   * all, since that would let a client probe for valid pm_xxx ids
   * belonging to other users.
   */
  private async assertOwnedByCaller(pmId: string): Promise<{ customerId: string }> {
    const customerId = await this.getStripeCustomerId();
    if (!customerId) {
      throw new ForbiddenException('Payment method does not belong to this user');
    }
    // Wrap the Stripe retrieve so a nonexistent pm_xxx returns the
    // SAME 403 as "exists but owned by someone else". Otherwise the
    // raw StripeInvalidRequestError ("No such PaymentMethod") would
    // leak whether the id exists, letting an attacker probe for valid
    // pm_xxx values.
    let pm: any;
    try {
      pm = await this.stripeService.retrievePaymentMethod(pmId);
    } catch (err: any) {
      if (err?.type === 'StripeInvalidRequestError') {
        throw new ForbiddenException('Payment method does not belong to this user');
      }
      throw err;
    }
    if (!pm.customer || pm.customer !== customerId) {
      throw new ForbiddenException('Payment method does not belong to this user');
    }
    return { customerId };
  }

  @Get()
  @ApiOperation({
    summary: 'List the acting user\'s saved card payment methods',
    description:
      'Returns { data: SavedPaymentMethod[] }. Empty array if the user has ' +
      'no Stripe Customer yet (never saved a card). The default card is ' +
      'flagged via the Customer.invoice_settings.default_payment_method.',
  })
  @ApiResponse({ status: 200, description: '{ data: SavedPaymentMethod[] }' })
  async list(): Promise<{ data: SavedPaymentMethod[] }> {
    const customerId = await this.getStripeCustomerId();
    if (!customerId) return { data: [] };

    const [pms, customer] = await Promise.all([
      this.stripeService.listPaymentMethods(customerId),
      this.stripeService.retrieveCustomer(customerId),
    ]);

    // A deleted customer has no invoice_settings; treat as no default.
    const defaultPmId =
      !customer.deleted && customer.invoice_settings?.default_payment_method
        ? typeof customer.invoice_settings.default_payment_method === 'string'
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings.default_payment_method.id
        : null;

    const data: SavedPaymentMethod[] = pms.data
      .filter((pm) => pm.card)
      .map((pm) => ({
        id: pm.id,
        brand: pm.card!.brand,
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
        isDefault: pm.id === defaultPmId,
      }));

    return { data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Detach a saved payment method from the acting user',
    description:
      'Verifies ownership (PM must be attached to THIS user\'s Stripe ' +
      'Customer) before detaching. Returns 204 No Content on success.',
  })
  @ApiResponse({ status: 204, description: 'Detached' })
  @ApiResponse({ status: 403, description: 'PM not owned by caller' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.assertOwnedByCaller(id);
    await this.stripeService.detachPaymentMethod(id);
    this.logger.log(`Detached payment method ${id}`);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a saved payment method as the user\'s default',
    description:
      'Sets the customer\'s invoice_settings.default_payment_method. ' +
      'Returns the refreshed list so the UI can re-render flag state ' +
      'without a second round-trip.',
  })
  @ApiResponse({ status: 200, description: '{ data: SavedPaymentMethod[] }' })
  @ApiResponse({ status: 403, description: 'PM not owned by caller' })
  async setDefault(@Param('id') id: string): Promise<{ data: SavedPaymentMethod[] }> {
    const { customerId } = await this.assertOwnedByCaller(id);
    await this.stripeService.setDefaultPaymentMethod(customerId, id);
    this.logger.log(`Set default payment method ${id} for customer ${customerId}`);

    // Same envelope shape as list() — { data: [...] } — so the mobile
    // can reuse one decoder for both endpoints.
    return this.list();
  }
}
