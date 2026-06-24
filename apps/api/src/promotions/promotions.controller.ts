import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PromotionsService } from './promotions.service';

const ValidateCouponSchema = z.object({ couponCode: z.string().min(1) });
type ValidateCouponInput = z.infer<typeof ValidateCouponSchema>;

@ApiTags('promotions')
@Controller('promotions')
export class PromotionsController {
	constructor(private readonly promotions: PromotionsService) {}

	@Get('active')
	@ApiOperation({ summary: 'List currently active promotions' })
	active() {
		return this.promotions.listActive();
	}

	@Post('validate')
	@ApiOperation({ summary: 'Validate a coupon code and return the matching promotion' })
	validate(@Body(new ZodValidationPipe(ValidateCouponSchema)) body: ValidateCouponInput) {
		return this.promotions.validateCoupon(body.couponCode);
	}
}
