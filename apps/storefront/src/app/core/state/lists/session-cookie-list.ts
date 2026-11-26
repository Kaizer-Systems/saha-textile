/**
 * A short list of ids kept in a session cookie: no expiry, so it ends when the browser closes,
 * and nothing in it but ids. The wishlist (guests) and the compare list use it; both are
 * necessary cookies because the shopper creates them by pressing a button (owner decision
 * 2026-11-08), and both are listed in the cookie catalogue.
 */
export function readCookieList(cookies: string, name: string, limit: number): string[] {
	const entry = cookies.split('; ').find((part) => part.startsWith(`${name}=`));
	if (!entry) return [];
	let raw = '';
	try {
		raw = decodeURIComponent(entry.slice(name.length + 1));
	} catch {
		return [];
	}
	const ids = raw.split(',').filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
	return [...new Set(ids)].slice(0, limit);
}

/** The `document.cookie` assignment that stores `ids`, or removes the cookie when empty. */
export function writeCookieList(name: string, ids: readonly string[]): string {
	return ids.length
		? `${name}=${encodeURIComponent(ids.join(','))}; Path=/; SameSite=Lax; Secure`
		: `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}
