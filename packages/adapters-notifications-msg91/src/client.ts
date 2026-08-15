import type { Msg91Fetch, Msg91ToolResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface Msg91HttpClientOptions {
	authKey: string;
	fetchImpl?: Msg91Fetch;
	timeoutMs?: number;
}

/**
 * Thin MSG91 HTTP client: Authkey header, JSON body, no destination logging.
 */
export class Msg91HttpClient {
	private readonly authKey: string;
	private readonly fetchImpl: Msg91Fetch;
	private readonly timeoutMs: number;

	constructor(options: Msg91HttpClientOptions) {
		this.authKey = options.authKey;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async postJson(url: string, body: unknown): Promise<Msg91ToolResult> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const response = await this.fetchImpl(url, {
				method: 'POST',
				headers: {
					accept: 'application/json',
					'content-type': 'application/json',
					authkey: this.authKey,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			const text = await response.text();
			let parsed: unknown = null;
			if (text) {
				try {
					parsed = JSON.parse(text) as unknown;
				} catch {
					parsed = { raw: text.slice(0, 200) };
				}
			}
			const providerMessageId = extractProviderMessageId(parsed);
			if (!response.ok) {
				return {
					ok: false,
					providerMessageId,
					errorMessage: summarizeProviderError(parsed, response.status),
					httpStatus: response.status,
				};
			}
			return {
				ok: true,
				providerMessageId,
				errorMessage: null,
				httpStatus: response.status,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'MSG91 request failed';
			return {
				ok: false,
				providerMessageId: null,
				errorMessage: message,
				httpStatus: 0,
			};
		} finally {
			clearTimeout(timer);
		}
	}
}

function extractProviderMessageId(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object') return null;
	const record = payload as Record<string, unknown>;
	for (const key of ['request_id', 'requestId', 'message_id', 'messageId', 'id']) {
		const value = record[key];
		if (typeof value === 'string' && value.length > 0) return value;
	}
	const nested = record['data'];
	if (nested && typeof nested === 'object') {
		return extractProviderMessageId(nested);
	}
	return null;
}

function summarizeProviderError(payload: unknown, status: number): string {
	if (payload && typeof payload === 'object') {
		const record = payload as Record<string, unknown>;
		const message = record['message'] ?? record['error'] ?? record['type'];
		if (typeof message === 'string' && message.length > 0) {
			return `MSG91 HTTP ${status}: ${message.slice(0, 200)}`;
		}
	}
	return `MSG91 HTTP ${status}`;
}
