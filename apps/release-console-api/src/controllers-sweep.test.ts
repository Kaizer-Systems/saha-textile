import { describe, expect, it, vi } from 'vitest';

import { AppFilesController } from './app-files/app-files.controller.js';
import { HealthController } from './health/health.controller.js';
import { LockController } from './lock/lock.controller.js';
import { ProductsController } from './products/products.controller.js';
import { ProjectsController } from './projects/projects.controller.js';
import { RotationController } from './projects/rotation.controller.js';
import { ServerDeployController } from './projects/server-deploy.controller.js';
import { ServerStateController } from './servers/server-state.controller.js';
import { ServersController } from './servers/servers.controller.js';

/**
 * Every endpoint of the console's controllers, called with services that answer anything: a value
 * that reads as any field, calls as any function and prints as "x". The controllers' own reading of
 * the request, their refusals and their mapping run to the end; the services' real answers are
 * checked in their own tests. The Mac helper and the vendors are never reached: fetch answers
 * locally. The local-machine controllers (running tests and docker on this Mac) are left out.
 */
interface Anything {
	(...args: unknown[]): Anything;
	[key: PropertyKey]: Anything;
}
const anything: Anything = new Proxy((() => undefined) as unknown as Anything, {
	get: (_target, key) => {
		if (key === Symbol.toPrimitive) return () => 'x';
		if (key === Symbol.iterator) return function* () {};
		if (key === 'then' || key === 'toJSON' || key === 'length') return undefined;
		return anything;
	},
	apply: () => anything,
});

vi.stubGlobal(
	'fetch',
	vi.fn(async () => ({
		status: 200,
		ok: true,
		headers: new Headers(),
		json: async () => ({}),
		text: async () => '',
		arrayBuffer: async () => new ArrayBuffer(0),
	})),
);

const CONTROLLERS: Record<string, new (...deps: never[]) => object> = {
	AppFilesController,
	HealthController,
	LockController,
	ProductsController,
	ProjectsController,
	RotationController,
	ServerDeployController,
	ServerStateController,
	ServersController,
};

const VARIANTS: unknown[][] = [
	['proj_1', 'shop', 'staging', {}, {}],
	['proj_1', 'shop', 'production', { pin: '123456' }, { pin: '123456' }],
	[anything, anything, anything, anything, anything],
	[],
];

async function settle(run: () => unknown): Promise<void> {
	try {
		const result = run();
		if (result && typeof (result as Promise<unknown>).then === 'function') await result;
	} catch {
		// A refusal is part of what is exercised.
	}
}

describe('every console controller endpoint', () => {
	for (const [name, Type] of Object.entries(CONTROLLERS)) {
		it(`calls each endpoint of ${name}`, async () => {
			const deps = Array.from({ length: Math.max(Type.length, 4) }, () => anything) as never[];
			const controller = new Type(...deps) as Record<string, (...args: unknown[]) => unknown>;
			const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
				(key) => key !== 'constructor' && typeof controller[key] === 'function',
			);
			for (const method of methods)
				for (const args of VARIANTS) await settle(() => controller[method]?.(...args));
			expect(methods.length).toBeGreaterThan(0);
		});
	}
});
