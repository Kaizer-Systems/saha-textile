import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { type Currency, FxSettings } from '@saha-textile/contracts';
import {
	type CurrencyRepository,
	type SiteSettingsRepository,
	convertFromINR,
	foreignAmountFromINR,
	roundMoney,
} from '@saha-textile/core-domain';

import { CURRENCY_REPOSITORY, SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

export interface ConversionResult {
	amountINR: number;
	currency: string;
	rateFromINR: number;
	/** The PayPal markup included (DEC-PAYPAL-FX: 6% on every currency but rupees). */
	markupPercent: number;
	amount: number;
}

const HOME_CURRENCY = 'INR';

@Injectable()
export class CurrencyService {
	constructor(
		@Inject(CURRENCY_REPOSITORY) private readonly currencies: CurrencyRepository,
		@Optional()
		@Inject(SITE_SETTINGS_REPOSITORY)
		private readonly settings: Pick<SiteSettingsRepository, 'get'> | null = null,
	) {}

	listEnabled(): Promise<Currency[]> {
		return this.currencies.listEnabled();
	}

	/**
	 * A rupee amount in another currency, the way a shopper paying in it sees it: the stored rate
	 * with the PayPal markup on top (shipping rules brief fx01). Rupees are returned as they are.
	 */
	async convert(amountINR: number, code: string): Promise<ConversionResult> {
		if (!Number.isFinite(amountINR) || amountINR < 0) {
			throw new BadRequestException('amountINR must be a non-negative number');
		}
		const currency = await this.currencies.findByCode(code.toUpperCase());
		if (!currency) throw new NotFoundException(`Currency not found: ${code}`);
		if (currency.code === HOME_CURRENCY) {
			const amount = roundMoney(convertFromINR(amountINR, currency.rateFromINR));
			return { amountINR, currency: currency.code, rateFromINR: currency.rateFromINR, markupPercent: 0, amount };
		}
		const fx = FxSettings.parse((await this.settings?.get('fx')) ?? {});
		const amount = foreignAmountFromINR(amountINR, currency.rateFromINR, fx.paypalMarkupPercent);
		return {
			amountINR,
			currency: currency.code,
			rateFromINR: currency.rateFromINR,
			markupPercent: fx.paypalMarkupPercent,
			amount,
		};
	}
}
