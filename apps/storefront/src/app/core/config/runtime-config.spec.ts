import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	loadRuntimeConfig,
	loadServedConfig,
	provideRuntimeConfig,
	runtimeConfig,
	runtimeConfigReady,
} from './runtime-config';
import { environment } from '../../../../public/environments/environment';

const held = { ...runtimeConfig };

beforeEach(() => Object.assign(runtimeConfig, held));
afterEach(() => vi.unstubAllGlobals());

describe('loadRuntimeConfig in the browser', () => {
	it('applies the served config and keeps the legacy environment in step', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ apiUrl: 'https://api.test', siteUrl: 'https://shop.test' }),
			})),
		);
		await loadRuntimeConfig();
		await runtimeConfigReady;
		expect(runtimeConfig.apiUrl).toBe('https://api.test');
		expect(environment.apiUrl).toBe('https://api.test');
		expect(environment.baseURL).toBe('https://shop.test/');
		expect(environment.URL).toBe('https://shop.test/assets/data');
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
		expect(runtimeConfig.apiUrl).toBe(held.apiUrl);
	});
});

describe('provideRuntimeConfig', () => {
	it('returns an initializer provider', () => {
		expect(provideRuntimeConfig()).toBeDefined();
	});
});

describe('loadRuntimeConfig on a deployed host', () => {
	const host = 'shop.example.test';

	it('refuses a missing, cut-off or localhost config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false })),
		);
		await expect(loadServedConfig(host, true)).rejects.toThrow('Runtime config is missing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => {
					throw new SyntaxError('cut off');
				},
			})),
		);
		await expect(loadServedConfig(host, true)).rejects.toThrow('Runtime config is missing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ apiUrl: 'https://localhost:4000' }) })),
		);
		await expect(loadServedConfig(host, true)).rejects.toThrow('points at localhost');
	});

	it('starts with a real API address', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ apiUrl: 'https://api.example.test' }) })),
		);
		await loadServedConfig(host, true);
		expect(runtimeConfig.apiUrl).toBe('https://api.example.test');
	});

	it('does not treat being offline as a broken deployment', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			}),
		);
		await expect(loadServedConfig(host, false)).resolves.toBeUndefined();
	});
});
