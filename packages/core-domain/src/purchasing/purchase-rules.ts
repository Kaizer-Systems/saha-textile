import { addDays, daysBetween } from './fiscal-year';

/**
 * What a purchase entry, order or payment may do next, and why not. Pure rules: the API
 * supplies what it read, these say yes or give the reasons, each as a code the admin
 * translates.
 */

export type EntryProblemCode =
	| 'no_lines'
	| 'blocked_product'
	| 'duplicate_bill'
	| 'books_closed'
	| 'wrong_status'
	| 'total_mismatch'
	| 'printed_total_missing'
	| 'goods_check_sum'
	| 'goods_check_reason'
	| 'goods_check_missing_line'
	| 'same_person'
	| 'warnings_changed'
	| 'stale_version'
	| 'nothing_into_stock';

export interface EntryProblem {
	code: EntryProblemCode;
	lineId?: string | null;
	detail: string;
}

/** Days a bill may sit after its goods arrived before the dates look wrong (edge cases list). */
export const RECEIVED_BEFORE_BILL_WARN_DAYS = 30;

/** Dates that are allowed but look wrong: a bill dated in the future, goods long before the bill. */
export function entryDateWarnings(input: {
	billDate: string;
	goodsReceivedOn: string;
	today: string;
}): Array<{ code: 'bill_in_future' | 'date_order'; detail: string }> {
	const warnings: Array<{ code: 'bill_in_future' | 'date_order'; detail: string }> = [];
	if (input.billDate > input.today)
		warnings.push({ code: 'bill_in_future', detail: 'The bill is dated in the future.' });
	if (daysBetween(input.goodsReceivedOn, input.billDate) > RECEIVED_BEFORE_BILL_WARN_DAYS) {
		warnings.push({
			code: 'date_order',
			detail: `Goods were received more than ${RECEIVED_BEFORE_BILL_WARN_DAYS} days before the bill date.`,
		});
	}
	return warnings;
}

/** P9: nothing may be dated on or before the books-closed day. */
export function booksClosedProblem(dates: readonly string[], booksClosedUpTo: string | null): EntryProblem | null {
	if (!booksClosedUpTo) return null;
	const early = dates.find((day) => day <= booksClosedUpTo);
	return early
		? { code: 'books_closed', detail: `Books are closed up to ${booksClosedUpTo}; ${early} falls inside them.` }
		: null;
}

/** P1: a step that must be done by someone other than whoever did the step before. */
export function samePersonProblem(input: {
	required: boolean;
	actorId: string | null;
	previousActorId: string | null;
	step: 'check' | 'post' | 'payment';
}): EntryProblem | null {
	if (!input.required || !input.actorId || !input.previousActorId) return null;
	if (input.actorId !== input.previousActorId) return null;
	const before =
		input.step === 'check' ? 'made the draft' : input.step === 'post' ? 'checked the goods' : 'posted the entry';
	return {
		code: 'same_person',
		detail: `Someone other than the person who ${before} must do this step (Settings › Purchases and stock).`,
	};
}

export interface GoodsCheckLine {
	lineId: string;
	quantity: number;
}

export interface GoodsCheckInput {
	lineId: string;
	accepted: number;
	damaged: number;
	missing: number;
	damageReason: string | null;
}

/** p08: good + damaged + missing must equal what the bill says, and damage needs a reason. */
export function goodsCheckProblems(
	lines: readonly GoodsCheckLine[],
	check: readonly GoodsCheckInput[],
): EntryProblem[] {
	const problems: EntryProblem[] = [];
	const byId = new Map(check.map((row) => [row.lineId, row]));
	for (const line of lines) {
		const row = byId.get(line.lineId);
		if (!row) {
			problems.push({
				code: 'goods_check_missing_line',
				lineId: line.lineId,
				detail: 'This line has not been counted.',
			});
			continue;
		}
		if (row.accepted + row.damaged + row.missing !== line.quantity) {
			problems.push({
				code: 'goods_check_sum',
				lineId: line.lineId,
				detail: `Good, damaged and missing add up to ${row.accepted + row.damaged + row.missing}; the bill says ${line.quantity}.`,
			});
		}
		if (row.damaged > 0 && !row.damageReason) {
			problems.push({
				code: 'goods_check_reason',
				lineId: line.lineId,
				detail: 'Say what is wrong with the damaged pieces.',
			});
		}
	}
	if (check.length > 0 && check.every((row) => row.accepted === 0)) {
		problems.push({
			code: 'nothing_into_stock',
			lineId: null,
			detail: 'Nothing on this bill is good: send it all back with a purchase return instead.',
		});
	}
	return problems;
}

