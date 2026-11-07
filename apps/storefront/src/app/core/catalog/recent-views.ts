const KEY = 'st_recent';
const MAX = 12;

export interface RecentView {
	slug: string;
	at: number;
}

export function readRecentViews(storage: Storage): RecentView[] {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(row): row is RecentView =>
					!!row && typeof row === 'object' && typeof (row as RecentView).slug === 'string',
			)
			.slice(0, MAX);
	} catch {
		return [];
	}
}

export function rememberRecentView(storage: Storage, slug: string, now = Date.now()): RecentView[] {
	const next = [{ slug, at: now }, ...readRecentViews(storage).filter((row) => row.slug !== slug)].slice(0, MAX);
	storage.setItem(KEY, JSON.stringify(next.map(({ slug: saved, at }) => ({ slug: saved, at }))));
	return next;
}
