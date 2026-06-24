import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Currency } from '@saha/contracts';
import { type CurrencyRepository, convertFromINR, roundMoney } from '@saha/core-domain';

import { CURRENCY_REPOSITORY } from '../infra/tokens';

export interface ConversionResult {
	amountINR: number;
	currency: string;
	rateFromINR: number;
	amount: number;
}

@Injectable()
export class CurrencyService {
	constructor(@Inject(CURRENCY_REPOSITORY) private readonly currencies: CurrencyRepository) {}

	listEnabled(): Promise<Currency[]> {
		return this.currencies.listEnabled();
	}

	async convert(amountINR: number, code: string): Promise<ConversionResult> {
		if (!Number.isFinite(amountINR) || amountINR < 0) {
			throw new BadRequestException('amountINR must be a non-negative number');
		}
		const currency = await this.currencies.findByCode(code.toUpperCase());
		if (!currency) throw new NotFoundException(`Currency not found: ${code}`);

		const amount = roundMoney(convertFromINR(amountINR, currency.rateFromINR));
		return { amountINR, currency: currency.code, rateFromINR: currency.rateFromINR, amount };
	}
}
