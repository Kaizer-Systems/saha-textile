import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrencyService } from './currency.service';

@ApiTags('currency')
@Controller('currency')
export class CurrencyController {
	constructor(private readonly currency: CurrencyService) {}

	@Get()
	@ApiOperation({ summary: 'List enabled currencies' })
	list() {
		return this.currency.listEnabled();
	}

	@Get('convert')
	@ApiOperation({ summary: 'Convert a canonical INR amount into a target currency' })
	@ApiQuery({ name: 'amountINR', type: Number })
	@ApiQuery({ name: 'code', description: 'ISO 4217 currency code, e.g. USD' })
	convert(@Query('amountINR') amountINR: string, @Query('code') code: string) {
		return this.currency.convert(Number(amountINR), code ?? 'INR');
	}
}
