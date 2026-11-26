/**
 * The Inbox's folder rail (Inbox redesign brief, R2): pinned open with names, or icons only and
 * opened over the list by pointing or Tab. Each person's choice is kept in their browser; until they
 * choose, wide screens start open and narrower ones as icons (owner's answer Q1, 24 Nov).
 */
export type RailMode = 'open' | 'icons';

export const RAIL_KEY = 'inbox.rail';
/** From this width the rail starts open (Q1). */
export const RAIL_OPEN_FROM = 1400;
/** Pointing rests this long on the icons before they open, so passing over them does nothing. */
export const PEEK_OPEN_MS = 150;
/** The opened icons wait this long after the pointer leaves, so a slip doesn't close them. */
export const PEEK_CLOSE_MS = 300;

/** The rail's mode on opening the Inbox: the person's saved choice, else by screen width. */
export function initialRail(width: number): RailMode {
	try {
		const saved = localStorage.getItem(RAIL_KEY);
		if (saved === 'open' || saved === 'icons') return saved;
	} catch {
		// A blocked store only means the width decides.
	}
	return width >= RAIL_OPEN_FROM ? 'open' : 'icons';
}

export function saveRail(mode: RailMode) {
	try {
		localStorage.setItem(RAIL_KEY, mode);
	} catch {
		// A blocked store only means the width decides next time.
	}
}

/** "1–20 of about 132": where this page sits in the list. */
export function pageRange(
	page: number,
	fullPage: number,
	rows: number,
	estimate: number | null,
): { start: number; end: number; total: number | null } | null {
	if (!rows) return null;
	const start = page * fullPage + 1;
	const end = start + rows - 1;
	return { start, end, total: estimate !== null && estimate >= end ? estimate : null };
}