/** The due date from the bill date and the supplier's terms. */
export function entryDueOn(billDate: string, paymentTermsDays: number): string {
	return addDays(billDate, paymentTermsDays);
}

export function paymentStatusOf(totalINR: number, paidINR: number): 'unpaid' | 'part_paid' | 'paid' {
	if (paidINR <= 0) return 'unpaid';
	return paidINR + 0.005 >= totalINR ? 'paid' : 'part_paid';
}

/**
 * A purchase order's state from what has arrived against it. Cancelled and closed-short orders
 * keep their state; an order closes itself when every line has arrived.
 */
export function purchaseOrderStatusOf(input: {
	current: 'draft' | 'sent' | 'part_received' | 'received' | 'closed_short' | 'cancelled';
	lines: ReadonlyArray<{ quantity: number; receivedQuantity: number }>;
}): 'draft' | 'sent' | 'part_received' | 'received' | 'closed_short' | 'cancelled' {
	if (input.current === 'cancelled' || input.current === 'closed_short' || input.current === 'draft')
		return input.current;
	const received = input.lines.reduce((sum, line) => sum + Math.min(line.receivedQuantity, line.quantity), 0);
	const ordered = input.lines.reduce((sum, line) => sum + line.quantity, 0);
	if (ordered > 0 && received >= ordered) return 'received';
	if (received > 0) return 'part_received';
	return 'sent';
}

/** Whether an order is late: past its expected day with something still to come. */
export function purchaseOrderLate(input: { status: string; expectedBy: string; today: string }): boolean {
	return (input.status === 'sent' || input.status === 'part_received') && input.expectedBy < input.today;
}

export interface VoidLayerFact {
	sku: string;
	received: number;
	remaining: number;
	/** Of what left the layer: sold, returned to the supplier, written off. */
	sold: number;
	returned: number;
	documents: string[];
}

/**
 * p12: an entry can be voided only while every piece it brought in is still on the shelf
 * untouched — nothing sold, reserved, returned or written off — and no payment stands against it.
 */
export function voidBlockers(input: {
	status: 'draft' | 'checked' | 'posted' | 'void';
	layers: readonly VoidLayerFact[];
	reservedBySku: Readonly<Record<string, number>>;
	activePayments: number;
	sentReturns: number;
}): {
	blocked: boolean;
	reason: 'wrong_status' | 'stock_moved' | 'payments' | 'returns' | null;
	lines: Array<{ sku: string; soldUnits: number; reservedUnits: number; returnedUnits: number; documents: string[] }>;
} {
	if (input.status !== 'posted') return { blocked: true, reason: 'wrong_status', lines: [] };
	const lines = input.layers
		.map((layer) => ({
			sku: layer.sku,
			soldUnits: layer.sold,
			reservedUnits: input.reservedBySku[layer.sku] ?? 0,
			returnedUnits: layer.returned,
			documents: layer.documents,
		}))
		.filter((line) => line.soldUnits + line.reservedUnits + line.returnedUnits > 0);
	if (lines.length > 0) return { blocked: true, reason: 'stock_moved', lines };
	const untouched = input.layers.every((layer) => layer.remaining === layer.received);
	if (!untouched) return { blocked: true, reason: 'stock_moved', lines: [] };
	if (input.sentReturns > 0) return { blocked: true, reason: 'returns', lines: [] };
	if (input.activePayments > 0) return { blocked: true, reason: 'payments', lines: [] };
	return { blocked: false, reason: null, lines: [] };
}

/**
 * The supplier's bill number as the duplicate check compares it: upper-case letters and
 * digits only, every separator ignored ("BSW/2026-27/0418", "bsw 2026 27 0418" and
 * "BSW-2026-27-0418" are the same bill). Leading zeros stay: "0418" and "418" can differ.
 */
export function normalizeBillNumber(value: string): string {
	return value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
