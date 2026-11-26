import type { ShopEvent as PublicShopEvent } from './shop-event.interface';

/** The popup cookie: event ids the visitor ticked or rested, each with when that ends. */
export const EVENTS_COOKIE = 'st_events';
/** Closing with ✕ rests one event's popup this long (owner brief, approved 2026-11-09). */
export const REST_MS = 3 * 86_400_000;

/** `evt_a~1790000000.evt_b~1791000000` → id → end (ms). Unreadable entries are dropped. */
export function readEventsCookie(value: string | null | undefined): Map<string, number> {
	const out = new Map<string, number>();
	for (const entry of (value ?? '').split('.')) {
		const [id, seconds] = entry.split('~');
		const at = Number(seconds) * 1000;
		if (id && /^[A-Za-z0-9_-]{1,80}$/.test(id) && Number.isFinite(at) && at > 0) out.set(id, at);
	}
	return out;
}

/** The cookie value and its life: it ends when the last of its entries does. */
export function writeEventsCookie(
	entries: ReadonlyMap<string, number>,
	now: number,
): { value: string; maxAge: number } {
	const live = [...entries].filter(([, at]) => at > now);
	const value = live.map(([id, at]) => `${id}~${Math.ceil(at / 1000)}`).join('.');
	const last = Math.max(now, ...live.map(([, at]) => at));
	return { value, maxAge: Math.max(0, Math.ceil((last - now) / 1000)) };
}

/** When an answer about this event ends: ✕ rests it 3 days, the tick until its popup is over. */
export function answerUntil(event: PublicShopEvent, neverAgain: boolean, now: number): number {
	const over = event.popupUntil ? Date.parse(event.popupUntil) : now;
	return neverAgain ? over : Math.min(over, now + REST_MS);
}

/**
 * The one event a visitor sees: the running sale that ends soonest, then a sale about to start,
 * then the newest launch. Events whose popup is over, or that the visitor answered, are skipped.
 */
export function choosePopupEvent(
	items: readonly PublicShopEvent[],
	now: number,
	answered: ReadonlyMap<string, number>,
): PublicShopEvent | null {
	const open = items.filter(
		(event) => !!event.popupUntil && Date.parse(event.popupUntil) > now && !((answered.get(event.id) ?? 0) > now),
	);
	const at = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);
	const running = open.filter((event) => event.type === 'sale' && event.phase === 'running');
	running.sort((a, b) => at(a.endsAt) - at(b.endsAt));
	const upcoming = open.filter((event) => event.type === 'sale' && event.phase === 'upcoming');
	upcoming.sort((a, b) => at(a.startsAt) - at(b.startsAt));
	const launches = open.filter((event) => event.type === 'launch');
	launches.sort((a, b) => at(b.startsAt) - at(a.startsAt));
	return running[0] ?? upcoming[0] ?? launches[0] ?? null;
}

/** The label before a countdown, as a translation key. */
export function countdownKey(event: PublicShopEvent): string {
	if (event.phase === 'launched') return 'event_now_live';
	if (event.type === 'launch') return 'event_launches_in';
	return event.phase === 'upcoming' ? 'event_sale_starts_in' : 'event_sale_ends_in';
}

/** The fixed IST moment beside the timer: "Launches 1 Sep 2027, 10:00 AM IST". */
export function momentKey(event: PublicShopEvent): { key: string; at: string } {
	if (event.phase === 'launched') return { key: 'event_live_since', at: event.startsAt };
	if (event.type === 'launch') return { key: 'event_launches_at', at: event.startsAt };
	if (event.phase === 'upcoming') return { key: 'event_starts_at', at: event.startsAt };
	return { key: 'event_ends_at', at: event.endsAt ?? event.startsAt };
}
