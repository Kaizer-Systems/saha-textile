const KEY = 'st_notify_intent';
const MAX_AGE_MS = 30 * 60 * 1000;

export function rememberNotifyIntent(storage: Storage, slug: string, variant: string, now = Date.now()): void {
	storage.setItem(KEY, JSON.stringify({ slug, variant, at: now }));
}

export function readNotifyIntent(storage: Storage, now = Date.now()): { slug: string; variant: string } | null {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
		if (!parsed || typeof parsed !== 'object') return null;
		const row = parsed as { slug?: unknown; variant?: unknown; at?: unknown };
		if (typeof row.slug !== 'string' || typeof row.variant !== 'string' || typeof row.at !== 'number') return null;
		if (now - row.at > MAX_AGE_MS) return null;
		return { slug: row.slug, variant: row.variant };
	} catch {
		return null;
	}
}

export function clearNotifyIntent(storage: Storage): void {
	storage.removeItem(KEY);
}
