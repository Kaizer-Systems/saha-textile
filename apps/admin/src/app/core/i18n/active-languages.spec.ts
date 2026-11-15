import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from '@core/config/runtime-config';

import { ActiveLanguages, provideActiveLanguages, savedLanguages } from './active-languages';

const KEY = 'st_admin_languages';
const answer = (body: unknown, ok = true) =>
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);

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
	it('loads the API’s list, keeps it for the next start, and asks the right address', async () => {
		localStorage.removeItem(KEY);
		const fetched = answer({ default: 'en', active: ['en', 'bn', 'hi'] });
		const languages = TestBed.inject(ActiveLanguages);
		expect(languages.list()).toEqual(['en']);
		await languages.load();
		expect(fetched).toHaveBeenCalledWith(`${runtimeConfig.apiUrl}/storefront/languages`, { credentials: 'omit' });
		expect(languages.list()).toEqual(['en', 'bn', 'hi']);
		expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['en', 'bn', 'hi']);
	});

	it('keeps the saved list when the API fails, refuses, or answers nonsense', async () => {
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
		expect(languages.list()).toEqual(['en', 'ta']);
	});

	it('loads before the app starts and tells Transloco which languages exist', async () => {
		answer({ default: 'en', active: ['en', 'bn'] });
		const transloco = { setAvailableLangs: vi.fn() };
		TestBed.configureTestingModule({
			providers: [provideActiveLanguages(), { provide: TranslocoService, useValue: transloco }],
		});
		await TestBed.inject(ApplicationInitStatus).donePromise;
		expect(transloco.setAvailableLangs).toHaveBeenCalledWith(['en', 'bn']);
	});
});
