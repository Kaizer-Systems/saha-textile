import { formatRupees, fromPaise, roundPaise, roundUnitCost, toPaise, type SoldBy } from './money';

/**
 * The arithmetic of one supplier bill (p06): line taxable values and GST, the freight share,
 * the cost each piece goes into stock at, the margin against today's selling price, and the
 * bill total the paper must match.
 *
 * Rules (owner, 2026-11-15, P5 and P6; sent to the CA as round-2 D15.5 and D15.6):
 *   - a regular supplier's GST is claimable, so cost goes into stock BEFORE GST; composition and
 *     unregistered suppliers charge none and the full price is the cost;
 *   - freight on the bill is shared across lines by taxable value and becomes part of each
 *     piece's cost; a line marked free on the bill gets no share and costs nothing;
 *   - quantities are stock units: pieces, or tenths of a metre; prices on the bill are per piece
 *     or per metre, so a metre line bills `units / 10` metres.
 */

export type PurchaseTaxType = 'intra_state' | 'inter_state' | 'none';

export interface EntryMathLineInput {
	lineId: string;
	soldBy: SoldBy;
	quantity: number;
	unitPriceINR: number;
	freeOnBill: boolean;
	gstRatePct: number;
	sellingPriceINR: number;
	/** The last bill's price before GST for this item, per piece or metre. */
	lastPriceINR: number | null;
	hsnOnBill: string | null;
	productHsn: string | null;
	disabled: boolean;
	notOrdered: boolean;
}

export interface EntryMathInput {
	taxType: PurchaseTaxType;
	pricesIncludeGst: boolean;
	freightINR: number;
	freightGstRatePct: number;
	roundOffINR: number;
	printedTotalINR: number | null;
	/** Regular supplier: cost into stock before GST (P5). */
	itcClaimable: boolean;
	lines: readonly EntryMathLineInput[];
	priceChangeWarnPct: number;
	marginFloorPct: number;
}

export interface EntryMathLine {
	lineId: string;
	taxableINR: number;
	taxINR: number;
	cgstINR: number;
	sgstINR: number;
	igstINR: number;
	lineTotalINR: number;
	freightShareINR: number;
	/** Cost into stock per piece or per metre (what the screen shows). */
	unitCostINR: number;
	/** Cost into stock per stock unit (per piece, or per tenth of a metre): what cost layers hold. */
	unitCostPerStockUnitINR: number;
	/** The bill's price before GST per piece or metre (what the next bill compares with). */
	unitPriceExGstINR: number;
	marginPct: number | null;
}

export interface EntryMathWarning {
	code: 'price_jump' | 'margin_floor' | 'hsn_mismatch' | 'disabled_product' | 'not_ordered';
	lineId: string;
	detail: string;
	values: Record<string, string | number | null>;
}

export interface EntryMathResult {
	lines: EntryMathLine[];
	totals: {
		linesINR: number;
		freightINR: number;
		taxableINR: number;
		cgstINR: number;
		sgstINR: number;
		igstINR: number;
		roundOffINR: number;
		totalINR: number;
		printedTotalINR: number | null;
		matchesPrinted: boolean;
		differenceINR: number;
		pieces: number;
		costIntoStockINR: number;
	};
	warnings: EntryMathWarning[];
}

/** The bill may differ from the lines by a rupee of rounding at most (p02). */
export const BILL_TOTAL_TOLERANCE_INR = 1;

/** How many priced units a line bills: pieces, or metres for a metre line. */
export function billedUnits(quantity: number, soldBy: SoldBy): number {
	return soldBy === 'metre' ? quantity / 10 : quantity;
}

/** Splits a tax amount into CGST and SGST halves that add back to it exactly. */
function splitIntraState(taxPaise: number): { cgst: number; sgst: number } {
	const cgst = Math.round(taxPaise / 2);
	return { cgst, sgst: taxPaise - cgst };
}

/** Shares `amount` paise across `weights` so the parts add up exactly (largest remainder). */
export function shareByWeight(amountPaise: number, weights: readonly number[]): number[] {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	if (amountPaise === 0 || total <= 0) return weights.map(() => 0);
	const raw = weights.map((weight) => (amountPaise * weight) / total);
	const floors = raw.map((value) => Math.floor(value));
	let left = amountPaise - floors.reduce((sum, value) => sum + value, 0);
	const order = raw
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
	for (const { index } of order) {
		if (left <= 0) break;
		// `order` holds the indexes of `raw`, which `floors` matches one for one.
		floors[index] = (floors[index] as number) + 1;
		left -= 1;
	}
	return floors;
}

