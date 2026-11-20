import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckoutRequest } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ShopCheckoutService } from './shop-checkout.service';

/** The shop checkout (shop01–shop17). The signed-in shopper's own cart only: no ids in the path. */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/checkout')
@Audience('storefront')
export class ShopCheckoutController {
	constructor(private readonly checkout: ShopCheckoutService) {}

	@Post('quote')
	@HttpCode(200)
	@ApiOperation({
		operationId: 'quoteShopCheckout',
		summary:
			'The checkout as the shopper will pay it: shipping with its reason, coupons, notes and whether Pay is on',
	})
	quote(
		@Body(new ZodValidationPipe(CheckoutRequest)) body: CheckoutRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.checkout.quote(body, principal);
	}
}
