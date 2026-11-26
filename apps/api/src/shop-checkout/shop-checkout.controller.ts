import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckoutConfirm, CheckoutPlace, CheckoutRequest } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { requestedLocale } from '../catalog/catalog-locale';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LanguageStore } from '../languages/language-store';
import { API_TAGS } from '../openapi-tags';
import { ShopCheckoutService } from './shop-checkout.service';
import { ShopPaymentsService } from './shop-payments.service';

/** The shop checkout (shop01–shop17). The signed-in shopper's own cart and payments only. */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/checkout')
@Audience('storefront')
export class ShopCheckoutController {
	constructor(
		private readonly checkout: ShopCheckoutService,
		private readonly payments: ShopPaymentsService,
		private readonly languages: LanguageStore,
	) {}

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

	@Post('place')
	@HttpCode(200)
	@ApiOperation({
		operationId: 'placeShopCheckout',
		summary: 'Pay: saves the order, holds its pieces for 15 minutes and hands the browser to the gateway',
	})
	place(
		@Body(new ZodValidationPipe(CheckoutPlace)) body: CheckoutPlace,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	) {
		return this.checkout.place(body, principal, requestedLocale(request.query, this.languages.shop()));
	}

	@Get('attempts/:attemptId')
	@ApiOperation({ operationId: 'getShopPaymentOutcome', summary: 'How one of the shopper’s payments ended' })
	outcome(@Param('attemptId') attemptId: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.payments.outcomeFor(attemptId, principal);
	}

	@Post('attempts/:attemptId/confirm')
	@HttpCode(200)
	@ApiOperation({
		operationId: 'confirmShopPayment',
		summary: 'The return page asks the gateway how the payment ended (the return itself proves nothing)',
	})
	confirm(
		@Param('attemptId') attemptId: string,
		@Body(new ZodValidationPipe(CheckoutConfirm)) body: CheckoutConfirm,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.payments.confirm(attemptId, body, principal);
	}
}
