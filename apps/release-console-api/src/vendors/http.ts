/** A vendor call that failed; the message is safe to show (it never carries the key). */
export class VendorError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export interface JsonAnswer {
	status: number;
	headers: Headers;
	body: unknown;
}

/** GET a vendor URL with a bearer key. Never throws for HTTP errors; the caller reads `status`. */
export async function getJson(url: string, key: string, extra: Record<string, string> = {}): Promise<JsonAnswer> {
	const res = await fetch(url, {
		headers: {
			authorization: `Bearer ${key}`,
			accept: 'application/json',
			'user-agent': 'release-console',
			...extra,
		},
		signal: AbortSignal.timeout(15_000),
	});
	const body: unknown = await res.json().catch(() => null);
	return { status: res.status, headers: res.headers, body };
}

export const rec = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
