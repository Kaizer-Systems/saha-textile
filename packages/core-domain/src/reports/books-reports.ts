/**
 * Customer and supplier outstanding with ageing (accounts brief U5) and the audit report's categories (U8). Pure.
 */

export interface AgeingBuckets {
	notDue: number;
	days1to30: number;
	days31to60: number;
	days61to90: number;
	over90: number;
	total: number;
}

const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What a party owes, by how long past its due day each amount is on `asAt` (paise). */
export function ageingBuckets(rows: readonly { dueOn: string; duePaise: number }[], asAt: string): AgeingBuckets {
	const out: AgeingBuckets = { notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 };
	for (const row of rows) {
		if (row.duePaise <= 0) continue;
		const late = daysBetween(row.dueOn, asAt);
		const bucket: keyof AgeingBuckets =
			late <= 0
				? 'notDue'
				: late <= 30
					? 'days1to30'
					: late <= 60
						? 'days31to60'
						: late <= 90
							? 'days61to90'
							: 'over90';
		out[bucket] += row.duePaise;
		out.total += row.duePaise;
	}
	return out;
}

export type AuditCategory = 'edits' | 'backdated' | 'cancelled' | 'unlocks' | 'takeovers' | 'superAdmin';

/** The areas whose changes are the books' (U8 "every change across the books"). */
export const BOOKS_AUDIT_PREFIXES: readonly string[] = [
	'accounts.',
	'accounts_template.',
	'bank.',
	'cash.',
	'counter.',
	'creditNote.',
	'debitNote.',
	'document.lock.',
	'edocs.',
	'gst.',
	'paymentVoucher.',
	'purchase.',
	'refundVoucher.',
	'returns.',
	'selfInvoice.',
	'settlement.',
	'stock.',
	'transfer.',
];

const LOCK_RANK: Readonly<Record<string, number>> = { open: 0, closed_for_staff: 1, locked: 2 };

export interface AuditLike {
	actorUserId: string | null;
	action: string;
	createdAt: string;
	diffs: readonly { field: string; before?: unknown; after?: unknown }[];
	metadata: Readonly<Record<string, unknown>>;
}

export function isBooksAudit(entry: Pick<AuditLike, 'action'>): boolean {
	return BOOKS_AUDIT_PREFIXES.some((prefix) => entry.action.startsWith(prefix));
}

/**
 * U8's chips an entry falls under: cancelled (cancel, void, reverse), unlocks (a period lock made looser), take-overs,
 * edits (update, edit, save), backdated (dated before the day it was made), and anything a super admin did.
 */
export function auditCategories(entry: AuditLike, superAdmins: ReadonlySet<string>): AuditCategory[] {
	const out: AuditCategory[] = [];
	const action = entry.action;
	if (/cancel|void|reverse/.test(action)) out.push('cancelled');
	if (
		action.includes('unlock') ||
		(action === 'accounts.period.lock' &&
			entry.diffs.some((d) => (LOCK_RANK[String(d.after)] ?? 0) < (LOCK_RANK[String(d.before)] ?? 0)))
	)
		out.push('unlocks');
	if (action.includes('take_over')) out.push('takeovers');
	if (/\.(update|edit|save)$/.test(action) || action.endsWith('_template.edit')) out.push('edits');
	const dated = entry.metadata['date'];
	if (entry.metadata['backdated'] === true || (typeof dated === 'string' && dated < entry.createdAt.slice(0, 10)))
		out.push('backdated');
	if (entry.actorUserId && superAdmins.has(entry.actorUserId)) out.push('superAdmin');
	return out;
}
