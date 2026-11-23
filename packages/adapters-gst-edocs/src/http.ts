import { EDocUnavailableError } from '@saha-textile/core-domain';

/** The fetch the adapters use; tests pass a fake government server. */
export type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
	status: number;
	text(): Promise<string>;
}>;

export interface HttpOptions {
	fetch?: FetchLike;
	/** Per call; the IRPs answer within seconds when they are up. */
	timeoutMs?: number;
}

/** One JSON call. Network failures, timeouts and 5xx become EDocUnavailableError (Generate falls back to by hand). */
export async function callJson(
	options: HttpOptions,
	method: 'GET' | 'POST',
	url: string,
	headers: Record<string, string>,
	body?: unknown,
): Promise<unknown> {
	const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
	try {
		const res = await doFetch(url, {
			method,
			headers: {
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: controller.signal,
		});
		const text = await res.text();
		if (res.status >= 500) throw new EDocUnavailableError(`edoc_http_${res.status}`);
		try {
			return JSON.parse(text);
		} catch {
			throw new EDocUnavailableError(`edoc_not_json_${res.status}`);
		}
	} catch (error) {
		if (error instanceof EDocUnavailableError) throw error;
		throw new EDocUnavailableError(controller.signal.aborted ? 'edoc_timeout' : 'edoc_network');
	} finally {
		clearTimeout(timer);
	}
}

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');
