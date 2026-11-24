import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoModule } from '../src/geo/geo.module';
import { LanguageStore } from '../src/languages/language-store';
import { EmailPicturesService } from '../src/media/email-pictures.service';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('the language store: the remaining cases', () => {
	const repo = () => ({ seedIfEmpty: vi.fn(async () => undefined), list: vi.fn(async () => []) });

	it('reads nothing without a repository, and starts nothing then or while the documentation is built', async () => {
		const fixed = LanguageStore.fixed(['en', 'bn']);
		await expect(fixed.refresh()).resolves.toBeUndefined();
		fixed.onApplicationBootstrap();
		fixed.onModuleDestroy();
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		const stored = repo();
		new LanguageStore(stored as never, { locales: ['en', 'bn'] }).onApplicationBootstrap();
		expect(stored.list).not.toHaveBeenCalled();
	});

	it('reads at start and every half minute, keeping the last list when a read fails, until destroyed', async () => {
		vi.useFakeTimers();
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		const stored = repo();
		stored.list.mockRejectedValueOnce(new Error('database down'));
		const store = new LanguageStore(stored as never, { locales: ['en', 'bn'] });
		store.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(31_000);
		expect(stored.list).toHaveBeenCalledTimes(2);
		expect(store.shop()).toContain('en');
		store.onModuleDestroy();
		await vi.advanceTimersByTimeAsync(61_000);
		expect(stored.list).toHaveBeenCalledTimes(2);
	});
});

describe('email pictures: the remaining cases', () => {
	const row = (key: string, goneBy: string | null) => ({ key, goneBy, goneAt: '2026-11-20T00:00:00.000Z' });

	it('names who removed a photo by any name they have, nobody when unknown or unreadable, and pages on from the last key', async () => {
		const rows = Array.from({ length: 100 }, (_, index) =>
			row(`k${index}`, ['adm_a', 'adm_b', 'adm_c', 'adm_d', null][index % 5] ?? null),
		);
		const findById = vi.fn(async (id: string) => {
			if (id === 'adm_a') return { displayName: null, username: 'rina' };
			if (id === 'adm_b') return { displayName: null, username: null, email: 'mou@example.test' };
			if (id === 'adm_c') return { displayName: null, username: null, email: null };
			throw new Error('down');
		});
		const service = new EmailPicturesService(
			{ list: async () => rows, totals: async () => ({ count: 100, bytes: 1 }), count: async () => 100 } as never,
			{ getUrl: (key: string) => `https://cdn.test/${key}` },
			{ enqueue: vi.fn() } as never,
			{ append: vi.fn() } as never,
			{ findById } as never,
		);
		const page = await service.list({ sent: 'all' } as never);
		expect(page.rows.slice(0, 5).map((entry) => entry.goneByName)).toEqual([
			'rina',
			'mou@example.test',
			null,
			null,
			null,
		]);
		expect(page.next).toBe('k99');
	});
});

describe('country data at start-up', () => {
	it('warns when the country data cannot be read, whatever is thrown, and checks nothing in tests', async () => {
		vi.stubEnv('VITEST', '');
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		const geo = {
			countries: vi.fn().mockRejectedValueOnce(new Error('no upload')).mockRejectedValueOnce('not an error'),
		};
		new GeoModule(geo as never).onApplicationBootstrap();
		new GeoModule(geo as never).onApplicationBootstrap();
		await Promise.resolve();
		expect(geo.countries).toHaveBeenCalledTimes(2);
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		new GeoModule(geo as never).onApplicationBootstrap();
		expect(geo.countries).toHaveBeenCalledTimes(2);
	});
});
