import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SignupAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  state!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode!: string;

  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'country must be a 2-letter ISO code' })
  country?: string;
}

/**
 * Body for POST /api/tenants/signup — public, paid new-church signup.
 *
 * Flow:
 *   1. Mobile/admin dashboard POSTs this body
 *   2. Backend creates a Stripe Checkout subscription session with
 *      `payment_method_collection: 'always'` (so even 100%-off promo
 *      codes still capture a card → no month-7 silent churn)
 *   3. Returns { checkoutUrl } for the client to redirect to
 *   4. On checkout.session.completed: tenant + founding admin
 *      materialized server-side (single source of truth)
 *   5. Magic-link login email sent to adminEmail
 */
export class TenantSignupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  churchName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  adminFullName!: string;

  @IsEmail()
  @MaxLength(254)
  adminEmail!: string;

  /** Subscription tier the church is signing up for. */
  @IsString()
  @IsIn(['standard', 'premium', 'enterprise'])
  tier!: 'standard' | 'premium' | 'enterprise';

  /**
   * Billing interval. Optional — defaults to monthly.
   * Yearly price = ×10 monthly (2 months free baked in) and the
   * Stripe Checkout session disables typed promo codes so 6-month
   * coupons can't accidentally apply to a yearly invoice.
   */
  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  billingInterval?: 'monthly' | 'yearly';

  @ValidateNested()
  @Type(() => SignupAddressDto)
  address!: SignupAddressDto;
}
