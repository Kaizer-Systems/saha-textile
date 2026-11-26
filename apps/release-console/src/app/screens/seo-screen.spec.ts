import { describe, expect, it } from 'vitest';

import { inSitemap, localSites, missingAction, sitemapProgressOf, sitemapResultOf } from './seo-screen';

import type { Job } from '@saha-textile/release-console-contracts';

const result = {
	origin: 'https://staging.example.com',
	sitemap: '/sitemap.xml',
	at: '2026-11-21T00:00:00.000Z',
	listed: 3,
	checked: 3,
	ok: 2,
	redirects: 0,
	notFound: 1,
	other: 0,
	failures: [{ path: '/old', status: 404 }],
	paths: ['/', '/collections/silk', '/old'],
	note: '',
};
const job = (events: (Record<string, unknown> | null)[]): Job => ({
	id: 'j1',
	kind: 'seo',
	label: 'Check the sitemap',
	status: 'passed',
	startedAt: '2026-11-21T00:00:00.000Z',
	finishedAt: null,
	exitCode: 0,
	lines: events.map((event, seq) => ({ seq, stream: 'out', text: '', event })),
});

describe('Search engines', () => {
	it('reads the result and the progress from the check’s lines', () => {
		expect(sitemapResultOf(job([{ progress: { checked: 25, total: 3 } }, null, { result }]))).toEqual(result);
		expect(sitemapResultOf(job([{ result: { origin: 'x' } }]))).toBeNull();
		expect(sitemapResultOf(null)).toBeNull();
		expect(
			sitemapProgressOf(
				job([{ progress: { checked: 25, total: 90 } }, { progress: { checked: 50, total: 90 } }]),
			),
		).toEqual({
			checked: 50,
			total: 90,
		});
	});

	it('says whether the sitemap lists a missing path, and not for grouped routes', () => {
		expect(inSitemap('/old', result)).toBe('yes');
		expect(inSitemap('/gone', result)).toBe('no');
		expect(inSitemap('/product/:id', result)).toBe('—');
		expect(inSitemap('/old', null)).toBe('—');
	});

	it('opens a page the sitemap still lists, and offers a redirect for any other missing path', () => {
		const sites = localSites(8443);
		expect(sites.admin).toBe('https://admin-local.saha-textile.localhost:8443');
		expect(localSites(443).shop).toBe('https://local.saha-textile.localhost');
		expect(missingAction('/product/banarasi-red', 'yes', sites)).toEqual({
			label: 'Open product',
			href: 'https://local.saha-textile.localhost:8443/product/banarasi-red',
		});
		expect(missingAction('/old', 'yes', sites)?.label).toBe('Open page');
		expect(missingAction('/collections/silk old', 'no', sites)).toEqual({
			label: 'Add redirect',
			href: 'https://admin-local.saha-textile.localhost:8443/redirect/create?source=%2Fcollections%2Fsilk%20old',
		});
		expect(missingAction('/product/:id', 'no', sites)).toBeNull();
	});
});
