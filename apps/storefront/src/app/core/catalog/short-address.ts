/**
 * The short product address `/p/<product code>` (share brief D6): short enough to read off an
 * Instagram post and type. The server answers it with a 301 to the product page.
 */

const SHORT_ADDRESS = /^\/p\/([A-Za-z0-9._-]{1,64})\/?(\?.*)?$/;

/** The code and any query in a short address, or null when the path is something else. */
export function readShortAddress(path: string): { code: string; query: string } | null {
	const match = SHORT_ADDRESS.exec(path);
	return match ? { code: match[1] as string, query: match[2] ?? '' } : null;
}

/** The product page behind a code, or null when no live product has it or the API is away. */
export async function productPathForCode(apiUrl: string, code: string): Promise<string | null> {
	try {
		const response = await fetch(`${apiUrl}/catalog/code/${encodeURIComponent(code)}`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		const slug = body && typeof body === 'object' && 'slug' in body ? body.slug : null;
		return typeof slug === 'string' && slug ? `/product/${slug}` : null;
	} catch {
		return null;
	}
}

/** The shop's address as people read it: no scheme, no `www.`, no trailing slash. */
export function readableHost(origin: string): string {
	return origin
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\/$/, '');
}

/** How the short address reads in a caption. */
export function shortAddressText(origin: string, code: string): string {
	return `${readableHost(origin)}/p/${code}`;
}
