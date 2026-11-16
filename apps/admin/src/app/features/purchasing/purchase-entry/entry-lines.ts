import {
	booksClosedProblem,
	computePurchaseEntry,
	entryDateWarnings,
	type EntryMathResult,
	type PurchaseTaxType,
} from '@saha-textile/core-domain/purchasing';

import { parseRupees } from '../shared/payment-popup';
import { parseQuantity } from '../shared/variant-grid';

import type {
	InventorySettings,
	PurchaseEntry,
	PurchaseEntryLine,
	PurchaseEntryLineWrite,
	PurchaseEntryWrite,
	PurchaseItemOption,
	PurchaseWarning,
} from '@saha-textile/contracts';

/** GST rates a bill line can carry; 5% is the example rate until the CA's table (round 2, B2.4). */
export const GST_RATES: readonly number[] = [0, 5, 12, 18, 28];
export const DEFAULT_GST_PCT = 5;

/** One bill line as the entry form holds it while typing (p06). */
export interface EntryFormLine {
	/** A local key: lines added on this screen have no id until saved. */
	key: string;
	lineId?: string;
	variantId: string;
	productId: string;
	sku: string;
	title: string;
	optionsLabel: string;
	soldBy: 'piece' | 'metre';
	imageUrl: string | null;
	supplierItemCode: string | null;
	productHsn: string | null;
	sellingPriceINR: number;
	lastCostINR: number | null;
	/** The entry the last price came from, named in the price warning (p06). */
	lastEntryNumber: string | null;
	disabled: boolean;
	gstRatePct: number;
	hsnOnBill: string;
	quantity: string;
	price: string;
	freeOnBill: boolean;
	purchaseOrderLineId: string | null;
	notOrdered: boolean;
	/** From the purchase order (po04b): ordered and already received. */
	ordered: number | null;
	alreadyReceived: number | null;
}

let counter = 0;
export const newKey = () => `l${Date.now().toString(36)}${(counter += 1)}`;

const units = (value: number, soldBy: 'piece' | 'metre') =>
	soldBy === 'metre' ? (value / 10).toFixed(1) : String(value);

export function lineFromItem(option: PurchaseItemOption, quantity: number | null, price: number | null): EntryFormLine {
	return {
		key: newKey(),
		variantId: option.variantId,
		productId: option.productId,
		sku: option.sku,
		title: option.title,
		optionsLabel: option.optionsLabel,
		soldBy: option.soldBy,
		imageUrl: option.imageUrl,
		supplierItemCode: option.supplierItemCode,
		productHsn: option.hsnCode,
		sellingPriceINR: option.sellingPriceINR,
		lastCostINR: option.lastCostINR,
		lastEntryNumber: option.lastEntryNumber,
		disabled: option.disabled,
		gstRatePct: DEFAULT_GST_PCT,
		hsnOnBill: option.hsnCode ?? '',
		quantity: quantity === null ? '' : units(quantity, option.soldBy),
		price: price !== null ? String(price) : option.lastCostINR !== null ? String(option.lastCostINR) : '',
		freeOnBill: false,
		purchaseOrderLineId: null,
		notOrdered: false,
		ordered: null,
		alreadyReceived: null,
	};
}

export function lineFromEntry(line: PurchaseEntryLine): EntryFormLine {
	return {
		key: line.lineId,
		lineId: line.lineId,
		variantId: line.variantId,
		productId: line.productId,
		sku: line.sku,
		title: line.title,
		optionsLabel: line.optionsLabel,
		soldBy: line.soldBy,
		imageUrl: line.imageUrl,
		supplierItemCode: line.supplierItemCode,
		productHsn: line.productHsn,
		sellingPriceINR: line.sellingPriceINR,
		lastCostINR: line.lastCostINR,
		lastEntryNumber: null,
		disabled: false,
		gstRatePct: line.gstRatePct,
		hsnOnBill: line.hsnOnBill ?? '',
		quantity: units(line.quantity, line.soldBy),
		price: String(line.unitPriceINR),
		freeOnBill: line.freeOnBill,
		purchaseOrderLineId: line.purchaseOrderLineId,
		notOrdered: line.notOrdered,
		ordered: null,
		alreadyReceived: null,
	};
}

/** The line as the API takes it; null when it is not complete yet. */
export function lineWrite(line: EntryFormLine): PurchaseEntryLineWrite | null {
	const quantity = parseQuantity(line.quantity, line.soldBy);
	const price = line.freeOnBill ? 0 : parseRupees(line.price);
	if (!quantity || !('units' in quantity) || quantity.units <= 0 || price === null) return null;
	return {
		...(line.lineId ? { lineId: line.lineId } : {}),
		variantId: line.variantId,
		quantity: quantity.units,
		unitPriceINR: price,
		freeOnBill: line.freeOnBill,
		hsnOnBill: line.hsnOnBill.trim() || null,
		gstRatePct: line.gstRatePct,
		supplierItemCode: line.supplierItemCode,
		purchaseOrderLineId: line.purchaseOrderLineId,
	};
}

/** What is wrong with one line as typed (a translation key), or null. */
export function lineProblem(line: EntryFormLine): string | null {
	const quantity = parseQuantity(line.quantity, line.soldBy);
	if (!quantity) return 'qty_required';
	if ('problem' in quantity) return quantity.problem;
	if (quantity.units <= 0) return 'qty_required';
	if (!line.freeOnBill && parseRupees(line.price) === null) return 'payment_amount_invalid';
	if (line.hsnOnBill.trim() && !/^(\d{4}|\d{6}|\d{8})$/.test(line.hsnOnBill.trim())) return 'hsn_digits';
	return null;
}

