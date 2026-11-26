import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AdjustmentRequest, AdjustmentRequestListQuery } from '@saha-textile/contracts';
import {
	type AdjustmentRequestRepository,
	StockMovementRefusedError,
	adjustmentRefusal,
	formatQuantity,
	formatRupees,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { ADJUSTMENT_REQUEST_REPOSITORY } from '../infra/tokens';
import { PurchasingSupport, actorOf, canSeeCost, missing, refuse } from './purchasing-support';
import { StockAdjustmentBooks } from './stock-adjustment-books';
import { StockCountsService } from './stock-counts.service';
import { REASON_WORDS } from './stock.service';
import { StockWriter } from './stock-writer';

/**
 * The approvals queue (i05, i05b): write-offs, additions and count differences raised by people
 * without Approve write-offs. Nobody decides their own request; a rejection needs a reason and
 * reaches the requester through the bell.
 */
@Injectable()
export class StockApprovalsService {
	constructor(
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY) private readonly requests: AdjustmentRequestRepository,
		private readonly writer: StockWriter,
		private readonly counts: StockCountsService,
		private readonly support: PurchasingSupport,
		/** D5: SA numbers and the books (accounts brief E1, E3). */
		@Optional() @Inject(StockAdjustmentBooks) private readonly adjustmentBooks: StockAdjustmentBooks | null = null,
	) {}

	async list(query: AdjustmentRequestListQuery, principal: AuthenticatedPrincipal | undefined) {
		const page = await this.requests.list(query);
		if (canSeeCost(principal)) return page;
		return {
			...page,
			items: page.items.map((request) => ({ ...request, valueAtCostINR: null, costBreakdown: null })),
		};
	}

	private async pending(id: string, actor: string | null): Promise<AdjustmentRequest> {
		const request = await this.requests.findById(id);
		if (!request) throw missing('Request');
		if (request.status !== 'pending') throw refuse('already_decided', 'This request has been decided already.');
		if (actor && request.requestedBy === actor) {
			throw refuse('own_request', 'Someone else must decide your own request.');
		}
		return request;
	}

	async approve(id: string, principal: AuthenticatedPrincipal | undefined): Promise<AdjustmentRequest> {
		const actor = actorOf(principal);
		const request = await this.pending(id, actor);
		const name = await this.support.nameOf(actor);
		const now = new Date().toISOString();

		if (request.kind === 'count' && request.countId) {
			const decided: AdjustmentRequest = {
				...request,
				status: 'applied',
				decidedBy: actor,
				decidedByName: name,
				decidedAt: now,
			};
			// The decision commits with the posting, or neither happens.
			await this.counts.apply(request.countId, request.requestedBy, actor, false, (context) =>
				this.requests.save(decided, null, context),
			);
			return decided;
		}

		if (!request.variantId || !request.action) throw refuse('request_incomplete', 'This request names no item.');
		const fact = await this.writer.facts(request.variantId);
		const hold = request.holdId ? await this.writer.holdById(request.holdId) : null;
		// Stock may have moved since it was asked for: the same rules apply now.
		const refusal = adjustmentRefusal({
			action: request.action,
			quantity: request.quantity,
			facts: { onHand: fact.onHand, held: fact.held, reserved: fact.reserved },
			soldBy: fact.soldBy,
			hold: hold ? { quantity: hold.quantity, status: hold.status } : null,
			tracked: fact.tracked,
		});
		if (refusal) throw refuse('adjustment_refused', refusal);
		const requester = request.requestedByName ?? (await this.support.nameOf(request.requestedBy));
		const decided = await this.support
			.inTransaction(async (context) => {
				// D5: approved, it takes its SA number and goes to the books with it (E3).
				const books = this.adjustmentBooks;
				const number = books ? await books.number(context) : null;
				const done = await this.writer.apply(
					{
						variantId: request.variantId as string,
						action: request.action as 'remove' | 'add',
						quantity: request.quantity,
						reasonCode: request.reasonCode,
						holdReason: null,
						holdId: request.holdId,
						note: request.note,
						referenceType: 'stock_adjustment',
						referenceId: request.id,
						referenceNumber: number,
						actor: request.requestedBy,
						approver: actor,
						source: 'manual_adjustment',
					},
					context,
				);
				const posting = books
					? await books.posted(
							{
								id: request.id,
								action: request.action as 'remove' | 'add',
								quantity: request.quantity,
								reasonCode: request.reasonCode,
								outcome: request.outcome ?? (request.action === 'remove' ? 'writtenOff' : null),
								hsnCode: fact.hsnCode,
								valueINR: done.valueINR,
							},
							number as string,
							context,
							actor,
						)
					: undefined;
				const next: AdjustmentRequest = {
					...request,
					status: 'applied',
					decidedBy: actor,
					decidedByName: name,
					decidedAt: now,
					valueAtCostINR: request.action === 'remove' ? done.valueINR : request.valueAtCostINR,
					...posting,
					applied: { onHandBefore: done.onHandBefore, onHandAfter: done.onHandAfter, layers: done.layers },
				};
				await this.requests.save(next, null, context);
				await this.support.record(
					{
						actor,
						action: 'stock.adjustment.approve',
						entityType: 'stock_adjustment',
						entityId: request.id,
						text: `${name} approved ${requester}'s ${request.action === 'remove' ? 'write-off' : 'addition'} of ${formatQuantity(request.quantity, fact.soldBy)} × ${fact.sku} (${request.reasonCode ? REASON_WORDS[request.reasonCode] : ''}${request.action === 'remove' ? `, ${formatRupees(done.valueINR)}` : ''}). Stock ${formatQuantity(done.onHandBefore, fact.soldBy)} → ${formatQuantity(done.onHandAfter, fact.soldBy)}.`,
					},
					context,
				);
				return next;
			})
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse('stock_moved_meanwhile', 'Stock changed meanwhile. Reload and decide again.');
				}
				throw error;
			});
		await this.writer.refreshShop([fact.productId]);
		return decided;
	}

	async reject(
		id: string,
		reason: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<AdjustmentRequest> {
		const actor = actorOf(principal);
		const text = reason.trim();
		if (text.length < 3)
			throw refuse('reason_required', 'Say why, so the requester knows what to do next.', 'reason');
		const request = await this.pending(id, actor);
		const name = await this.support.nameOf(actor);
		const requester = request.requestedByName ?? (await this.support.nameOf(request.requestedBy));
		const next: AdjustmentRequest = {
			...request,
			status: 'rejected',
			decidedBy: actor,
			decidedByName: name,
			decidedAt: new Date().toISOString(),
			rejectReason: text,
		};
		await this.support.inTransaction(async (context) => {
			await this.requests.save(next, null, context);
			if (request.kind === 'count' && request.countId) await this.counts.reopen(request.countId, actor, context);
			await this.support.record(
				{
					actor,
					action: 'stock.adjustment.reject',
					entityType: request.kind === 'count' ? 'stock_count' : 'stock_adjustment',
					entityId: request.kind === 'count' && request.countId ? request.countId : request.id,
					text:
						request.kind === 'count'
							? `${name} rejected ${requester}'s count ${request.countNumber}: "${text}"`
							: `${name} rejected ${requester}'s ${request.action === 'remove' ? 'write-off' : 'addition'} of ${request.quantity} × ${request.sku}: "${text}"`,
				},
				context,
			);
		});
		return next;
	}
}
