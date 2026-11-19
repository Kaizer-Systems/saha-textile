import { z } from 'zod';

import type { FxRatePort } from '@saha-textile/core-domain';

/**
 * ExchangeRate-API behind the FX port (shipping rules brief fx01: the daily fetch). Without a key it
 * reads the free open endpoint, refreshed once a day; with `EXCHANGERATE_API_KEY` it reads the
 * keyed v6 endpoint. Rates come back as "units of each currency per rupee", the shop's multiplier.
 * Only the server calls it; nothing here reaches the browser.
 */
export interface ExchangeRateApiOptions {
	/** Optional; the open tier needs none. Never logged. */
	apiKey?: string | null;
	/** The shop's own currency, the base every rate is read against. */
	baseCurrency?: string;
	/** Injected for tests; defaults to the global fetch. */
	fetch?: typeof fetch;
	timeoutMs?: number;
}

const OpenResponse = z.object({
	result: z.literal('success'),
	base_code: z.string(),
	rates: z.record(z.string(), z.number().positive()),
});
const KeyedResponse = z.object({
	result: z.literal('success'),
	base_code: z.string(),
	conversion_rates: z.record(z.string(), z.number().positive()),
});
const ErrorResponse = z.object({ result: z.literal('error'), 'error-type': z.string().optional() });

export class ExchangeRateApiFxAdapter implements FxRatePort {
	private readonly base: string;
	private readonly http: typeof fetch;

	constructor(private readonly options: ExchangeRateApiOptions = {}) {
		this.base = (options.baseCurrency ?? 'INR').toUpperCase();
		this.http = options.fetch ?? fetch;
	}

	/** Whether a key is set (the admin says which endpoint the fetch uses). */
	get usesKey(): boolean {
		return Boolean(this.options.apiKey);
	}

	private url(): string {
		return this.options.apiKey
			? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(this.options.apiKey)}/latest/${this.base}`
			: `https://open.er-api.com/v6/latest/${this.base}`;
	}

	async getAllRatesFromINR(): Promise<Record<string, number>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
		let body: unknown;
		try {
			const response = await this.http(this.url(), {
				signal: controller.signal,
				headers: { accept: 'application/json' },
			});
			body = await response.json().catch(() => null);
			if (!response.ok) {
				const problem = ErrorResponse.safeParse(body);
				throw new Error(
					`ExchangeRate-API answered ${response.status}${problem.success && problem.data['error-type'] ? ` (${problem.data['error-type']})` : ''}`,
				);
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError')
				throw new Error('ExchangeRate-API did not answer in time', { cause: error });
			throw error;
		} finally {
			clearTimeout(timer);
		}
		const keyed = KeyedResponse.safeParse(body);
		const open = OpenResponse.safeParse(body);
		const rates = keyed.success ? keyed.data.conversion_rates : open.success ? open.data.rates : null;
		const baseCode = keyed.success ? keyed.data.base_code : open.success ? open.data.base_code : null;
		if (!rates) {
			const problem = ErrorResponse.safeParse(body);
			throw new Error(
				`ExchangeRate-API sent no rates${problem.success && problem.data['error-type'] ? ` (${problem.data['error-type']})` : ''}`,
			);
		}
		if (baseCode?.toUpperCase() !== this.base)
			throw new Error(`ExchangeRate-API answered for ${baseCode}, not ${this.base}`);
		return rates;
	}

	async getRateFromINR(currencyCode: string): Promise<number> {
		const rates = await this.getAllRatesFromINR();
		const rate = rates[currencyCode.toUpperCase()];
		if (rate === undefined) throw new Error(`ExchangeRate-API has no rate for ${currencyCode}`);
		return rate;
	}
}
