import { describe, expect, it, vi } from 'vitest';

import { AddressMaskingProcessor, startShopTracing } from './server-tracing';

/** Tracing for the shop's server pages (Release Path brief Q7): off unless configured; addresses masked. */
describe('server tracing', () => {
	it('starts nothing without a trace store address', () => {
		expect(startShopTracing({})).toBeNull();
	});

	it('masks one-time tokens in addresses the moment a span starts', async () => {
		const attributes: Record<string, unknown> = {
			'url.path': '/en/pay/abc123secret',
			'url.full': 'https://shop.example.test/en/auth/activate?token=tok-zz',
			'http.request.method': 'GET',
		};
		const span = { attributes, setAttribute: vi.fn((name: string, value: unknown) => (attributes[name] = value)) };
		const processor = new AddressMaskingProcessor();
		processor.onStart(span as never);
		processor.onEnd();
		expect(attributes['url.path']).toBe('/en/pay/{{token}}');
		expect(attributes['url.full']).toBe('https://shop.example.test/en/auth/activate?token={{token}}');
		expect(attributes['http.request.method']).toBe('GET');
		await expect(processor.forceFlush()).resolves.toBeUndefined();
		await expect(processor.shutdown()).resolves.toBeUndefined();
	});
});
