import type { InboxBulkResult, InboxLabel } from '@saha-textile/contracts';

/**
 * A Gmail label id as the address may carry it in place of a folder. Gmail names people's labels
 * `Label_…` and its tabs `CATEGORY_…`, so any other word in that place is not a label.
 */
export const LABEL_ID = /^(Label_[A-Za-z0-9_-]{1,90}|CATEGORY_[A-Z]{1,20})$/;

/** The translation key of each Gmail category tab. */
export const CATEGORY_KEYS: Readonly<Record<string, string>> = {
	CATEGORY_SOCIAL: 'inbox_category_social',
	CATEGORY_PROMOTIONS: 'inbox_category_promotions',
	CATEGORY_UPDATES: 'inbox_category_updates',
	CATEGORY_FORUMS: 'inbox_category_forums',
};

/** One line of the sidebar: a label shown by its last name part, indented under its parents. */
export interface LabelLine {
	id: string;
	/** The last part of "Orders/Returns". */
	leaf: string;
	/** The whole name, as Gmail stores it. */
	name: string;
	depth: number;
	unread: number;
}

/**
 * The sidebar's two lists, from the mailbox's own labels. Gmail writes nesting as "/" in the name;
 * sorting by the whole name puts each child straight under its parent.
 */
export function labelTree(labels: readonly InboxLabel[]): { categories: LabelLine[]; labels: LabelLine[] } {
	const line = (label: InboxLabel): LabelLine => {
		const parts = label.name.split('/');
		return {
			id: label.id,
			leaf: parts.at(-1) ?? label.name,
			name: label.name,
			depth: parts.length - 1,
			unread: label.threadsUnread,
		};
	};
	const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
	return {
		categories: sorted.filter((label) => label.kind === 'category' && CATEGORY_KEYS[label.id]).map(line),
		labels: sorted.filter((label) => label.kind === 'label').map(line),
	};
}

/** Whether the rows on this page are all, some or none of the selection: the Select all box. */
export function pageSelection(pageIds: readonly string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
	const chosen = pageIds.filter((id) => selected.has(id)).length;
	if (!chosen) return 'none';
	return chosen === pageIds.length ? 'all' : 'some';
}

/** What a bulk action says afterwards, and which conversations stay selected to try again. */
export function bulkReport(result: InboxBulkResult): {
	key: string;
	params: Record<string, number>;
	retry: string[];
} {
	const total = result.done.length + result.failed.length;
	const retry = result.failed.filter((line) => line.reason === 'gmail_error').map((line) => line.threadId);
	if (!result.failed.length) return { key: 'inbox_bulk_done', params: { count: result.done.length }, retry };
	return {
		key: 'inbox_bulk_partial',
		params: { done: result.done.length, total, failed: result.failed.length },
		retry,
	};
}
