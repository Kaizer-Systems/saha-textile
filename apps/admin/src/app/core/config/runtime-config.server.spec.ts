// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from './runtime-config';

describe('loadRuntimeConfig on the server', () => {
	it('keeps the defaults', async () => {
		const held = { ...runtimeConfig };
		await loadRuntimeConfig();
		expect(runtimeConfig).toEqual(held);
	});
});
