import { describe, expect, it, vi } from 'vitest';

import { AddressMaskingProcessor, startTracing, TRACED_ADDRESSES } from '../src/tracing';

/** Request tracing (Release Path brief Q7, owner 2026-11-23): off unless configured; addresses masked. */
describe('tracing', () => {
	it('starts nothing without a trace store address', () => {
		expect(startTracing('saha-textile-api', {})).toBeNull();
	});

	it('masks one-time tokens in every address attribute the moment a span starts', () => {
		const attributes: Record<string, unknown> = {
			'url.path': '/en/pay/abc123secret',
			'url.full': 'https://api.example.test/auth/activate?token=tok-zz&lang=en',
			'http.target': '/auth/accept-invite?token=inv-zz',
			'http.method': 'GET',
		};
		const span = { attributes, setAttribute: vi.fn((name: string, value: unknown) => (attributes[name] = value)) };
		const processor = new AddressMaskingProcessor();
		processor.onStart(span as never);
		expect(attributes['url.path']).toBe('/en/pay/{{token}}');
		expect(attributes['url.full']).toBe('https://api.example.test/auth/activate?token={{token}}&lang=en');
		expect(attributes['http.target']).toBe('/auth/accept-invite?token={{token}}');
		expect(attributes['http.method']).toBe('GET');
		expect(span.setAttribute).toHaveBeenCalledTimes(3);
		expect(TRACED_ADDRESSES).toContain('url.query');
		processor.onEnd();
	});

	it('flushes and shuts down at once (the batch processor sends the spans)', async () => {
		const processor = new AddressMaskingProcessor();
		await expect(processor.forceFlush()).resolves.toBeUndefined();
		await expect(processor.shutdown()).resolves.toBeUndefined();
	});
});
