import { describe, expect, it, vi } from 'vitest';

import { ExchangeRateApiFxAdapter } from '../src/index';

const answer = (status: number, body: unknown) =>
	vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe('ExchangeRate-API (daily fetch, brief fx01)', () => {
	it('reads the open endpoint without a key', async () => {
		const http = answer(200, {
			result: 'success',
			base_code: 'INR',
			rates: { INR: 1, USD: 0.01131, GBP: 0.00855 },
		});
		const fx = new ExchangeRateApiFxAdapter({ fetch: http as unknown as typeof fetch });
		expect(await fx.getAllRatesFromINR()).toEqual({ INR: 1, USD: 0.01131, GBP: 0.00855 });
		expect(String(http.mock.calls[0]?.[0])).toBe('https://open.er-api.com/v6/latest/INR');
		expect(fx.usesKey).toBe(false);
		expect(await fx.getRateFromINR('usd')).toBe(0.01131);
	});

	it('reads the keyed endpoint with a key', async () => {
		const http = answer(200, { result: 'success', base_code: 'INR', conversion_rates: { USD: 0.0113 } });
		const fx = new ExchangeRateApiFxAdapter({ apiKey: 'k-1', fetch: http as unknown as typeof fetch });
		expect(await fx.getAllRatesFromINR()).toEqual({ USD: 0.0113 });
		expect(String(http.mock.calls[0]?.[0])).toBe('https://v6.exchangerate-api.com/v6/k-1/latest/INR');
	});

	it('says what went wrong, so the stored rates stay in use', async () => {
		const refused = new ExchangeRateApiFxAdapter({
			fetch: answer(403, { result: 'error', 'error-type': 'invalid-key' }) as unknown as typeof fetch,
		});
		await expect(refused.getAllRatesFromINR()).rejects.toThrow('ExchangeRate-API answered 403 (invalid-key)');
		const wrongBase = new ExchangeRateApiFxAdapter({
			fetch: answer(200, { result: 'success', base_code: 'USD', rates: { INR: 88 } }) as unknown as typeof fetch,
		});
		await expect(wrongBase.getAllRatesFromINR()).rejects.toThrow('not INR');
		const empty = new ExchangeRateApiFxAdapter({
			fetch: answer(200, { result: 'error' }) as unknown as typeof fetch,
		});
		await expect(empty.getAllRatesFromINR()).rejects.toThrow('sent no rates');
		await expect(
			new ExchangeRateApiFxAdapter({
				fetch: answer(200, { result: 'success', base_code: 'INR', rates: {} }) as unknown as typeof fetch,
			}).getRateFromINR('USD'),
		).rejects.toThrow('no rate for USD');
	});

	it('uses global fetch with the default configuration', async () => {
		const http = answer(200, { result: 'success', base_code: 'inr', rates: { INR: 1 } });
		vi.stubGlobal('fetch', http);
		try {
			await expect(new ExchangeRateApiFxAdapter().getRateFromINR('INR')).resolves.toBe(1);
			expect(http).toHaveBeenCalledWith(
				'https://open.er-api.com/v6/latest/INR',
				expect.objectContaining({ headers: { accept: 'application/json' } }),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('normalizes the base and encodes reserved characters in the key', async () => {
		const http = answer(200, { result: 'success', base_code: 'GBP', conversion_rates: { INR: 118 } });
		const fx = new ExchangeRateApiFxAdapter({ apiKey: 'key/+', baseCurrency: 'gbp', fetch: http });
		expect(fx.usesKey).toBe(true);
		await expect(fx.getAllRatesFromINR()).resolves.toEqual({ INR: 118 });
		expect(String(http.mock.calls[0]?.[0])).toBe('https://v6.exchangerate-api.com/v6/key%2F%2B/latest/GBP');
	});

	it('reports an invalid provider response without requiring a JSON body', async () => {
		const http: typeof fetch = async () => new Response('Bad gateway', { status: 502 });
		await expect(new ExchangeRateApiFxAdapter({ fetch: http }).getAllRatesFromINR()).rejects.toThrow(
			'ExchangeRate-API answered 502',
		);
	});

	it.each([
		[{ result: 'error', 'error-type': 'unsupported-code' }, 'sent no rates (unsupported-code)'],
		[{ result: 'success', base_code: 'INR', rates: { USD: 0 } }, 'sent no rates'],
	])('refuses an unsuccessful rates payload %#', async (payload, message) => {
		const fx = new ExchangeRateApiFxAdapter({ fetch: answer(200, payload) });
		await expect(fx.getAllRatesFromINR()).rejects.toThrow(message);
	});

	it('aborts a timed-out request and distinguishes it from a network error', async () => {
		vi.useFakeTimers();
		try {
			const http: typeof fetch = async (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
				});
			const fx = new ExchangeRateApiFxAdapter({ fetch: http, timeoutMs: 50 });
			const assertion = expect(fx.getAllRatesFromINR()).rejects.toThrow('did not answer in time');
			await vi.advanceTimersByTimeAsync(50);
			await assertion;
			const transportFailure = new Error('socket closed');
			const offline = new ExchangeRateApiFxAdapter({ fetch: () => Promise.reject(transportFailure) });
			await expect(offline.getAllRatesFromINR()).rejects.toBe(transportFailure);
			const refused = new ExchangeRateApiFxAdapter({ fetch: () => Promise.reject('connection lost') });
			await expect(refused.getAllRatesFromINR()).rejects.toBe('connection lost');
		} finally {
			vi.useRealTimers();
		}
	});
});
