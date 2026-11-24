import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CounterSaleWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CounterSalesService } from './counter-sales.service';

/** Counter mode (accounts brief P): a sale over a store's counter, invoiced and paid at once. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/counter')
export class CounterController {
	constructor(private readonly counter: CounterSalesService) {}

	@Post('sales')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterSale',
		summary: 'Sell over the counter: invoice, stock, cash sheet and books at once',
	})
	sell(
		@Body(new ZodValidationPipe(CounterSaleWrite)) body: CounterSaleWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.counter.sell(body, principal);
	}
}
