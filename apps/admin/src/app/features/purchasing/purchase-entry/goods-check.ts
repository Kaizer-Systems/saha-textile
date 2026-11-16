import type { DamageReason, PurchaseEntry, PurchaseEntryLine, PurchaseGoodsCheck } from '@saha-textile/contracts';

/** One line of the count (p08, g01): good + damaged + missing must equal what the bill says. */
export interface CountLine {
	line: PurchaseEntryLine;
	good: number;
	damaged: number;
	missing: number;
	reason: DamageReason;
	note: string;
	photos: Array<{ assetId: string; name: string }>;
}

export function countFrom(entry: PurchaseEntry): CountLine[] {
	return entry.lines.map((line) => ({
		line,
		good: line.accepted ?? line.quantity,
		damaged: line.damaged,
		missing: line.missing,
		reason: line.damageReason ?? 'damaged_on_arrival',
		note: line.damageNote ?? '',
		photos: line.damagePhotoAssetIds.map((assetId) => ({ assetId, name: assetId })),
	}));
}

/**
 * Changing one number keeps the line adding up: damaged or missing come off "good"; a new "good"
 * leaves the rest missing. A number can never go below zero or above what the bill says.
 */
export function adjust(count: CountLine, field: 'good' | 'damaged' | 'missing', value: number): CountLine {
	const quantity = count.line.quantity;
	const v = Math.max(0, Math.min(quantity, Math.round(Number.isFinite(value) ? value : 0)));
	if (field === 'good') {
		const damaged = Math.min(count.damaged, quantity - v);
		return { ...count, good: v, damaged, missing: quantity - v - damaged };
	}
	if (field === 'damaged') {
		const missing = Math.min(count.missing, quantity - v);
		return { ...count, damaged: v, missing, good: quantity - v - missing };
	}
	const damaged = Math.min(count.damaged, quantity - v);
	return { ...count, missing: v, damaged, good: quantity - v - damaged };
}

/** Why a line can't be saved yet (a translation key), or null. */
export function countProblem(count: CountLine): string | null {
	if (count.good + count.damaged + count.missing !== count.line.quantity) return 'count_must_add_up';
	if (count.damaged > 0 && count.reason === 'other' && !count.note.trim()) return 'count_note_for_other';
	return null;
}

export function countBody(lines: readonly CountLine[], version: number): PurchaseGoodsCheck {
	return {
		lines: lines.map((count) => ({
			lineId: count.line.lineId,
			accepted: count.good,
			damaged: count.damaged,
			missing: count.missing,
			damageReason: count.damaged > 0 ? count.reason : null,
			damageNote: count.damaged > 0 ? count.note.trim() || null : null,
			damagePhotoAssetIds: count.damaged > 0 ? count.photos.map((photo) => photo.assetId) : [],
		})),
		version,
	};
}

/** Totals for the side card and the button (p08): what goes in, what goes back, what never came. */
export function countTotals(lines: readonly CountLine[]) {
	const pick = (value: (count: CountLine) => number) =>
		lines.map((count) => ({ quantity: value(count), soldBy: count.line.soldBy }));
	return {
		onBill: pick((count) => count.line.quantity),
		intoStock: pick((count) => count.good),
		back: pick((count) => count.damaged),
		missing: pick((count) => count.missing),
		anyBack: lines.some((count) => count.damaged > 0),
		anyMissing: lines.some((count) => count.missing > 0),
		nothingIn: lines.every((count) => count.good === 0),
	};
}

/** A scanned or typed code jumps to the line with that SKU or the supplier's own code. */
export function lineForCode(lines: readonly CountLine[], code: string): number {
	const wanted = code.trim().toUpperCase();
	return lines.findIndex(
		(count) => count.line.sku.toUpperCase() === wanted || count.line.supplierItemCode?.toUpperCase() === wanted,
	);
}
