// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from './runtime-config';

const held = { ...runtimeConfig };

afterEach(() => {
	delete process.env['SAHA_TEXTILE_PUBLIC_CONFIG'];
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
});
