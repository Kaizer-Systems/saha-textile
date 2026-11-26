import { randomUUID } from 'node:crypto';

import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	Header,
	HttpCode,
	Inject,
	Injectable,
	Param,
	Post,
	Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdjustmentReverseWrite, type AdjustmentDetail, type AdjustmentRequest } from '@saha-textile/contracts';
import {
	StockMovementRefusedError,
	formatQuantity,
	istDay,
	type AdjustmentRequestRepository,
} from '@saha-textile/core-domain';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { DocumentData } from '../documents/document-data';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { ADJUSTMENT_REQUEST_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { API_TAGS } from '../openapi-tags';
import { longDate } from './purchase-order-document';
import { PurchasingSupport, actorOf, canSeeCost, missing, refuse } from './purchasing-support';
import { StockAdjustmentBooks } from './stock-adjustment-books';
import { StockWriter } from './stock-writer';
import { REASON_WORDS } from './stock.service';

/** A posted adjustment as the print shows it (Settings › Document formats › Stock adjustment). */
export function stockAdjustmentData(adjustment: AdjustmentRequest, seller: DocumentData['seller']): DocumentData {
	const day = longDate(istDay(adjustment.decidedAt ?? adjustment.requestedAt));
	const figure = (value: number) => formatQuantity(value, adjustment.soldBy);
	const change = adjustment.action === 'remove' ? -adjustment.quantity : adjustment.quantity;
	const number = adjustment.number ?? adjustment.id;
	return {
		doc: 'stockAdjustment',
		title: 'Stock adjustment',
		number,
		date: day,
		seller,
		values: { adjustmentNo: number, date: day },
		parties: {},
		rows: [
			{
				kind: 'line',
				depth: 0,
				cells: {
					index: '1',
					item: [adjustment.title, adjustment.sku].filter(Boolean).join(' · '),
					before: adjustment.applied ? figure(adjustment.applied.onHandBefore) : '',
					change: `${change > 0 ? '+' : '−'}${figure(Math.abs(change))}`,
					after: adjustment.applied ? figure(adjustment.applied.onHandAfter) : '',
					reason: adjustment.reasonCode ? REASON_WORDS[adjustment.reasonCode] : '',
				},
				sku: adjustment.sku ?? '',
			},
		],
		signatures: { approvedBy: adjustment.decidedByName ?? '' },
	};
}

/**
 * A posted stock adjustment's page (accounts brief D5, E3): what it changed in the stock ledger, the cost layers, the
 * stock value and the input tax; Reverse (super admin) makes the opposite adjustment with its own SA number and a
 * voucher reversing the original's, leaving the original as it was, marked reversed; and its print.
 */
@Injectable()
export class StockAdjustmentPages {
	constructor(
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY)
		private readonly requests: Pick<AdjustmentRequestRepository, 'findById' | 'save'>,
		@Inject(StockWriter) private readonly writer: StockWriter,
		@Inject(PurchasingSupport) private readonly support: PurchasingSupport,
		@Inject(StockAdjustmentBooks) private readonly books: StockAdjustmentBooks,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'isSuperAdmin'>,
		@Inject(DocumentFormatsService)
		private readonly formats: Pick<DocumentFormatsService, 'seller' | 'renderActive'>,
	) {}

	private async adjustment(id: string): Promise<AdjustmentRequest> {
		const request = await this.requests.findById(id);
		if (!request || request.kind !== 'adjustment') throw missing('Adjustment');
		return request;
	}

	/** E3: the adjustment, what it changed, its reversal links, and whether this person may reverse it. */
	async detail(id: string, principal: AuthenticatedPrincipal | undefined): Promise<AdjustmentDetail> {
		const request = await this.adjustment(id);
		const seeCost = canSeeCost(principal);
		const [reverses, reversedBy, superAdmin] = await Promise.all([
			request.reverses ? this.requests.findById(request.reverses) : null,
			request.reversedBy ? this.requests.findById(request.reversedBy) : null,
			this.ledger.isSuperAdmin(principal),
		]);
		const applied = request.applied ?? null;
		const canReverse =
			superAdmin && request.status === 'applied' && !!request.number && !request.reversedBy && !request.reverses;
		return {
			request: seeCost
				? request
				: {
						...request,
						valueAtCostINR: null,
						costBreakdown: null,
						itcReversedINR: null,
						applied: applied && { ...applied, layers: [] },
					},
			whatChanged: {
				ledger: applied && {
					change: applied.onHandAfter - applied.onHandBefore,
					onHandBefore: applied.onHandBefore,
					onHandAfter: applied.onHandAfter,
				},
				layers: seeCost && applied ? applied.layers : [],
				valueINR: seeCost ? request.valueAtCostINR : null,
				itc: request.journalNumber
					? {
							amountINR: seeCost ? (request.itcReversedINR ?? null) : null,
							journalNumber: request.journalNumber,
						}
					: null,
			},
			reverses: reverses && { id: reverses.id, number: reverses.number ?? null },
			reversedBy: reversedBy && {
				id: reversedBy.id,
				number: reversedBy.number ?? null,
				byName: reversedBy.requestedByName,
			},
			canReverse,
			reverseNumber: canReverse ? await this.books.nextNumber() : null,
		};
	}

	/** E3 Reverse: the opposite adjustment, numbered and posted in one step; the original is marked reversed. */
	async reverse(
		id: string,
		write: AdjustmentReverseWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<AdjustmentRequest> {
		if (!(await this.ledger.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('reverse_super_admin_only'));
		const original = await this.adjustment(id);
		if (original.status !== 'applied' || !original.number)
			throw refuse('adjustment_not_posted', 'Only a posted adjustment can be reversed.');
		if (original.reversedBy) throw refuse('adjustment_already_reversed', 'This adjustment is already reversed.');
		if (original.reverses)
			throw refuse('adjustment_is_a_reversal', 'A reversal is not reversed again; make a new adjustment.');
		const reason = write.reason.trim();
		if (reason.length < 3) throw refuse('reason_required', 'Say why it is reversed.', 'reason');
		const number = original.number;
		const actor = actorOf(principal);
		const name = await this.support.nameOf(actor);
		// An adjustment always names its item (only counts have none, and those are refused above).
		const fact = await this.writer.facts(original.variantId as string);
		const action = original.action === 'remove' ? 'add' : 'remove';
		const reversalId = `adj_${randomUUID()}`;
		const at = now.toISOString();
		try {
			const reversal = await this.support.inTransaction(async (context) => {
				const done = await this.writer.apply(
					{
						variantId: fact.variantId,
						action,
						quantity: original.quantity,
						reasonCode: original.reasonCode,
						holdReason: null,
						holdId: null,
						note: reason,
						referenceType: 'stock_adjustment',
						referenceId: reversalId,
						referenceNumber: null,
						actor,
						approver: actor,
						source: 'manual_adjustment',
						// Written-off pieces come back at the cost they left at, so stock value and the books agree.
						unitCostINR: action === 'add' ? (original.valueAtCostINR ?? 0) / original.quantity : null,
					},
					context,
				);
				const posted = await this.books.reversed({ id: original.id, number }, reversalId, context, actor, now);
				const next: AdjustmentRequest = {
					...original,
					id: reversalId,
					action,
					holdId: null,
					note: reason,
					photoAssetIds: [],
					valueAtCostINR: done.valueINR,
					costBreakdown: done.breakdown || null,
					requestedBy: actor,
					requestedByName: name,
					requestedAt: at,
					decidedBy: actor,
					decidedByName: name,
					decidedAt: at,
					rejectReason: null,
					selfApproved: true,
					number: posted.number,
					outcome: null,
					itcReversedINR: null,
					journalNumber: posted.journalNumber,
					reverses: original.id,
					reversedBy: null,
					reversedAt: null,
					applied: { onHandBefore: done.onHandBefore, onHandAfter: done.onHandAfter, layers: done.layers },
				};
				await this.requests.save(next, null, context);
				await this.requests.save({ ...original, reversedBy: reversalId, reversedAt: at }, null, context);
				await this.support.record(
					{
						actor,
						action: 'stock.adjustment.reverse',
						entityType: 'stock_adjustment',
						entityId: original.id,
						text: `${name} reversed ${number} with ${posted.number} (${action === 'add' ? '+' : '−'}${formatQuantity(original.quantity, fact.soldBy)} × ${fact.sku}): ${reason}.`,
						facts: { number, reversal: posted.number, journal: posted.journalNumber },
					},
					context,
				);
				return next;
			});
			await this.writer.refreshShop([fact.productId]);
			return reversal;
		} catch (error) {
			if (error instanceof StockMovementRefusedError)
				throw refuse(
					'stock_moved_meanwhile',
					'The pieces it added have left the stock since; count them first.',
				);
			throw error;
		}
	}

	/** The adjustment on its document format (cost-free, as the format draws it). */
	async print(id: string): Promise<{ fileName: string; data: Uint8Array }> {
		const adjustment = await this.adjustment(id);
		const seller = await this.formats.seller(previewDocument('stockAdjustment').seller);
		const number = adjustment.number ?? adjustment.id;
		return {
			fileName: `stock-adjustment-${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
			data: await this.formats.renderActive('stockAdjustment', stockAdjustmentData(adjustment, seller)),
		};
	}
}

@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/stock/adjustments')
export class StockAdjustmentPagesController {
	constructor(private readonly pages: StockAdjustmentPages) {}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.index')
	@ApiOperation({
		operationId: 'stockAdjustmentDetail',
		summary: 'A posted stock adjustment and what it changed (E3)',
	})
	detail(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.pages.detail(id, principal);
	}

	@Post(':id/reverse')
	@HttpCode(200)
	@RequirePermissions('stock.approve')
	@ApiOperation({
		operationId: 'reverseStockAdjustment',
		summary: 'Super admin: the opposite adjustment and a reversing voucher; the original is marked reversed (E3)',
	})
	reverse(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AdjustmentReverseWrite)) body: AdjustmentReverseWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.pages.reverse(id, body, principal);
	}

	@Get(':id/pdf')
	@RequirePermissions('stock.index')
	@ApiOperation({ operationId: 'stockAdjustmentPdf', summary: 'A stock adjustment on its document format' })
	async print(@Param('id') id: string, @Res() reply: FastifyReply) {
		const file = await this.pages.print(id);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(file.data));
	}
}
