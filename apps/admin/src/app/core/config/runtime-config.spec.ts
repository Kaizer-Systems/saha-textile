import { HttpClient } from '@angular/common/http';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { provideAdminSessionBootstrap } from '@core/auth/session-bootstrap';
import { TranslocoHttpLoader } from '@core/i18n/transloco-loader';
import { AuthStore } from '@core/state/auth.store';

import {
	loadRuntimeConfig,
	loadServedConfig,
	provideRuntimeConfig,
	runtimeConfig,
	runtimeConfigReady,
} from './runtime-config';
import { environment } from '../../../../public/environments/environment';

const held = { ...runtimeConfig };

afterEach(() => {
	vi.unstubAllGlobals();
	Object.assign(runtimeConfig, held);
});

describe('loadRuntimeConfig', () => {
	it('applies the served config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ apiUrl: 'https://api.test', adminUrl: 'https://a.test' }),
			})),
		);
		await loadRuntimeConfig();
		await runtimeConfigReady;
		expect(environment.apiUrl).toBe('https://api.test');
		expect(environment.URL).toBe('https://a.test/assets/data');
	});

	it('keeps the defaults on a bad answer or a failed fetch', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false })),
		);
		await loadRuntimeConfig();
		expect(runtimeConfig.apiUrl).toBe(held.apiUrl);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('down');
			}),
		);
		await expect(loadRuntimeConfig()).resolves.toBeUndefined();
	});

	it('returns its provider', () => {
		expect(provideRuntimeConfig()).toBeDefined();
	});
});

describe('provideAdminSessionBootstrap', () => {
	it('resolves the session once the config is ready', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false })),
		);
		await loadRuntimeConfig();
		const store = { bootstrap: vi.fn(async () => undefined) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: AuthStore, useValue: store }, provideAdminSessionBootstrap()],
		});
		await TestBed.inject(ApplicationInitStatus).donePromise;
		expect(store.bootstrap).toHaveBeenCalledOnce();
	});
});

describe('TranslocoHttpLoader', () => {
	it('reads the dictionary', () => {
		const get = vi.fn(() => of({}));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get } }] });
		TestBed.inject(TranslocoHttpLoader).getTranslation('fr');
		expect(get).toHaveBeenCalledWith('/assets/i18n/fr.json');
	});
});

describe('loadRuntimeConfig on a deployed host', () => {
	const host = 'shop.example.test';

	it('refuses a missing, cut-off or localhost config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false })),
		);
		await expect(loadServedConfig(host)).rejects.toThrow('Runtime config is missing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => {
					throw new SyntaxError('cut off');
				},
			})),
		);
		await expect(loadServedConfig(host)).rejects.toThrow('Runtime config is missing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ apiUrl: 'https://localhost:4000' }) })),
		);
		await expect(loadServedConfig(host)).rejects.toThrow('points at localhost');
	});

	it('starts with a real API address', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ apiUrl: 'https://api.example.test' }) })),
		);
		await loadServedConfig(host);
		expect(runtimeConfig.apiUrl).toBe('https://api.example.test');
	});
});
