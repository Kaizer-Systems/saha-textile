import type { PurchaseReturn } from '@saha-textile/contracts';

/**
 * Words shared by the purchasing screens: one place decides how a document's state reads, so the
 * list, the supplier page and the document itself always say the same thing.
 */

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Metres from whole tenths, in the reader's words: "42.5 m", "42.5 মি." (English digits, BN-3). */
export function metresText(tenths: number, t: Translate): string {
	return t('unit_metres', { value: (tenths / 10).toFixed(1) });
}

/** A stock quantity: pieces as a bare number, metres with their unit. */
export function quantityText(units: number, soldBy: 'piece' | 'metre', t: Translate): string {
	return soldBy === 'metre' ? metresText(units, t) : String(units);
}

/**
 * "6 pieces", or "6 pieces and 12.5 m" when a document mixes both; `count` picks the plural form
 * and `lang` joins the parts the reader's way (Intl.ListFormat, en-IN: no comma before "and").
 */
export function linesQuantity(
	lines: ReadonlyArray<{ quantity: number; soldBy: 'piece' | 'metre' }>,
	count: (key: string, n: number) => string,
	t: Translate,
	lang: string,
): string {
	const pieces = piecesOf(lines);
	const tenths = lines.filter((line) => line.soldBy === 'metre').reduce((sum, line) => sum + line.quantity, 0);
	const parts: string[] = [];
	if (pieces || !tenths) parts.push(count('qty_pieces', pieces));
	if (tenths) parts.push(metresText(tenths, t));
	return new Intl.ListFormat(lang === 'en' ? 'en-IN' : lang, { type: 'conjunction' }).format(parts);
}

/** Pieces only, for the Pieces column (metres are not pieces). */
export function piecesOf(lines: ReadonlyArray<{ quantity: number; soldBy: 'piece' | 'metre' }>): number {
	return lines.filter((line) => line.soldBy === 'piece').reduce((sum, line) => sum + line.quantity, 0);
}

/** A return's pill: Draft, Sent · waiting for credit note, Settled · how (r01). */
export function returnStatus(ret: PurchaseReturn, t: Translate): { pill: string; label: string } {
	if (ret.status === 'draft') return { pill: 'draft', label: t('pr_status_draft') };
	if (ret.status === 'sent') {
		return ret.settledINR > 0
			? { pill: 'pending', label: t('pr_status_part_settled') }
			: { pill: 'processing', label: t('pr_status_waiting') };
	}
	const last = ret.settlements.at(-1);
	const how = last ? t(`settled_how_${last.how}`) : '';
	const reference = last?.how === 'credit_note' && last.reference ? ` ${last.reference}` : '';
	return { pill: 'completed', label: t('pr_status_settled_how', { how: `${how}${reference}` }) };
}

/** Why a return was made, with where it came from when it was made by itself (r01). */
export function returnWhy(ret: PurchaseReturn, t: Translate): string {
	const reason = t(`pr_reason_${ret.reason}`);
	return ret.origin === 'goods_check' ? `${reason} · ${t('pr_made_by_goods_check')}` : reason;
}
