import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/app-config', async (load) => ({
	...(await load<object>()),
	loadConfig: () => ({ search: { host: 'http://search.test', apiKey: 'k', index: 'products' }, locales: ['en'] }),
}));

describe('the search index a release script uses', () => {
	it('carries the languages the store holds when the index is built', async () => {
		const { releaseSearch } = await import('../src/search/search-release.js');
		const search = releaseSearch({ content: () => ['en', 'bn'] } as never) as unknown as {
			locales: () => readonly string[];
		};
		expect(search.locales()).toEqual(['en', 'bn']);
	});
});
