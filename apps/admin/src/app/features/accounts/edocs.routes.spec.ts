import { describe, expect, it } from 'vitest';

import routes from './edocs.routes';

describe('Accounts routes', () => {
	it('loads a page for every path', async () => {
		for (const route of routes) expect(typeof (await route.loadComponent())).toBe('function');
	});
});