/** Taxable value and tax of a gross amount, whether the bill printed it before or including GST. */
function taxOf(
	grossPaise: number,
	ratePct: number,
	includesGst: boolean,
	taxType: PurchaseTaxType,
): { taxable: number; tax: number } {
	if (taxType === 'none' || ratePct === 0) return { taxable: grossPaise, tax: 0 };
	if (includesGst) {
		const taxable = roundPaise(grossPaise / (1 + ratePct / 100));
		return { taxable, tax: grossPaise - taxable };
	}
	return { taxable: grossPaise, tax: roundPaise((grossPaise * ratePct) / 100) };
}

export function computePurchaseEntry(input: EntryMathInput): EntryMathResult {
	const base = input.lines.map((line) => {
		const gross = line.freeOnBill
			? 0
			: roundPaise(billedUnits(line.quantity, line.soldBy) * toPaise(line.unitPriceINR));
		return { line, ...taxOf(gross, line.gstRatePct, input.pricesIncludeGst, input.taxType) };
	});

	const freightGross = toPaise(input.freightINR);
	const freight = taxOf(freightGross, input.freightGstRatePct, input.pricesIncludeGst, input.taxType);
	const shares = shareByWeight(
		freight.taxable,
		base.map((entry) => (entry.line.freeOnBill ? 0 : entry.taxable)),
	);
	const shareTaxes = shareByWeight(
		freight.tax,
		base.map((entry) => (entry.line.freeOnBill ? 0 : entry.taxable)),
	);

	const lines: EntryMathLine[] = base.map((entry, index) => {
		const { line } = entry;
		// shareByWeight gives one share per weight, and the weights are `base`, line for line.
		const share = shares[index] as number;
		const shareTax = shareTaxes[index] as number;
		const split = input.taxType === 'intra_state' ? splitIntraState(entry.tax) : { cgst: 0, sgst: 0 };
		const costPaise = input.itcClaimable ? entry.taxable + share : entry.taxable + entry.tax + share + shareTax;
		const priced = billedUnits(line.quantity, line.soldBy);
		const unitCost = priced > 0 ? roundUnitCost(costPaise / 100 / priced) : 0;
		const unitCostPerStockUnit = line.quantity > 0 ? roundUnitCost(costPaise / 100 / line.quantity) : 0;
		const unitPriceExGst = priced > 0 ? roundUnitCost(entry.taxable / 100 / priced) : 0;
		const sellingExGst = line.sellingPriceINR / (1 + line.gstRatePct / 100);
		const margin =
			line.sellingPriceINR > 0 && !line.freeOnBill
				? Math.round(((sellingExGst - unitCost) / sellingExGst) * 1000) / 10
				: null;
		return {
			lineId: line.lineId,
			taxableINR: fromPaise(entry.taxable),
			taxINR: fromPaise(entry.tax),
			cgstINR: fromPaise(split.cgst),
			sgstINR: fromPaise(split.sgst),
			igstINR: input.taxType === 'inter_state' ? fromPaise(entry.tax) : 0,
			lineTotalINR: fromPaise(entry.taxable + entry.tax),
			freightShareINR: fromPaise(share),
			unitCostINR: unitCost,
			unitCostPerStockUnitINR: unitCostPerStockUnit,
			unitPriceExGstINR: unitPriceExGst,
			marginPct: margin,
		};
	});

	const linesTaxable = base.reduce((sum, entry) => sum + entry.taxable, 0);
	const linesTax = base.reduce((sum, entry) => sum + entry.tax, 0);
	const taxable = linesTaxable + freight.taxable;
	const tax = linesTax + freight.tax;
	const freightSplit = input.taxType === 'intra_state' ? splitIntraState(freight.tax) : { cgst: 0, sgst: 0 };
	const cgst = lines.reduce((sum, line) => sum + toPaise(line.cgstINR), 0) + freightSplit.cgst;
	const sgst = lines.reduce((sum, line) => sum + toPaise(line.sgstINR), 0) + freightSplit.sgst;
	const igst = input.taxType === 'inter_state' ? tax : 0;
	const roundOff = toPaise(input.roundOffINR);
	const total = taxable + tax + roundOff;
	const printed = input.printedTotalINR === null ? null : toPaise(input.printedTotalINR);
	const difference = printed === null ? 0 : printed - total;
	// `lines` is `input.lines` mapped one for one, so every line has its input.
	const costIntoStock = lines.reduce(
		(sum, line, index) =>
			sum + roundPaise(line.unitCostPerStockUnitINR * 100 * (input.lines[index] as EntryMathLineInput).quantity),
		0,
	);

	return {
		lines,
		totals: {
			linesINR: fromPaise(linesTaxable),
			freightINR: fromPaise(freight.taxable),
			taxableINR: fromPaise(taxable),
			cgstINR: fromPaise(cgst),
			sgstINR: fromPaise(sgst),
			igstINR: fromPaise(igst),
			roundOffINR: fromPaise(roundOff),
			totalINR: fromPaise(total),
			printedTotalINR: printed === null ? null : fromPaise(printed),
			matchesPrinted: printed !== null && Math.abs(difference) <= BILL_TOTAL_TOLERANCE_INR * 100,
			differenceINR: fromPaise(difference),
			pieces: input.lines.filter((line) => line.soldBy === 'piece').reduce((sum, line) => sum + line.quantity, 0),
			costIntoStockINR: fromPaise(costIntoStock),
		},
		warnings: entryWarnings(input, lines),
	};
}

