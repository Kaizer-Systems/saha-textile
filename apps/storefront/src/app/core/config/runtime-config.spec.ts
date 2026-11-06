import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, provideRuntimeConfig, runtimeConfig, runtimeConfigReady } from './runtime-config';
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
