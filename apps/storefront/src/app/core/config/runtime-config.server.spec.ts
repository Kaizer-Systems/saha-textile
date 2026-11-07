// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from './runtime-config';

const held = { ...runtimeConfig };

afterEach(() => {
	delete process.env['SAHA_TEXTILE_PUBLIC_CONFIG'];
	delete process.env['DEPLOY_ENV'];
	Object.assign(runtimeConfig, held);
});

describe('loadRuntimeConfig on the server', () => {
	it('reads the injected JSON', async () => {
		process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = JSON.stringify({ apiUrl: 'https://api.server' });
		await loadRuntimeConfig();
		expect(runtimeConfig.apiUrl).toBe('https://api.server');
	});

	it('keeps the defaults without it', async () => {
		await loadRuntimeConfig();
		expect(runtimeConfig.apiUrl).toBe(held.apiUrl);
	});

	it.each(['staging', 'production'])('refuses to start on %s without a real API address', async (deployEnv) => {
		process.env['DEPLOY_ENV'] = deployEnv;
		await expect(loadRuntimeConfig()).rejects.toThrow('Runtime config is missing');
		process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = JSON.stringify({ apiUrl: 'https://localhost:4000' });
		await expect(loadRuntimeConfig()).rejects.toThrow('points at localhost');
	});

	it('starts on a deployment with a real API address', async () => {
		process.env['DEPLOY_ENV'] = 'production';
		process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = JSON.stringify({ apiUrl: 'https://api.sahatextile.com' });
		await loadRuntimeConfig();
		expect(runtimeConfig.apiUrl).toBe('https://api.sahatextile.com');
	});
});
