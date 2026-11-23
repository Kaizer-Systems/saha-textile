import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	CreditNoteCancel,
	CreditNoteDraftWrite,
	CreditNoteRefundWrite,
	CreditNoteStatus,
	DebitNoteWrite,
	IsoDate,
	PriceAdjustmentWrite,
	ReturnCheck,
	ReturnStart,
	ReturnStep,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { creditNoteData, debitNoteData } from '../documents/credit-note-print';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { API_TAGS } from '../openapi-tags';
import { ReturnsService } from './returns.service';

const IssueBody = z.object({ version: z.number().int().nonnegative() });
const CreditNoteListQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	search: z.string().trim().max(80).default(''),
	status: CreditNoteStatus.nullable().default(null),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** The order page's returns, price adjustments and undelivered parcels (accounts brief B1–B3, B10, B11). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin')
export class ReturnsController {
	constructor(private readonly returns: ReturnsService) {}

	@Get('orders/:id/returns')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({
		operationId: 'orderReturns',
		summary: 'What can come back, the windows, and every return and note',
	})
	view(@Param('id') id: string) {
		return this.returns.view(id);
	}

	@Post('orders/:id/returns')
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'startReturn', summary: 'Start a return (nothing moves until its credit note)' })
	start(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReturnStart)) body: ReturnStart,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.start(id, body, principal?.userId ?? null);
	}

	@Post('orders/:id/price-adjustment')
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'priceAdjustment', summary: 'A credit note draft for a price agreed lower (B10)' })
	priceAdjustment(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PriceAdjustmentWrite)) body: PriceAdjustmentWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.priceAdjustment(id, body, principal?.userId ?? null);
	}

	@Post('orders/:id/parcels/:shipmentId/undelivered')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'parcelUndelivered', summary: 'A credit note draft for a parcel brought back (B11)' })
	undelivered(
		@Param('id') id: string,
		@Param('shipmentId') shipmentId: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.undelivered(id, shipmentId, principal?.userId ?? null);
	}

	@Get('returns/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({ operationId: 'getReturn', summary: 'One return' })
	getReturn(@Param('id') id: string) {
		return this.returns.getReturn(id);
	}

	@Post('returns/:id/step')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'returnStep', summary: 'Pickup booked or Received' })
	step(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReturnStep)) body: ReturnStep,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.step(id, body, principal?.userId ?? null);
	}

	@Post('returns/:id/check')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'returnCheck', summary: 'What happens to each returned piece (B3)' })
	check(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReturnCheck)) body: ReturnCheck,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.check(id, body, principal?.userId ?? null);
	}

	@Post('returns/:id/credit-note')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'returnCreditNote', summary: 'Make the credit note draft from a checked return' })
	creditNoteFromReturn(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.returns.fromReturn(id, principal?.userId ?? null);
	}
}

/** Accounts › credit notes: drafts, Issue, Cancel and debit notes (B4, B5, B8, B9). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts')
export class CreditNotesController {
	constructor(
		private readonly returns: ReturnsService,
		private readonly formats: DocumentFormatsService,
	) {}

	private async sendPdf(reply: FastifyReply, pdf: Uint8Array, name: string) {
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${name.replace(/\//g, '-')}.pdf"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(pdf));
	}

	@Get('credit-notes/:id/pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'creditNotePdf', summary: 'A credit note as a PDF' })
	async creditNotePdf(@Param('id') id: string, @Res() reply: FastifyReply) {
		const note = await this.returns.creditNote(id);
		const seller = await this.formats.seller(previewDocument('creditNote').seller);
		const data = creditNoteData(note, seller);
		await this.sendPdf(reply, await this.formats.renderActive('creditNote', data), data.number);
	}

	@Get('debit-notes/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getDebitNote', summary: 'One debit note' })
	getDebitNote(@Param('id') id: string) {
		return this.returns.debitNoteById(id);
	}

	@Get('debit-notes/:id/pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'debitNotePdf', summary: 'A debit note as a PDF' })
	async debitNotePdf(@Param('id') id: string, @Res() reply: FastifyReply) {
		const note = await this.returns.debitNoteById(id);
		const seller = await this.formats.seller(previewDocument('debitNote').seller);
		const data = debitNoteData(note, seller);
		await this.sendPdf(reply, await this.formats.renderActive('debitNote', data), data.number);
	}

	@Get('credit-notes')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'listCreditNotes', summary: 'Credit notes in a period' })
	list(@Query(new ZodValidationPipe(CreditNoteListQuery)) query: z.infer<typeof CreditNoteListQuery>) {
		return this.returns.listCreditNotes(query);
	}

	@Get('credit-notes/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'getCreditNote', summary: 'One credit note' })
	get(@Param('id') id: string) {
		return this.returns.creditNote(id);
	}

	@Put('credit-notes/:id')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'saveCreditNoteDraft', summary: 'Save a credit note draft' })
	save(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CreditNoteDraftWrite)) body: CreditNoteDraftWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.saveDraft(id, body, principal?.userId ?? null);
	}

	@Delete('credit-notes/:id')
	@HttpCode(204)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'deleteCreditNoteDraft', summary: 'Delete a credit note draft' })
	async remove(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		await this.returns.deleteDraft(id, principal?.userId ?? null);
	}

	@Post('credit-notes/:id/issue')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'issueCreditNote', summary: 'Issue: the number, stock, the books (one transaction)' })
	issue(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(IssueBody)) body: z.infer<typeof IssueBody>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.issue(id, body.version, principal?.userId ?? null);
	}

	@Get('credit-notes/:id/cancel-checks')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'creditNoteCancelChecks', summary: 'Why a credit note may or may not be cancelled' })
	cancelChecks(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.returns.cancelChecks(id, principal);
	}

	@Post('credit-notes/:id/cancel')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({
		operationId: 'cancelCreditNote',
		summary: 'Cancel an issued credit note (super admin, month open)',
	})
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CreditNoteCancel)) body: CreditNoteCancel,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.cancel(id, body, principal);
	}

	@Post('credit-notes/:id/refund')
	@HttpCode(200)
	@RequirePermissions('refund.action')
	@ApiOperation({ operationId: 'refundCreditNote', summary: 'Refund an issued credit note now (gateway or by hand)' })
	refund(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CreditNoteRefundWrite)) body: CreditNoteRefundWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.refund(id, body, principal?.userId ?? null);
	}

	@Post('credit-notes/:id/debit-note')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'creditNoteDebitNote', summary: 'Undo a credit note with a debit note this month' })
	debitNote(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(DebitNoteWrite)) body: DebitNoteWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.debitNote(id, body, principal?.userId ?? null);
	}
}
