import type { EditLogEntry } from '@saha-textile/contracts';

/** One row of the Q11 edit log table, in words. */
export interface EditLogRow {
	when: string;
	who: string;
	what: string;
	field: string;
	before: string;
	after: string;
	why: string;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

const DASH = '—';
const text = (value: unknown): string => (value === null || value === undefined || value === '' ? DASH : String(value));

/** "25 Nov 10:41", as Q11 draws it. */
export function logWhen(iso: string): string {
	const at = new Date(iso);
	const day = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	return `${day} ${time}`;
}

/** A field as Q11 names it: `quantity:Cotton Handloom Saree` → "Cotton Handloom Saree · qty". */
function fieldName(field: string, t: Translate): string {
	if (field.startsWith('quantity:')) return `${field.slice('quantity:'.length)} · ${t('log_field_qty')}`;
	return t(`log_field_${field}`);
}

/** What the system posted at Issue: "Stock +1 BAN-3 · output tax −₹222.86 · refund due ₹4,680". */
function posted(metadata: Record<string, unknown>, t: Translate, inr: (value: number) => string): string {
	const stock = (metadata['stock'] as { sku: string; quantity: number }[]).map((s) => `+${s.quantity} ${s.sku}`);
	const inputTax = Number(metadata['inputTaxINR']);
	return [
		...(stock.length ? [t('log_posted_stock', { items: stock.join(', ') })] : []),
		t('log_posted_tax', { amount: inr(Number(metadata['outputTaxINR'])) }),
		...(inputTax > 0 ? [t('log_posted_input_tax', { amount: inr(inputTax) })] : []),
		t(`log_posted_refund_${String(metadata['refund'])}`, { amount: inr(Number(metadata['totalINR'])) }),
	].join(' · ');
}

/**
 * The audit rows of one document as Q11's table: one row per changed field, the person's role beside their name
 * the first time they appear, and the system's own rows as "System".
 */
export function editLogRows(
	entries: readonly EditLogEntry[],
	t: Translate,
	inr: (value: number) => string,
): EditLogRow[] {
	const named = new Set<string>();
	const rows: EditLogRow[] = [];
	for (const entry of entries) {
		let who = entry.who ?? t('log_system');
		if (entry.who && entry.role && !named.has(entry.who)) who = `${entry.who} (${entry.role})`;
		if (entry.who) named.add(entry.who);
		const base = { when: logWhen(entry.at), who, field: DASH, before: DASH, after: DASH, why: DASH };
		const m = entry.metadata;
		switch (entry.action) {
			case 'creditNote.draft':
				rows.push({
					...base,
					what: t('log_drafted'),
					after: m['from']
						? t('log_from_return', { number: m['from'] })
						: t(`cn_kind_${String(m['kind'] ?? 'goods_returned')}`),
				});
				break;
			case 'creditNote.save':
				if (!entry.diffs.length) rows.push({ ...base, what: t('log_saved') });
				for (const diff of entry.diffs)
					rows.push({
						...base,
						what: t('log_edited'),
						field: fieldName(diff.field, t),
						before: text(diff.before),
						after: text(diff.after),
					});
				break;
			case 'creditNote.issue':
				rows.push({ ...base, what: t('log_issued'), field: t('log_field_number'), after: text(m['number']) });
				break;
			case 'creditNote.posted':
				rows.push({ ...base, what: t('log_posted'), field: t('log_field_books'), after: posted(m, t, inr) });
				break;
			case 'creditNote.print':
			case 'orderReturn.print':
				rows.push({ ...base, what: t('log_printed'), after: 'PDF' });
				break;
			case 'creditNote.cancel_refused':
				rows.push({
					...base,
					what: t('log_tried_cancel'),
					after: t('log_refused', {
						why: (m['why'] as string[]).map((w) => t(`log_refused_${w}`)).join(', '),
					}),
				});
				break;
			case 'creditNote.cancel':
				rows.push({ ...base, what: t('log_cancelled'), why: text(m['reason']) });
				break;
			case 'creditNote.refund':
				rows.push({
					...base,
					what: t('log_refunded'),
					field: t('log_field_refund'),
					after: text(m['reference']),
				});
				break;
			case 'debitNote.issue':
				rows.push({
					...base,
					what: t('log_debit_note'),
					field: t('log_field_number'),
					after: text(m['number']),
					why: text(m['reason']),
				});
				break;
			case 'document.lock.take_over': {
				const holder = entry.diffs[0];
				rows.push({
					...base,
					what: t('log_took_over'),
					before: text(holder?.before),
					after: text(holder?.after),
				});
				break;
			}
			case 'document.lock.ask_release':
				rows.push({ ...base, what: t('log_asked_release') });
				break;
			default:
				rows.push({ ...base, what: entry.action });
		}
	}
	return rows;
}
