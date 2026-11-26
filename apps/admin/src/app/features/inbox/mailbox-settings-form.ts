import type { MailboxFilter, MailboxFilterWrite } from '@saha-textile/contracts';

/** The filter form (G1): what to match, and what to do, as the screen's boxes hold it. */
export interface FilterForm {
	/** The filter a change replaces; Gmail cannot edit one, so the old is deleted after. */
	replaces: string | null;
	from: string;
	to: string;
	subject: string;
	query: string;
	hasAttachment: boolean;
	skipInbox: boolean;
	markRead: boolean;
	star: boolean;
	important: boolean;
	neverImportant: boolean;
	neverSpam: boolean;
	bin: boolean;
	/** One of the mailbox's own labels to add, or empty. */
	labelId: string;
}

export function emptyFilterForm(): FilterForm {
	return {
		replaces: null,
		from: '',
		to: '',
		subject: '',
		query: '',
		hasAttachment: false,
		skipInbox: false,
		markRead: false,
		star: false,
		important: false,
		neverImportant: false,
		neverSpam: false,
		bin: false,
		labelId: '',
	};
}

/** An existing filter in the form, ready to change. */
export function filterForm(filter: MailboxFilter): FilterForm {
	const adds = new Set(filter.addLabelIds);
	const removes = new Set(filter.removeLabelIds);
	return {
		replaces: filter.id,
		from: filter.criteria.from ?? '',
		to: filter.criteria.to ?? '',
		subject: filter.criteria.subject ?? '',
		query: filter.criteria.query ?? '',
		hasAttachment: Boolean(filter.criteria.hasAttachment),
		skipInbox: removes.has('INBOX'),
		markRead: removes.has('UNREAD'),
		star: adds.has('STARRED'),
		important: adds.has('IMPORTANT'),
		neverImportant: removes.has('IMPORTANT'),
		neverSpam: removes.has('SPAM'),
		bin: adds.has('TRASH'),
		labelId: filter.addLabelIds.find((id) => id.startsWith('Label_') || id.startsWith('CATEGORY_')) ?? '',
	};
}

/** The form as the API takes it; null until it matches something and does something. */
export function filterWrite(form: FilterForm): MailboxFilterWrite | null {
	const criteria = {
		...(form.from.trim() ? { from: form.from.trim() } : {}),
		...(form.to.trim() ? { to: form.to.trim() } : {}),
		...(form.subject.trim() ? { subject: form.subject.trim() } : {}),
		...(form.query.trim() ? { query: form.query.trim() } : {}),
		...(form.hasAttachment ? { hasAttachment: true } : {}),
	};
	const addLabelIds = [
		...(form.star ? ['STARRED'] : []),
		...(form.important ? ['IMPORTANT'] : []),
		...(form.bin ? ['TRASH'] : []),
		...(form.labelId ? [form.labelId] : []),
	];
	const removeLabelIds = [
		...(form.skipInbox ? (['INBOX'] as const) : []),
		...(form.markRead ? (['UNREAD'] as const) : []),
		...(form.neverImportant ? (['IMPORTANT'] as const) : []),
		...(form.neverSpam ? (['SPAM'] as const) : []),
	];
	if (!Object.keys(criteria).length || addLabelIds.length + removeLabelIds.length === 0) return null;
	return { criteria, addLabelIds, removeLabelIds, ...(form.replaces ? { replaces: form.replaces } : {}) };
}

/** What a filter does, as translation keys; a label is named by the mailbox's own label list. */
export function filterActions(
	filter: MailboxFilter,
	labelName: (id: string) => string | null,
): { key: string; params?: Record<string, string> }[] {
	const actions: { key: string; params?: Record<string, string> }[] = [];
	const removes = new Set(filter.removeLabelIds);
	if (removes.has('INBOX')) actions.push({ key: 'inbox_filter_skip_inbox' });
	if (removes.has('UNREAD')) actions.push({ key: 'inbox_filter_mark_read' });
	if (removes.has('IMPORTANT')) actions.push({ key: 'inbox_filter_never_important' });
	if (removes.has('SPAM')) actions.push({ key: 'inbox_filter_never_spam' });
	for (const id of filter.addLabelIds) {
		if (id === 'STARRED') actions.push({ key: 'inbox_filter_star' });
		else if (id === 'IMPORTANT') actions.push({ key: 'inbox_filter_important' });
		else if (id === 'TRASH') actions.push({ key: 'inbox_filter_bin' });
		else actions.push({ key: 'inbox_filter_apply_label', params: { name: labelName(id) ?? id } });
	}
	if (filter.forwardTo) actions.push({ key: 'inbox_filter_forwards', params: { address: filter.forwardTo } });
	return actions;
}

/** What a filter matches, as one line: `from:@courier.in subject:invoice`. */
export function filterMatch(filter: MailboxFilter): string {
	const parts = [
		filter.criteria.from ? `from:${filter.criteria.from}` : '',
		filter.criteria.to ? `to:${filter.criteria.to}` : '',
		filter.criteria.subject ? `subject:${filter.criteria.subject}` : '',
		filter.criteria.query ?? '',
		filter.criteria.hasAttachment ? 'has:attachment' : '',
	];
	return parts.filter(Boolean).join(' ');
}

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** A moment as its India-time day, as a date box holds it (`2026-10-20`); empty for none. */
export function istDay(iso: string | null): string {
	return iso ? IST_DAY.format(new Date(iso)) : '';
}

/** The start of an India-time day, or the end of one, as the API takes it; null for no day. */
export function dayStart(day: string): string | null {
	return day ? new Date(`${day}T00:00:00+05:30`).toISOString() : null;
}

export function dayEnd(day: string): string | null {
	return day ? new Date(`${day}T23:59:59+05:30`).toISOString() : null;
}
