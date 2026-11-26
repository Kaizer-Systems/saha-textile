import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from '@core/config/runtime-config';

import { ActiveLanguages, provideActiveLanguages, savedLanguageLists, savedLanguages } from './active-languages';

const KEY = 'st_admin_languages';
const answer = (body: unknown, ok = true) =>
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);
/** The public list first, then the signed-in one (or a 401 when signed out). */
const answers = (shop: unknown, working: unknown | null) =>
	vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce({ ok: true, json: async () => shop } as Response)
		.mockResolvedValueOnce({ ok: working !== null, json: async () => working } as Response);

// The list is asked for once the runtime config has loaded; load it (empty, so the defaults stay).
beforeAll(async () => {
	answer({});
	await loadRuntimeConfig();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	TestBed.resetTestingModule();
});

describe('savedLanguages', () => {
	it('reads this browser’s last list, English first', () => {
		localStorage.setItem(KEY, JSON.stringify(['bn', 'en']));
		expect(savedLanguages()).toEqual(['en', 'bn']);
	});

	it('falls back to English alone for nothing, nonsense or refused storage', () => {
		localStorage.removeItem(KEY);
		expect(savedLanguages()).toEqual(['en']);
		localStorage.setItem(KEY, '{not json');
		expect(savedLanguages()).toEqual(['en']);
		localStorage.setItem(KEY, JSON.stringify(['en', '<b>']));
		expect(savedLanguages()).toEqual(['en']);
		const refusing = {
			defaultView: {
				localStorage: {
					getItem: () => {
						throw new Error('denied');
					},
				},
			},
		} as unknown as Document;
		expect(savedLanguages(refusing)).toEqual(['en']);
	});
});

describe('ActiveLanguages', () => {
	it('loads the API’s lists, keeps them for the next start, and asks the right addresses', async () => {
		localStorage.removeItem(KEY);
		const fetched = answers({ default: 'en', active: ['en', 'bn', 'hi'], admin: ['en', 'bn'] }, null);
		const languages = TestBed.inject(ActiveLanguages);
		expect(languages.list()).toEqual(['en']);
		await languages.load();
		expect(fetched).toHaveBeenNthCalledWith(1, `${runtimeConfig.apiUrl}/storefront/languages`, {
			credentials: 'omit',
		});
		expect(fetched).toHaveBeenNthCalledWith(2, `${runtimeConfig.apiUrl}/admin/languages`, {
			credentials: 'include',
		});
		expect(languages.list()).toEqual(['en', 'bn', 'hi']);
		expect(languages.adminList()).toEqual(['en', 'bn']);
		expect(savedLanguageLists()).toMatchObject({
			content: ['en', 'bn', 'hi'],
			admin: ['en', 'bn'],
			shop: ['en', 'bn', 'hi'],
		});
	});

	it('signed in, forms get every added language, drafts included; the header only the admin’s own', async () => {
		localStorage.removeItem(KEY);
		answers(
			{ default: 'en', active: ['en', 'bn'], admin: ['en', 'bn'] },
			{
				default: 'en',
				languages: [
					{ code: 'en', admin: true, shop: 'on' },
					{ code: 'bn', admin: true, shop: 'on' },
					{ code: 'hi', admin: false, shop: 'draft' },
				],
			},
		);
		const languages = TestBed.inject(ActiveLanguages);
		await languages.load();
		expect(languages.list()).toEqual(['en', 'bn', 'hi']);
		expect(languages.adminList()).toEqual(['en', 'bn']);
		expect([languages.isDraft('hi'), languages.isDraft('bn'), languages.isDraft('ta')]).toEqual([
			true,
			false,
			false,
		]);
		// Signed out next time: the public list stands, and the last copy keeps the draft for forms.
		answers({ default: 'en', active: ['en', 'bn'], admin: ['en', 'bn'] }, null);
		const again = TestBed.inject(ActiveLanguages);
		await again.load();
		expect(again.list()).toEqual(['en', 'bn', 'hi']);
		expect(savedLanguages()).toEqual(['en', 'bn']);
	});

	it('reads an older copy that held one list, and ignores a copy that is not one', () => {
		localStorage.setItem(KEY, JSON.stringify({ content: ['en', 'hi'], admin: 'en', states: { hi: 'draft' } }));
		expect(savedLanguageLists()).toEqual({
			content: ['en', 'hi'],
			admin: ['en'],
			shop: ['en'],
			states: { hi: 'draft' },
		});
		localStorage.setItem(KEY, JSON.stringify({ content: 'en' }));
		expect(savedLanguageLists().content).toEqual(['en']);
	});

	it('keeps the saved list when the API fails, refuses, or answers nonsense', async () => {
		localStorage.setItem(KEY, JSON.stringify(['en', 'bn']));
		const languages = TestBed.inject(ActiveLanguages);
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
		await languages.load();
		expect(languages.list()).toEqual(['en', 'bn']);
		answer({}, false);
		await languages.load();
		answer({ active: 'en' });
		await languages.load();
		expect(languages.list()).toEqual(['en', 'bn']);
	});

	it('still applies when storage is refused', async () => {
		answer({ default: 'en', active: ['en', 'ta'] });
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const languages = TestBed.inject(ActiveLanguages);
		await languages.load();
		expect(languages.list()).toContain('ta');
	});

	it('loads before the app starts and tells Transloco which languages exist', async () => {
		answer({ default: 'en', active: ['en', 'bn', 'hi'], admin: ['en', 'bn'] });
		const transloco = { setAvailableLangs: vi.fn() };
		TestBed.configureTestingModule({
			providers: [provideActiveLanguages(), { provide: TranslocoService, useValue: transloco }],
		});
		await TestBed.inject(ApplicationInitStatus).donePromise;
		expect(transloco.setAvailableLangs).toHaveBeenCalledWith(['en', 'bn']);
	});
});
