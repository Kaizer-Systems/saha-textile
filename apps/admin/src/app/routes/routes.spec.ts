import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { content } from './content.routes';
import { full } from './full.routes';
import settingRoutes from '../features/setting/setting.routes';

interface Loadable {
	loadChildren?: () => Promise<unknown>;
	loadComponent?: () => Promise<unknown>;
}

describe('route tables', () => {
	it.each(content.map((route) => [route.path, route] as const))(
		'content route %s loads',
		async (_path, route) => {
			// A section loads its children; a single page (such as the worklist) loads its component.
			const { loadChildren, loadComponent } = route as Loadable;
			await expect((loadChildren ?? loadComponent)?.()).resolves.toBeDefined();
		},
		30_000,
	);

	it.each(full.map((route) => [route.path, route] as const))(
		'full route %s loads',
		async (_path, route) => {
			await expect((route as Loadable).loadChildren?.()).resolves.toBeDefined();
		},
		30_000,
	);

	it('sends the bare address to the dashboard, whose guard handles signed-out visitors', () => {
		const root = routes.find((route) => route.path === '' && route.redirectTo);
		expect(root).toMatchObject({ redirectTo: 'dashboard', pathMatch: 'full' });
	});

	it('loads the top-level shells', async () => {
		const lazy = routes.filter((route) => route.loadChildren || route.loadComponent) as Loadable[];
		expect(lazy.length).toBeGreaterThan(2);
		for (const route of lazy) {
			await expect((route.loadChildren ?? route.loadComponent)?.()).resolves.toBeDefined();
		}
	}, 30_000);

	it('loads the notification settings screen', async () => {
		const route = settingRoutes.find((entry) => entry.path === 'notifications') as Loadable;
		await expect(route.loadComponent?.()).resolves.toBeDefined();
		const brand = settingRoutes.find((entry) => entry.path === 'brand') as Loadable;
		await expect(brand.loadComponent?.()).resolves.toBeDefined();
		for (const path of ['stores', 'stores/create', 'stores/edit/:id']) {
			const stores = settingRoutes.find((entry) => entry.path === path) as Loadable;
			await expect(stores.loadComponent?.()).resolves.toBeDefined();
		}
	}, 30_000);
});
