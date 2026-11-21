import { afterEach, describe, expect, it, vi } from 'vitest';

import { digitalOceanAdapter, readAll, toImage, toSize } from './digitalocean.adapter.js';

const API = 'https://api.digitalocean.com/v2';

/** Answers made up for the test, keyed by the path after /v2; no real account or key. */
function answer(routes: Record<string, { status?: number; body: unknown }>) {
	return vi.fn(async (url: string) => {
		const path = url.slice(API.length);
		const hit = routes[path];
		return new Response(JSON.stringify(hit?.body ?? {}), { status: hit?.status ?? (hit ? 200 : 404) });
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('DigitalOcean create-step lists', () => {
	it('maps sizes and images to the console shapes', () => {
		expect(
			toSize({
				slug: 's-2vcpu-4gb-amd',
				description: 'Basic AMD',
				memory: 4096,
				vcpus: 2,
				disk: 80,
				transfer: 4,
				price_monthly: 28,
				price_hourly: 0.04167,
				regions: ['blr1'],
				available: true,
			}),
		).toMatchObject({ family: 'amd', priceMonthly: 28, regions: ['blr1'] });
		expect(toImage({ id: 5, type: 'snapshot', name: 'before-upgrade' }, 'private').kind).toBe('snapshot');
		expect(toImage({ id: 6, type: 'custom', name: 'mine' }, 'private').kind).toBe('custom');
		expect(toImage({ id: 7, type: 'snapshot', name: 'nightly' }, 'private', 'example-1')).toMatchObject({
			kind: 'backup',
			of: 'example-1',
		});
	});

	it('follows DigitalOcean’s own next-page links and stays on its API', async () => {
		vi.stubGlobal(
			'fetch',
			answer({
				'/sizes?per_page=200': {
					body: { sizes: [{ slug: 'a' }], links: { pages: { next: `${API}/sizes?page=2&per_page=200` } } },
				},
				'/sizes?page=2&per_page=200': {
					body: { sizes: [{ slug: 'b' }], links: { pages: { next: 'https://elsewhere.example/x' } } },
				},
			}),
		);
		expect(await readAll('/sizes', 'sizes', 'example-key')).toEqual([{ slug: 'a' }, { slug: 'b' }]);
	});

	it('names a list it may not read and keeps the rest', async () => {
		vi.stubGlobal(
			'fetch',
			answer({
				'/regions?per_page=200': {
					body: { regions: [{ slug: 'blr1', name: 'Bangalore 1', available: true }] },
				},
				'/sizes?per_page=200': { body: { sizes: [] } },
				'/images?type=distribution&per_page=200': { body: { images: [{ id: 1, slug: 'ubuntu-26-04-x64' }] } },
				'/images?type=application&per_page=200': { body: { images: [] } },
				'/images?private=true&per_page=200': { body: { images: [] } },
				'/account/keys?per_page=200': { status: 403, body: { id: 'forbidden' } },
				'/vpcs?per_page=200': { body: { vpcs: [] } },
				'/projects?per_page=200': { body: { projects: [] } },
				'/droplets?per_page=200': { body: { droplets: [] } },
			}),
		);
		const c = await digitalOceanAdapter.catalog('example-key');
		expect(c.regions.map((r) => r.slug)).toEqual(['blr1']);
		expect(c.images.map((i) => i.slug)).toEqual(['ubuntu-26-04-x64']);
		expect(c.missing).toEqual(['SSH keys']);
	});

	it('fails the whole read when the key itself is refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 401 })),
		);
		await expect(digitalOceanAdapter.catalog('example-key')).rejects.toThrow('refused the key');
	});
});
