import { ANDROID_APP_URL, type BrandAppLinkCheck, type BrandAppLinkResult, IOS_APP_URL } from '@saha-textile/contracts';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 6000;
const NOT_FOUND: BrandAppLinkResult = { found: false, name: null };

/**
 * Brand Kit › Validate (owner, 2026-11-10): is this the store page of a real app? Only the two
 * store hosts are ever asked (the address is matched first and rebuilt from the app id), so an
 * admin cannot point the server at anything else.
 *
 * - Google Play: the app page answers 200 for a live app and 404 otherwise; its title names the app.
 * - App Store: Apple's public lookup by id, in India first, then the default store.
 *
 * A store that cannot be reached answers `null` (unknown), never "not found".
 */
export async function checkAppLink(
	input: BrandAppLinkCheck,
	fetcher: Fetch = fetch,
): Promise<BrandAppLinkResult | null> {
	try {
		if (input.store === 'android') {
			const id = ANDROID_APP_URL.exec(input.url)?.[1];
			if (!id) return NOT_FOUND;
			const response = await fetcher(
				`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en`,
				{ signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' },
			);
			if (response.status === 404) return NOT_FOUND;
			if (!response.ok) return null;
			const title = /<title[^>]*>([^<]*)<\/title>/i.exec(await response.text())?.[1] ?? '';
			const name = title.replace(/\s*-\s*Apps on Google Play\s*$/i, '').trim();
			return { found: true, name: name || null };
		}
		const id = IOS_APP_URL.exec(input.url)?.[1];
		if (!id) return NOT_FOUND;
		for (const country of ['in', '']) {
			const response = await fetcher(
				`https://itunes.apple.com/lookup?id=${id}${country ? `&country=${country}` : ''}`,
				{ signal: AbortSignal.timeout(TIMEOUT_MS) },
			);
			if (!response.ok) return null;
			const body = (await response.json()) as { resultCount?: number; results?: { trackName?: string }[] };
			if (body.resultCount) return { found: true, name: body.results?.[0]?.trackName ?? null };
		}
		return NOT_FOUND;
	} catch {
		return null;
	}
}
