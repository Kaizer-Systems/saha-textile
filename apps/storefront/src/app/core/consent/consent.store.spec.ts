import { HttpClient } from '@angular/common/http';
import { DOCUMENT, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ConsentStore } from './consent.store';
import { COOKIE_POLICY_VERSION } from './cookie-catalogue';

vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const cookie = (categories: object, version = COOKIE_POLICY_VERSION) =>
	`st_consent=${encodeURIComponent(JSON.stringify({ id: 'id-1', version, savedAt: 'at', categories }))}`;

const setup = (options: { cookie?: string; platform?: string; protocol?: string; post?: unknown; get?: unknown } = {}) => {
	const written: string[] = [];
	const removed: string[] = [];
	const page = {
		location: { protocol: options.protocol ?? 'https:' },
		defaultView: { localStorage: { removeItem: (key: string) => removed.push(key) } },
		get cookie() {
			return options.cookie ?? 'other=1';
		},
		set cookie(value: string) {
			written.push(value);
		},
	};
	const http = {
		post: vi.fn(() => options.post ?? of({})),
		get: vi.fn(() => options.get ?? of({ policyVersion: null, categories: {} })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: DOCUMENT, useValue: page },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: HttpClient, useValue: http },
		],
	});
	return { store: TestBed.inject(ConsentStore), written, removed, http };
};
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('ConsentStore', () => {
	it('never shows the box on the server', () => {
		const { store } = setup({ platform: 'server' });
		expect(store.boxOpen()).toBe(false);
		expect(store.allows('functional')).toBe(false);
	});

	it('shows the box to a first-time visitor, with everything optional off', () => {
		const { store } = setup();
		expect(store.boxOpen()).toBe(true);
		expect(store.decided()).toBe(false);
		expect(store.allows('functional')).toBe(false);
	});

	it('remembers a saved choice', () => {
		const { store } = setup({ cookie: `a=1; ${cookie({ functional: true })}` });
		expect(store.boxOpen()).toBe(false);
		expect(store.allows('functional')).toBe(true);
		expect(store.allows('marketing')).toBeFalsy();
	});

	it('asks again after a policy change, and ignores a damaged cookie', () => {
		expect(setup({ cookie: cookie({ functional: true }, 'old') }).store.decided()).toBe(false);
		expect(setup({ cookie: 'st_consent=%7Bbad' }).store.decided()).toBe(false);
		expect(setup({ cookie: 'st_consent=' }).store.decided()).toBe(false);
		expect(setup({ cookie: `st_consent=${encodeURIComponent('{}')}` }).store.decided()).toBe(false);
	});

	it('counts each request for Cookie settings', () => {
		const { store } = setup();
		store.openSettings();
		store.openSettings();
		expect(store.settingsRequests()).toBe(2);
	});

	it('saves an acceptance and records it, keeping what is stored', async () => {
		const { store, written, removed, http } = setup();
		store.save({ functional: true });
		await flush();
		expect(store.allows('functional')).toBe(true);
		expect(written).toHaveLength(1);
		expect(written[0]).toContain('st_consent=');
		expect(written[0]).toContain('Max-Age=31536000');
		expect(written[0]).toContain('Secure');
		expect(removed).toEqual([]);
		expect(http.post).toHaveBeenCalledWith(
			'https://api.test/privacy/consent',
			expect.objectContaining({
				policyVersion: COOKIE_POLICY_VERSION,
				consentId: store.choice()?.id,
				categories: expect.objectContaining({ necessary: true, functional: true, marketing: false }),
			}),
		);
	});

	it('removes what a refusal covers, at once', () => {
		const { store, written, removed } = setup({ protocol: 'http:' });
		store.save({});
		expect(store.allows('functional')).toBe(false);
		expect(written[0]).not.toContain('Secure');
		expect(written.slice(1).join()).toContain('st_locale=; Max-Age=0');
		expect(written.slice(1).join()).toContain('st_newsletter=; Max-Age=0');
		expect(removed).toEqual(['st_recent', 'selectedCurrency']);
	});

	it('keeps one id across changes of mind', () => {
		const { store } = setup({ cookie: cookie({ functional: true }) });
		store.save({});
		expect(store.choice()?.id).toBe('id-1');
	});

	it('keeps the decision when the history cannot be written', async () => {
		const { store } = setup({ post: throwError(() => new Error('down')) });
		store.save({ functional: true });
		await flush();
		expect(store.allows('functional')).toBe(true);
	});

	describe('on sign-in', () => {
		it('adds this device\'s choice to the account', async () => {
			const { store, http } = setup({ cookie: cookie({ functional: true }) });
			await store.syncAccount();
			expect(http.post).toHaveBeenCalledOnce();
			expect(http.get).not.toHaveBeenCalled();
		});

		it('picks up the account\'s choice on a new device', async () => {
			const categories = { functional: true, analytics: false, targeting: false, marketing: false, promotional: false };
			const { store, written } = setup({ get: of({ policyVersion: COOKIE_POLICY_VERSION, categories }) });
			await store.syncAccount();
			expect(store.allows('functional')).toBe(true);
			expect(written).toHaveLength(1);
		});

		it('asks again when the account holds an older policy, or cannot be read', async () => {
			const old = setup({ get: of({ policyVersion: 'old', categories: {} }) });
			await old.store.syncAccount();
			expect(old.store.decided()).toBe(false);
			const down = setup({ get: throwError(() => new Error('down')) });
			await down.store.syncAccount();
			expect(down.store.decided()).toBe(false);
		});
	});
});