/** Warnings never block posting; whoever posts accepts them and the entry's activity says so. */
function entryWarnings(input: EntryMathInput, lines: readonly EntryMathLine[]): EntryMathWarning[] {
	const warnings: EntryMathWarning[] = [];
	input.lines.forEach((line, index) => {
		// `lines` is `input.lines` mapped one for one.
		const math = lines[index] as EntryMathLine;
		if (line.disabled) {
			warnings.push({
				code: 'disabled_product',
				lineId: line.lineId,
				detail: 'The product is disabled: it takes stock but the shop does not show it.',
				values: {},
			});
		}
		if (line.notOrdered) {
			warnings.push({
				code: 'not_ordered',
				lineId: line.lineId,
				detail: 'Not on the purchase order.',
				values: {},
			});
		}
		if (!line.freeOnBill && line.lastPriceINR !== null && line.lastPriceINR > 0) {
			const risePct = ((math.unitPriceExGstINR - line.lastPriceINR) / line.lastPriceINR) * 100;
			if (risePct > input.priceChangeWarnPct + 1e-9) {
				warnings.push({
					code: 'price_jump',
					lineId: line.lineId,
					detail: `${Math.round(risePct)}% dearer than last time (${formatRupees(line.lastPriceINR)}).`,
					values: { risePct: Math.round(risePct), lastPriceINR: line.lastPriceINR },
				});
			}
		}
		if (math.marginPct !== null && math.marginPct < input.marginFloorPct) {
			warnings.push({
				code: 'margin_floor',
				lineId: line.lineId,
				detail: `Margin ${Math.round(math.marginPct)}%: under your ${input.marginFloorPct}% floor. Selling price ${formatRupees(line.sellingPriceINR)}.`,
				values: {
					marginPct: Math.round(math.marginPct),
					floorPct: input.marginFloorPct,
					sellingPriceINR: line.sellingPriceINR,
				},
			});
		}
		if (line.hsnOnBill && line.productHsn && line.hsnOnBill !== line.productHsn) {
			warnings.push({
				code: 'hsn_mismatch',
				lineId: line.lineId,
				detail: `Supplier's bill says HSN ${line.hsnOnBill}; this product uses ${line.productHsn}. Check which is right.`,
				values: { hsnOnBill: line.hsnOnBill, productHsn: line.productHsn },
			});
		}
	});
	return warnings;
}

/** Which tax a supplier's bills carry (never typed: from its kind and State). */
export function purchaseTaxType(
	kind: 'regular' | 'composition' | 'unregistered',
	stateCode: string,
	homeStateCode: string,
): PurchaseTaxType {
	if (kind !== 'regular') return 'none';
	return stateCode === homeStateCode ? 'intra_state' : 'inter_state';
}
