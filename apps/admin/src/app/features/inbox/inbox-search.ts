/**
 * The Inbox's search options (Inbox redesign brief, R3): the fields Gmail offers under its search box,
 * turned into Gmail's own search words and read back from them, so a search can be adjusted. Words
 * the fields have no place for stay in "Has the words", so nothing typed is ever lost.
 */

/** How long either side of the chosen date "Date within" reaches, in days. */
export const WITHIN_DAYS = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 30, '2m': 60, '6m': 180, '1y': 365 } as const;
export type Within = keyof typeof WITHIN_DAYS;
export const WITHIN_OPTIONS = Object.keys(WITHIN_DAYS) as Within[];

/** Gmail's size letters: `larger:10M`, `smaller:500K`. */
export const SIZE_UNITS = { MB: 'M', KB: 'K' } as const;
export type SizeUnit = keyof typeof SIZE_UNITS;

/** "Search in": all mail, one of Gmail's own folders, or one label by its full name. */
export const SEARCH_IN = {
	all: '',
	inbox: 'in:inbox',
	starred: 'is:starred',
	important: 'is:important',
	sent: 'in:sent',
	spam: 'in:spam',
	trash: 'in:trash',
} as const;
export type SearchPlace = keyof typeof SEARCH_IN;

export interface SearchFields {
	from: string;
	to: string;
	subject: string;
	hasWords: string;
	notWords: string;
	sizeOp: 'larger' | 'smaller';
	size: string;
	sizeUnit: SizeUnit;
	within: Within;
	/** `YYYY-MM-DD`; empty means no date. */
	date: string;
	/** A `SearchPlace`, or `label:<full name>` for one of the mailbox's labels. */
	searchIn: string;
	hasAttachment: boolean;
	unreadOnly: boolean;
}

export function emptySearchFields(): SearchFields {
	return {
		from: '',
		to: '',
		subject: '',
		hasWords: '',
		notWords: '',
		sizeOp: 'larger',
		size: '',
		sizeUnit: 'MB',
		within: '1w',
		date: '',
		searchIn: 'all',
		hasAttachment: false,
		unreadOnly: false,
	};
}

/** `value` as one Gmail search term: several words are grouped in brackets so they stay together. */
function term(prefix: string, value: string): string {
	const clean = value.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!clean) return '';
	return /\s/.test(clean) ? `${prefix}(${clean})` : `${prefix}${clean}`;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-11-24` moved by whole days, as Gmail writes dates (`2026/11/24`). */
function gmailDay(iso: string, days: number): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '/');
}

/** The fields as Gmail search words, in Gmail's own order. */
export function buildQuery(fields: SearchFields): string {
	const parts = [term('from:', fields.from), term('to:', fields.to), term('subject:', fields.subject)];
	parts.push(fields.hasWords.trim().replace(/\s+/g, ' '));
	for (const word of fields.notWords.trim().split(/\s+/)) parts.push(word ? `-${word.replace(/^-+/, '')}` : '');
	const size = Number(fields.size);
	if (fields.size.trim() && Number.isFinite(size) && size > 0) {
		parts.push(`${fields.sizeOp}:${size}${SIZE_UNITS[fields.sizeUnit]}`);
	}
	if (ISO_DAY.test(fields.date)) {
		// Gmail's `before:` is the day after the last one included.
		const span = WITHIN_DAYS[fields.within];
		parts.push(`after:${gmailDay(fields.date, -span)}`, `before:${gmailDay(fields.date, span + 1)}`);
	}
	if (fields.searchIn.startsWith('label:')) parts.push(term('label:', fields.searchIn.slice(6)));
	else parts.push(SEARCH_IN[fields.searchIn as SearchPlace] ?? '');
	if (fields.hasAttachment) parts.push('has:attachment');
	if (fields.unreadOnly) parts.push('is:unread');
	return parts.filter(Boolean).join(' ');
}

/** Splits a search into terms, keeping `prefix:(several words)` and quoted phrases whole. */
export function queryTerms(q: string): string[] {
	return q.match(/-?[a-z]+:\([^)]*\)|-?[a-z]+:"[^"]*"|"[^"]*"|\S+/gi) ?? [];
}

const unwrap = (value: string) => value.replace(/^\((.*)\)$/, '$1').replace(/^"(.*)"$/, '$1');
const PLACE_OF: Readonly<Record<string, SearchPlace>> = Object.fromEntries(
	Object.entries(SEARCH_IN)
		.filter(([, words]) => words)
		.map(([place, words]) => [words, place as SearchPlace]),
);

/**
 * A search read back into the fields. A date range becomes "Date within" only when it is one the
 * fields can draw (centred on a day, a span from the list); anything else stays in the words.
 */
export function readQuery(q: string): SearchFields {
	const fields = emptySearchFields();
	const words: string[] = [];
	const not: string[] = [];
	let after = '';
	let before = '';
	for (const raw of queryTerms(q)) {
		const match = /^([a-z]+):(.+)$/i.exec(raw);
		const key = match?.[1].toLowerCase() ?? '';
		const value = match ? unwrap(match[2]) : '';
		if (key === 'from' || key === 'to' || key === 'subject') fields[key] = value;
		else if (key === 'after' && !after) after = raw;
		else if (key === 'before' && !before) before = raw;
		else if ((key === 'larger' || key === 'smaller') && /^\d+(\.\d+)?[mk]$/i.test(value)) {
			fields.sizeOp = key;
			fields.size = value.slice(0, -1);
			fields.sizeUnit = value.slice(-1).toUpperCase() === 'K' ? 'KB' : 'MB';
		} else if (raw === 'has:attachment') fields.hasAttachment = true;
		else if (raw === 'is:unread') fields.unreadOnly = true;
		else if (PLACE_OF[raw.toLowerCase()]) fields.searchIn = PLACE_OF[raw.toLowerCase()];
		else if (key === 'label') fields.searchIn = `label:${value}`;
		else if (raw.startsWith('-') && raw.length > 1 && !raw.includes(':')) not.push(raw.slice(1));
		else words.push(raw);
	}
	const range = dateWithin(after, before);
	if (range) Object.assign(fields, range);
	else words.push(...[after, before].filter(Boolean));
	fields.hasWords = words.join(' ');
	fields.notWords = not.join(' ');
	return fields;
}

/** `after:` and `before:` as "within N of a day", when they are exactly that. */
function dateWithin(after: string, before: string): Pick<SearchFields, 'within' | 'date'> | null {
	const day = (term: string) => {
		const iso = term.slice(term.indexOf(':') + 1).replace(/\//g, '-');
		return ISO_DAY.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Number.NaN;
	};
	const start = day(after);
	const end = day(before);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	const width = (end - start) / DAY_MS;
	const within = WITHIN_OPTIONS.find((option) => WITHIN_DAYS[option] * 2 + 1 === width);
	if (!within) return null;
	return { within, date: new Date(start + WITHIN_DAYS[within] * DAY_MS).toISOString().slice(0, 10) };
}

/** What a filter can hold of a search: Gmail filters take from, to, subject, words and attachment. */
export function filterFromSearch(fields: SearchFields): {
	from: string;
	to: string;
	subject: string;
	query: string;
	hasAttachment: boolean;
} {
	const rest = buildQuery({ ...fields, from: '', to: '', subject: '', hasAttachment: false });
	return {
		from: fields.from.trim(),
		to: fields.to.trim(),
		subject: fields.subject.trim(),
		query: rest,
		hasAttachment: fields.hasAttachment,
	};
}
