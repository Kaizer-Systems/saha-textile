import { Inject, Injectable } from '@nestjs/common';
import type {
	AdjustmentOutcome,
	AdjustmentPreview,
	AdjustmentRequest,
	InventoryReasonCode,
} from '@saha-textile/contracts';
import {
	adjustmentInputTaxINR,
	gstRateFor,
	reversesInputTax,
	type TransactionContext,
} from '@saha-textile/core-domain';

import { BooksPostingService } from '../ledger/books-posting';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

/** What a write-off or addition carries into its number and the books. */
export interface AdjustmentToPost {
	id: string;
	action: 'remove' | 'add';
	quantity: number;
	reasonCode: InventoryReasonCode | null;
	outcome: AdjustmentOutcome | null;
	hsnCode: string | null;
	valueINR: number;
}

/**
 * Numbered stock adjustments (accounts brief D5, E1, E3): a write-off or addition takes its SA number when it is posted
 * (never while it waits) and goes to the books in one journal voucher, a write-off for a loss taking back its input tax
 * (s.17(5)(h), D9). E1's note shows the numbers it would take, without taking them.
 */
@Injectable()
export class StockAdjustmentBooks {
	constructor(
		@Inject(DocumentNumbersService) private readonly numbers: DocumentNumbersService,
		@Inject(BooksPostingService) private readonly books: BooksPostingService,
	) {}

	/** The item's GST rate at its cost per piece (the rate its purchase carried), or 0 when the HSN has none. */
	private rate(adjustment: Pick<AdjustmentToPost, 'hsnCode' | 'valueINR' | 'quantity'>): number {
		return gstRateFor(adjustment.hsnCode, adjustment.valueINR / adjustment.quantity) ?? 0;
	}

	/** Inside the posting's transaction, before the stock moves: its SA number (the stock ledger row carries it). */
	number(context: TransactionContext, at = new Date()): Promise<string> {
		return this.numbers.issue('stockAdjustment', context, at);
	}

	/** Inside the same transaction, once the stock has moved: the voucher, and the fields the adjustment keeps. */
	async posted(
		adjustment: AdjustmentToPost,
		number: string,
		context: TransactionContext,
		actor: string | null,
		at = new Date(),
	): Promise<Pick<AdjustmentRequest, 'number' | 'outcome' | 'itcReversedINR' | 'journalNumber'>> {
		const { journalNumber, itcINR } = await this.books.stockAdjusted(
			{
				id: adjustment.id,
				number,
				action: adjustment.action,
				outcome: adjustment.outcome,
				reasonCode: adjustment.reasonCode,
				valueINR: adjustment.valueINR,
				ratePercent: this.rate(adjustment),
				at: at.toISOString(),
			},
			context,
			actor,
		);
		return { number, outcome: adjustment.outcome, itcReversedINR: itcINR, journalNumber };
	}

	/** E3 Reverse, inside its transaction: the opposite adjustment's SA number and the voucher reversing the original's. */
	async reversed(
		original: { id: string; number: string },
		reversalId: string,
		context: TransactionContext,
		actor: string | null,
		at = new Date(),
	): Promise<{ number: string; journalNumber: string | null }> {
		const number = await this.numbers.issue('stockAdjustment', context, at);
		const journalNumber = await this.books.stockAdjustmentReversed(
			{
				id: original.id,
				number: original.number,
				reversalId,
				reversalNumber: number,
				at: at.toISOString(),
			},
			context,
			actor,
		);
		return { number, journalNumber };
	}

	/** The next SA number, not taken (E3's Reverse note). */
	nextNumber(at = new Date()): Promise<string> {
		return this.numbers.preview('stockAdjustment', at);
	}

	/** E1's note: the SA number it would take and, once the books are set up, its voucher and the input tax reversed. */
	async preview(adjustment: AdjustmentToPost, at = new Date()): Promise<NonNullable<AdjustmentPreview['posting']>> {
		const number = await this.numbers.preview('stockAdjustment', at);
		if (!(await this.books.willPost())) return { number, itcINR: null, journalNumber: null };
		const itcINR = reversesInputTax(adjustment.action, adjustment.outcome, adjustment.reasonCode)
			? adjustmentInputTaxINR(adjustment.valueINR, this.rate(adjustment))
			: null;
		return { number, itcINR, journalNumber: await this.numbers.preview('journal', at) };
	}
}