export interface EntryHeader {
	taxType: PurchaseTaxType;
	itcClaimable: boolean;
	pricesIncludeGst: boolean;
	freight: string;
	freightGstRatePct: number;
	roundOff: string;
	printedTotal: string;
}

/** The bill worked out in the browser with the API's own arithmetic (p06), so margins and warnings show while typing. */
export function previewEntry(
	header: EntryHeader,
	lines: readonly EntryFormLine[],
	settings: Pick<InventorySettings, 'priceChangeWarnPct' | 'marginFloorPct'>,
): EntryMathResult {
	const ready = lines.filter((line) => lineProblem(line) === null);
	return computePurchaseEntry({
		taxType: header.taxType,
		pricesIncludeGst: header.pricesIncludeGst,
		freightINR: parseRupees(header.freight) ?? 0,
		freightGstRatePct: header.freightGstRatePct,
		roundOffINR: Number(header.roundOff) || 0,
		printedTotalINR: header.printedTotal.trim() ? parseRupees(header.printedTotal) : null,
		itcClaimable: header.itcClaimable,
		priceChangeWarnPct: settings.priceChangeWarnPct,
		marginFloorPct: settings.marginFloorPct,
		lines: ready.map((line) => {
			const write = lineWrite(line) as PurchaseEntryLineWrite;
			return {
				lineId: line.key,
				soldBy: line.soldBy,
				quantity: write.quantity,
				unitPriceINR: write.unitPriceINR,
				freeOnBill: line.freeOnBill,
				gstRatePct: line.gstRatePct,
				sellingPriceINR: line.sellingPriceINR,
				lastPriceINR: line.lastCostINR,
				hsnOnBill: write.hsnOnBill,
				productHsn: line.productHsn,
				disabled: line.disabled,
				notOrdered: line.notOrdered,
			};
		}),
	});
}

/** Date checks the screen shows before saving: books closed (refused) and odd dates (warned), as translation keys. */
export function dateNotes(input: {
	billDate: string;
	goodsReceivedOn: string;
	today: string;
	booksClosedUpTo: string | null;
}): { refusal: { key: string; params: Record<string, string> } | null; warnings: string[] } {
	const closed = booksClosedProblem([input.billDate, input.goodsReceivedOn].filter(Boolean), input.booksClosedUpTo);
	const warnings =
		input.billDate && input.goodsReceivedOn
			? entryDateWarnings({
					billDate: input.billDate,
					goodsReceivedOn: input.goodsReceivedOn,
					today: input.today,
				})
			: [];
	return {
		refusal: closed ? { key: 'books_closed_up_to', params: { date: input.booksClosedUpTo ?? '' } } : null,
		warnings: warnings.map((warning) =>
			warning.code === 'bill_in_future' ? 'bill_dated_in_future' : 'goods_long_before_bill',
		),
	};
}

export function entryWrite(input: {
	supplierId: string;
	purchaseOrderId: string | null;
	billNumber: string;
	billDate: string;
	goodsReceivedOn: string;
	header: EntryHeader;
	billAttachmentAssetId: string | null;
	lines: readonly EntryFormLine[];
	version?: number;
}): PurchaseEntryWrite {
	return {
		supplierId: input.supplierId,
		purchaseOrderId: input.purchaseOrderId,
		billNumber: input.billNumber.trim(),
		billDate: input.billDate,
		goodsReceivedOn: input.goodsReceivedOn,
		pricesIncludeGst: input.header.pricesIncludeGst,
		freightINR: parseRupees(input.header.freight) ?? 0,
		freightGstRatePct: input.header.freightGstRatePct,
		roundOffINR: Math.max(-10, Math.min(10, Number(input.header.roundOff) || 0)),
		printedTotalINR: input.header.printedTotal.trim() ? parseRupees(input.header.printedTotal) : null,
		billAttachmentAssetId: input.billAttachmentAssetId,
		lines: input.lines.map(lineWrite).filter((line): line is PurchaseEntryLineWrite => line !== null),
		...(input.version !== undefined ? { version: input.version } : {}),
	};
}

/** Lines the API sent back after saving keep the screen's own keys, so open inputs stay put. */
export function mergeSaved(entry: PurchaseEntry, previous: readonly EntryFormLine[]): EntryFormLine[] {
	return entry.lines.map((line, index) => {
		const fresh = lineFromEntry(line);
		const before = previous.find((row) => row.lineId === line.lineId) ?? previous[index];
		return before
			? { ...fresh, key: before.key, imageUrl: fresh.imageUrl ?? before.imageUrl, disabled: before.disabled }
			: fresh;
	});
}

/** A warning in the reader's words, from its code and the values the arithmetic gave it (p06). */
export function warningText(
	warning: Pick<PurchaseWarning, 'code' | 'values'>,
	t: (key: string, params?: Record<string, unknown>) => string,
	money: (value: number) => string,
	lastEntry: string | null = null,
): string {
	const v = warning.values;
	switch (warning.code) {
		case 'price_jump':
			return t(lastEntry ? 'warn_price_jump_entry' : 'warn_price_jump', {
				pct: v['risePct'],
				price: money(Number(v['lastPriceINR'] ?? 0)),
				entry: lastEntry,
			});
		case 'margin_floor':
			return t('warn_margin_floor', {
				margin: v['marginPct'],
				floor: v['floorPct'],
				price: money(Number(v['sellingPriceINR'] ?? 0)),
			});
		case 'hsn_mismatch':
			return t('warn_hsn_mismatch', { bill: v['hsnOnBill'], product: v['productHsn'] });
		case 'lookalike_bill':
			return t('warn_lookalike_bill', { bill: v['billNumber'] });
		default:
			return t(`warn_${warning.code}`);
	}
}
