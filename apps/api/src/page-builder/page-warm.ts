import { warmPath } from '@saha-textile/core-domain';

/** What the warm needs: the shop's own address (none locally unless set), the shop languages, and a fetch. */
export interface WarmDeps {
	readonly origin: string | null;
	readonly locales: readonly string[];
	readonly fetch: (url: string, init: RequestInit) => Promise<{ status: number }>;
}

export interface WarmResult {
	readonly warmed: number;
	readonly statuses: readonly number[];
	readonly skipped: 'no_shop_origin' | 'no_single_address' | null;
}

/**
 * Page Builder FX-8: just after a switch, asks the shop for the page in each shop language, so the first shopper
 * doesn't wait for the new layout to be drawn. A page that doesn't answer is only logged: the schedule already
 * decides what shows (FX-6).
 */
export async function warmPage(deps: WarmDeps, pageType: string): Promise<WarmResult> {
	if (!deps.origin) return { warmed: 0, statuses: [], skipped: 'no_shop_origin' };
	const path = warmPath(pageType);
	if (path === null) return { warmed: 0, statuses: [], skipped: 'no_single_address' };
	const base = deps.origin.replace(/\/+$/, '');
	const statuses = await Promise.all(
		deps.locales.map((locale) =>
			deps
				.fetch(`${base}/${locale}${path}`, {
					headers: { 'user-agent': 'saha-textile-page-warm/1' },
					signal: AbortSignal.timeout(20_000),
				})
				.then((response) => response.status)
				.catch(() => 0),
		),
	);
	return { warmed: statuses.filter((status) => status >= 200 && status < 400).length, statuses, skipped: null };
}
