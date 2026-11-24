import { describe, expect, it, vi } from 'vitest';

/**
 * Nest reads each controller's constructor types from decorator metadata, which the compiler writes
 * as `typeof X === "undefined" ? Object : X`. Every other test loads the real services, so this one
 * loads the controllers with those services missing, as a module cycle would leave them, to show
 * the metadata falls back to Object instead of failing.
 */
vi.mock('./lock/lock.service.js', async (load) => ({ ...(await load<object>()), LockService: undefined }));
vi.mock('./projects/projects.service.js', async (load) => ({ ...(await load<object>()), ProjectsService: undefined }));
vi.mock('./servers/droplet-jobs.js', async (load) => ({ ...(await load<object>()), DropletJobs: undefined }));
vi.mock('./products/products.service.js', async (load) => ({ ...(await load<object>()), ProductsService: undefined }));
vi.mock('./keys/key-source.js', async (load) => ({ ...(await load<object>()), KeySourceService: undefined }));
vi.mock('./store/console-store.js', async (load) => ({ ...(await load<object>()), ConsoleStore: undefined }));
vi.mock('./runner/runner-client.js', async (load) => ({ ...(await load<object>()), RunnerClient: undefined }));
vi.mock('./local/stats-collector.js', async (load) => ({ ...(await load<object>()), StatsCollector: undefined }));
vi.mock('./local-stack/local-stack.service.js', async (load) => ({
	...(await load<object>()),
	LocalStackService: undefined,
}));
vi.mock('@nestjs/core', async (load) => ({ ...(await load<object>()), Reflector: undefined }));

describe('controller and service metadata without what they are given', () => {
	it('still declares every controller, with Object for each missing type', async () => {
		const servers = await import('./servers/servers.controller.js');
		const state = await import('./servers/server-state.controller.js');
		const products = await import('./products/products.controller.js');
		const stack = await import('./local-stack/local-stack.controller.js');
		const types = (target: object) => Reflect.getMetadata('design:paramtypes', target) as unknown[];
		expect(types(servers.ServersController)).toEqual([Object, Object]);
		expect(types(servers.EnvTagsController)).toEqual([Object, Object]);
		expect(types(state.ServerStateController)).toEqual([Object, Object]);
		expect(types(products.ProductsController)).toEqual([Object, Object]);
		expect(types(stack.LocalStackController)).toEqual([Object]);
	});

	it('does the same for the services and the guard', async () => {
		const types = (target: object) => Reflect.getMetadata('design:paramtypes', target) as unknown[];
		const classes = [
			(await import('./projects/vendor-reads.service.js')).VendorReadsService,
			// These modules are the ones stood in for above, so their own classes come from the originals.
			(await vi.importActual<typeof import('./projects/projects.service.js')>('./projects/projects.service.js'))
				.ProjectsService,
			(await vi.importActual<typeof import('./lock/lock.service.js')>('./lock/lock.service.js')).LockService,
			(await import('./lock/session.guard.js')).SessionGuard,
			(await import('./local/local-alerts.js')).LocalAlerts,
			(await import('./local/request-log.js')).RequestLog,
			(
				await vi.importActual<typeof import('./local-stack/local-stack.service.js')>(
					'./local-stack/local-stack.service.js',
				)
			).LocalStackService,
		];
		for (const target of classes) expect(types(target as object).every((t) => t === Object)).toBe(true);
	});
});
