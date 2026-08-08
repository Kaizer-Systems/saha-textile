import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ValidateCouponRequest } from '@saha-textile/contracts';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PromotionsService } from './promotions.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

@ApiTags(API_TAGS.promotions)
@Controller('promotions')
/** Public active promotions and coupon validation. */
@Public()
export class PromotionsController {
	constructor(private readonly promotions: PromotionsService) {}

	@Get('active')
	@ApiOperation({ operationId: 'listActivePromotions', summary: 'List currently active promotions' })
	active() {
		return this.promotions.listActive();
	}

	@Post('validate')
	@ApiOperation({
		operationId: 'validatePromotion',
		summary: 'Validate a coupon code and return the matching promotion',
	})
	validate(@Body(new ZodValidationPipe(ValidateCouponRequest)) body: ValidateCouponRequest) {
		return this.promotions.validateCoupon(body.couponCode);
	}
}
