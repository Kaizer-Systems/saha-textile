import { afterEach, describe, expect, it, vi } from 'vitest';

import { productPathForCode, readShortAddress, readableHost, shortAddressText } from './short-address';

afterEach(() => vi.unstubAllGlobals());

describe('short product address', () => {
	it('reads the code and keeps the query', () => {
		expect(readShortAddress('/p/COT-HL-201')).toEqual({ code: 'COT-HL-201', query: '' });
		expect(readShortAddress('/p/COT-HL-201/?ref=ig-post')).toEqual({ code: 'COT-HL-201', query: '?ref=ig-post' });
		expect(readShortAddress('/product/red')).toBeNull();
		expect(readShortAddress('/p/../admin')).toBeNull();
	});

	it('asks the API for the product page', async () => {
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ slug: 'red-saree' })));
		vi.stubGlobal('fetch', fetchSpy);
		expect(await productPathForCode('https://api.test', 'A B')).toBe('/product/red-saree');
		expect(fetchSpy).toHaveBeenCalledWith('https://api.test/catalog/code/A%20B', expect.anything());
	});

	it('answers null for an unknown code or an API that is away', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 404 })),
		);
		expect(await productPathForCode('https://api.test', 'X')).toBeNull();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"slug":5}')),
		);
		expect(await productPathForCode('https://api.test', 'X')).toBeNull();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('down'))),
		);
		expect(await productPathForCode('https://api.test', 'X')).toBeNull();
	});

	it('writes the address the way a caption shows it', () => {
		expect(shortAddressText('https://www.sahatextile.com/', 'KATA-1001')).toBe('sahatextile.com/p/KATA-1001');
		expect(readableHost('http://localhost:4200/')).toBe('localhost:4200');
	});
});
