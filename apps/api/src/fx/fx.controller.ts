import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyRateWrite, FxSettingsWrite, PaymentRoutingWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { FxAdminService } from './fx-admin.service';
import { PaymentRoutingService } from './payment-routing.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/**
 * Admin › Currencies (shipping rules brief fx01–fx03): reading needs `currency.index`; rates, the
 * rate source and the daily fetch need `currency.edit`; the PayPal markup also needs a super admin.
 */
@ApiTags(API_TAGS.currency)
@Audience('admin')
@Controller('admin/fx')
export class AdminFxController {
	constructor(private readonly fx: FxAdminService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('currency.index')
	@ApiOperation({
		operationId: 'getFxOverview',
		summary: 'Rate source, markup, daily fetch and every currency’s rate',
	})
	overview(@Principal() principal?: AuthenticatedPrincipal) {
		return this.fx.overview(actor(principal));
	}

	@Post('settings')
	@HttpCode(200)
	@RequirePermissions('currency.edit')
	@ApiOperation({
		operationId: 'saveFxSettings',
		summary: 'Save the rate source, the daily fetch and (super admin only) the PayPal markup',
	})
	saveSettings(
		@Body(new ZodValidationPipe(FxSettingsWrite)) body: FxSettingsWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.fx.saveSettings(body, actor(principal));
	}

	@Post('currencies/:code')
	@HttpCode(200)
	@RequirePermissions('currency.edit')
	@ApiOperation({
		operationId: 'setCurrencyRate',
		summary: 'Type a rate (₹ per unit) or switch a currency on or off',
	})
	setRate(
		@Param('code') code: string,
		@Body(new ZodValidationPipe(CurrencyRateWrite)) body: CurrencyRateWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.fx.setRate(code, body, actor(principal));
	}

	@Post('fetch-now')
	@HttpCode(200)
	@RequirePermissions('currency.edit')
	@ApiOperation({ operationId: 'fetchFxRatesNow', summary: 'Fetch today’s rates now from ExchangeRate-API' })
	fetchNow(@Principal() principal?: AuthenticatedPrincipal) {
		return this.fx.fetchNow(actor(principal));
	}
}

/** Settings › Payment method (brief pay01): reading needs `setting.index`; saving `setting.edit`. */
@ApiTags(API_TAGS.currency)
@Audience('admin')
@Controller('admin/payments/routing')
export class AdminPaymentRoutingController {
	constructor(private readonly routing: PaymentRoutingService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'getPaymentRouting',
		summary: 'Which gateway takes each currency, and whether keys are set',
	})
	view() {
		return this.routing.view();
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'savePaymentRouting',
		summary: 'Choose the active INR gateway, PayPal, test mode and popups',
	})
	save(
		@Body(new ZodValidationPipe(PaymentRoutingWrite)) body: PaymentRoutingWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.routing.save(body, actor(principal));
	}
}
