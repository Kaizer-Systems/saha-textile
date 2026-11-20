import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { NumberedDocumentType } from '@saha-textile/contracts';
import {
	fiscalYearOf,
	istDay,
	orderSeriesKey,
	renderChildNumber,
	renderRandomOrderNumber,
	renderSequencedOrderNumber,
	renderSeriesNumber,
	type DocumentNumberingRepository,
	type NumberAllocatorPort,
	type TransactionContext,
} from '@saha-textile/core-domain';

import { DOCUMENT_NUMBERING_REPOSITORY, NUMBER_ALLOCATOR } from '../infra/tokens';

/**
 * Issues document numbers (`DocumentNumberingPolicy`, `DEC-NUMBERING`). A number is taken only
 * inside the save that posts the document, so a draft or a failed save never uses one up; the
 * first number a series issues locks its format. The purchases module's counters keep their
 * series names (PE, PO, OS, DN, DC, SC) so each type has exactly one series.
 */
const PURCHASE_COUNTERS: Partial<Record<NumberedDocumentType, string>> = {
	purchaseEntry: 'PE',
	purchaseOrder: 'PO',
	openingStock: 'OS',
	stockCount: 'SC',
	debitNote: 'DN',
	deliveryChallan: 'DC',
};

@Injectable()
export class DocumentNumbersService {
	constructor(
		@Inject(DOCUMENT_NUMBERING_REPOSITORY) private readonly numbering: DocumentNumberingRepository,
		@Inject(NUMBER_ALLOCATOR) private readonly allocator: NumberAllocatorPort,
	) {}

	/** The next number of a series type, taken inside the caller's transaction. */
	async issue(type: NumberedDocumentType, context?: TransactionContext, at = new Date()): Promise<string> {
		const settings = await this.numbering.get();
		const format = settings.series[type];
		const financialYear = fiscalYearOf(istDay(at));
		const counter = PURCHASE_COUNTERS[type] ?? `doc:${type}`;
		const period = format.reset === 'fy' ? financialYear : 'all';
		const sequence = await this.allocator.next(counter, period, context);
		if (!settings.lockedTypes.includes(type)) await this.numbering.lock(type, context);
		return renderSeriesNumber(format, financialYear, sequence);
	}

	/**
	 * A new order number in the current format (OD18 still open: the interim format is the brief's
	 * recommendation). Random numbers are checked for uniqueness by the order's unique index; the
	 * caller retries on a clash.
	 */
	async orderNumber(context?: TransactionContext, at = new Date()): Promise<string> {
		const settings = await this.numbering.get();
		const format = settings.order;
		if (format.kind === 'randomGroups') return renderRandomOrderNumber(format, () => randomInt(0, 10));
		const financialYear = fiscalYearOf(istDay(at));
		const key = orderSeriesKey(format, financialYear);
		const sequence = await this.allocator.next(key?.series ?? 'doc:order', key?.period ?? 'all', context);
		return renderSequencedOrderNumber(format, financialYear, sequence);
	}

	/** `ST-48213-90761/P1`, `/R1`, `/Q1`: the nth child of an order. */
	async childNumber(
		kind: 'parcel' | 'return' | 'paymentRequest',
		orderNumber: string,
		sequence: number,
	): Promise<string> {
		const settings = await this.numbering.get();
		return renderChildNumber(orderNumber, settings[kind], sequence);
	}
}
