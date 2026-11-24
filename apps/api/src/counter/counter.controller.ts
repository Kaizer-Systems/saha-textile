import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	CounterExchangeWrite,
	CounterFindQuery,
	CounterQuoteWrite,
	CounterSaleWrite,
	CounterScanQuery,
	CounterSummaryQuery,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CounterDeskService } from './counter-desk.service';
import { CounterExchangeService } from './counter-exchange.service';
import { CounterSummaryService } from './counter-summary.service';
import { CounterSalesService } from './counter-sales.service';

/** Counter mode (accounts brief P): a sale over a store's counter, invoiced and paid at once. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/counter')
export class CounterController {
	constructor(
		private readonly counter: CounterSalesService,
		private readonly desk: CounterDeskService,
		private readonly exchanges: CounterExchangeService,
		private readonly summaries: CounterSummaryService,
	) {}

	@Get('summary')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterSummary',
		summary: "A store's day at the counter; the cashier's copy leaves out cash",
	})
	summary(
		@Query(new ZodValidationPipe(CounterSummaryQuery)) query: CounterSummaryQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.summaries.summary(query, principal);
	}

	@Get('sales')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'counterFind', summary: 'A counter bill by its order or tax invoice number' })
	find(
		@Query(new ZodValidationPipe(CounterFindQuery)) query: CounterFindQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.exchanges.find(query.number, principal);
	}

	@Get('sales/:orderId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'counterBill', summary: 'A counter bill: the lines that can still come back' })
	bill(@Param('orderId') orderId: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.exchanges.bill(orderId, principal);
	}

	@Post('sales/:orderId/exchange')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterExchange',
		summary: 'Exchange at the counter: a credit note for what comes back, a new sale for what goes out',
	})
	exchange(
		@Param('orderId') orderId: string,
		@Body(new ZodValidationPipe(CounterExchangeWrite)) body: CounterExchangeWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.exchanges.exchange(orderId, body, principal);
	}

	@Get('here')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterHere',
		summary: 'The stores this person sells at, and whether each sheet is open',
	})
	here(@Principal() principal?: AuthenticatedPrincipal) {
		return this.desk.here(principal);
	}

	@Get('scan')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('cash.count')
	@ApiOperation({ operationId: 'counterScan', summary: 'What a scanned SKU is' })
	scan(@Query(new ZodValidationPipe(CounterScanQuery)) query: CounterScanQuery) {
		return this.desk.scan(query.code);
	}

	@Post('quote')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterQuote',
		summary: 'The counter items priced, with the tax their invoice will show',
	})
	quote(
		@Body(new ZodValidationPipe(CounterQuoteWrite)) body: CounterQuoteWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.desk.quote(body, principal);
	}

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

	@Get('sales/:orderId/print')
	@RequirePermissions('cash.count')
	@ApiOperation({
		operationId: 'counterPrint',
		summary: "A counter sale's tax invoice on its format's paper or the 80 mm roll (PDF)",
	})
	async print(
		@Param('orderId') orderId: string,
		@Query('paper') paper: string | undefined,
		@Res() reply: FastifyReply,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const pdf = await this.desk.print(orderId, paper === 'roll80' ? 'roll80' : null, principal);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${pdf.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf.bytes));
	}
}
