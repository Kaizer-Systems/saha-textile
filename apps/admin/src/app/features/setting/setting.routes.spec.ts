import { describe, expect, it } from 'vitest';

import routes from './setting.routes';

describe('Settings routes', () => {
	it('loads a page for every path', async () => {
		for (const route of routes)
			expect(typeof (route.loadComponent ? await route.loadComponent() : route.component)).toBe('function');
		expect(routes.some((route) => route.path === 'accounts-templates')).toBe(true);
	});
});
