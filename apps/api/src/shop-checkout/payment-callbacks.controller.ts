import { BadRequestException, Controller, HttpCode, Post, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { ShopPaymentsService } from './shop-payments.service';

const headerMap = (request: FastifyRequest): Record<string, string | undefined> =>
	Object.fromEntries(
		Object.entries(request.headers).map(([name, value]) => [
			name.toLowerCase(),
			Array.isArray(value) ? value[0] : value,
		]),
	);

/**
 * What the gateways send us (no session, no cookies: the gateway's own servers, or the shopper's
 * browser posting CCAvenue's form). Each answer only names an attempt; the status enquiry decides.
 * Every failure is answered the same way, so a forged post learns nothing about how far it got.
 *
 * - `POST /payments/ccavenue/return`: CCAvenue's return (`CCAVENUE_RETURN_URL`), then the browser goes
 *   to the shop's return page.
 * - `POST /payments/ccavenue/notify`: CCAvenue's "Order status echo URL" (Dynamic Event Notification).
 * - `POST /payments/paypal/webhook`: PayPal's webhook, checked with `PAYPAL_WEBHOOK_ID`.
 */
@ApiTags(API_TAGS.orders)
@Controller('payments')
export class PaymentCallbacksController {
	constructor(private readonly payments: ShopPaymentsService) {}

	@Post('ccavenue/return')
	@Public()
	async ccavenueReturn(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
		const attempt = await this.payments.ccavenueReturn(request.body).catch(() => null);
		const locale = attempt ? await this.payments.localeOf(attempt) : 'en';
		await reply.redirect(this.payments.resultPage(attempt?.id ?? 'unknown', locale), 303);
	}

	@Post('ccavenue/notify')
	@Public()
	@HttpCode(200)
	async ccavenueNotify(@Req() request: FastifyRequest): Promise<{ received: true }> {
		await this.payments.ccavenueReturn(request.body).catch(() => null);
		return { received: true };
	}

	@Post('paypal/webhook')
	@Public()
	@HttpCode(200)
	async paypalWebhook(@Req() request: RawBodyRequest<FastifyRequest>): Promise<{ received: true }> {
		const raw = request.rawBody?.toString('utf8') ?? '';
		const result = await this.payments.paypalWebhook(headerMap(request), raw).catch(() => 'unverified' as const);
		if (result === 'unverified') throw new BadRequestException('Not accepted');
		return { received: true };
	}
}
