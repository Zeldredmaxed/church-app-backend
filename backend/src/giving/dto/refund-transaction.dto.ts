import { IsOptional, IsInt, IsIn, IsString, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefundTransactionDto {
  @ApiPropertyOptional({
    description:
      'Amount to refund in CENTS. Omit for a full refund. Cannot exceed the original donation amount.',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @ApiPropertyOptional({
    enum: ['duplicate', 'fraudulent', 'requested_by_customer'],
    description: 'Stripe-recognized reason; included on the Refund object',
  })
  @IsOptional()
  @IsIn(['duplicate', 'fraudulent', 'requested_by_customer'])
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';

  @ApiPropertyOptional({ description: 'Free-text note shown only in audit log', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
