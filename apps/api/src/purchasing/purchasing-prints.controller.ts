import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LabelSheetRequest } from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PurchasingPrints } from './purchasing-prints';
import { actorOf } from './purchasing-support';

const sendPdf = (reply: FastifyReply, file: { fileName: string; data: Uint8Array }) =>
	void reply
		.header('Content-Type', 'application/pdf')
		.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
		.header('Cache-Control', 'no-store')
		.send(Buffer.from(file.data));

/** Printable documents of purchases: goods receipt (p01), debit note and challan (r04), label sheets (l01). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin')
export class PurchasingPrintsController {
	constructor(private readonly prints: PurchasingPrints) {}

	@Get('purchases/entries/:id/receipt-pdf')
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'purchaseEntryReceiptPdf',
		summary: 'The goods receipt: what was counted, good, damaged, missing',
	})
	async receipt(@Param('id') id: string, @Res() reply: FastifyReply) {
		sendPdf(reply, await this.prints.receiptPdf(id));
	}

	@Get('purchase-returns/:id/debit-note-pdf')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({ operationId: 'purchaseReturnDebitNotePdf', summary: 'The debit note of a sent return' })
	async debitNote(@Param('id') id: string, @Res() reply: FastifyReply) {
		sendPdf(reply, await this.prints.returnPdf(id, 'debit-note'));
	}

	@Get('purchase-returns/:id/challan-pdf')
	@RequirePermissions('purchase_return.index')
	@ApiOperation({ operationId: 'purchaseReturnChallanPdf', summary: 'The delivery challan of goods sent back' })
	async challan(@Param('id') id: string, @Res() reply: FastifyReply) {
		sendPdf(reply, await this.prints.returnPdf(id, 'challan'));
	}

	@Post('purchases/labels/pdf')
	@HttpCode(200)
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'purchaseLabelSheetPdf',
		summary: 'Barcode labels on A4 sheets, many items per sheet',
	})
	async labels(
		@Body(new ZodValidationPipe(LabelSheetRequest)) body: LabelSheetRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res() reply: FastifyReply,
	) {
		sendPdf(reply, await this.prints.labelsPdf(body, actorOf(principal)));
	}
}
