import { describe, expect, it, vi } from 'vitest';

import { RotationController } from './rotation.controller.js';

import type { ProjectsService } from './projects.service.js';
import type { LockService } from '../lock/lock.service.js';
import type { ConsoleStore } from '../store/console-store.js';

/** Names only: the rotate script and the Infisical places answer locally. */
const env = (name: string, cloudId: string | null, secretsId: string | null, secretsPath: string) => ({
	name,
	label: name,
	cloudId,
	secretsId,
	secretsPath,
	domains: [],
});
const REPO = {
	name: 'shop',
	secrets: [
		{ id: 'inf', vendor: 'infisical' },
		{ id: 'aws', vendor: 'aws-secrets-manager' },
	],
	environments: [
		env('local', null, 'inf', 'acme-local/dev'),
		env('staging', 'do', 'inf', 'acme-staging/staging'),
		env('production', 'do', 'inf', 'acme-production/prod'),
		env('qa', 'do', 'aws', 'qa'),
		env('demo', 'do', 'inf', 'acme-demo/demo'),
	],
};
const RESULT = {
	tier: 'staging',
	project: 'acme-staging',
	at: '2026-11-24T00:00:00Z',
	changed: ['MONGO_APP_PASSWORD'],
	movedToPrevious: ['SESSION_SECRET'],
	clearedPrevious: [],
	needsRotateDeploy: true,
};

function make() {
	let state = {
		pending: [] as string[],
		lastChanged: [] as string[],
		graceNames: [] as string[],
		graceAt: null as string | null,
	};
	const projects = {
		repository: () => ({ project: {}, repo: REPO }),
		rotation: () => state,
		setRotation: vi.fn((_p: string, _r: string, _e: string, next: typeof state) => (state = next)),
	} as unknown as ProjectsService;
	const audit = vi.fn();
	const c = new RotationController(
		projects,
		{ confirm: vi.fn() } as unknown as LockService,
		{ audit } as unknown as ConsoleStore,
	);
	const call = vi.fn(async (_m: string, path: string): Promise<unknown> =>
		path === '/secrets/places'
			? {
					places: [
						{ project: 'acme-staging', environment: 'staging', tier: 'staging' },
						{ project: 'acme-production', environment: 'prod', tier: 'local' },
					],
				}
			: RESULT,
	);
	Object.assign(c, { helper: { call } });
	return { c, call, audit };
}
const req = { headers: {} } as never;

describe('secret rotation routes', () => {
	it('finds each environment’s server tier, and none for this computer, another vendor or an unknown place', async () => {
		const { c, call } = make();
		expect((await c.view('acme', 'shop', 'staging')).tier).toBe('staging');
		expect((await c.view('acme', 'shop', 'local')).tier).toBeNull();
		expect((await c.view('acme', 'shop', 'qa')).tier).toBeNull();
		expect((await c.view('acme', 'shop', 'production')).tier).toBeNull();
		expect((await c.view('acme', 'shop', 'demo')).tier).toBeNull();
		call.mockRejectedValueOnce(new Error('helper down'));
		expect((await c.view('acme', 'shop', 'staging')).tier).toBeNull();
		await expect(c.view('acme', 'shop', 'nowhere')).rejects.toThrow('shop has no environment nowhere.');
	});

	it('rotates after the PIN and the typed name, and words the audit line', async () => {
		const { c, call, audit } = make();
		const body = (confirm: string, grace: boolean) => ({ pin: '123456', confirm, ids: ['mongo-app'], grace });
		await expect(c.rotate(req, 'acme', 'shop', 'local', body('local', true))).rejects.toThrow('has no server tier');
		await expect(c.rotate(req, 'acme', 'shop', 'staging', body('prod', true))).rejects.toThrow(
			'Type staging to confirm.',
		);
		const view = await c.rotate(req, 'acme', 'shop', 'staging', body('staging', true));
		expect(view.tier).toBe('staging');
		expect(audit).toHaveBeenLastCalledWith(
			'acme',
			'secrets-rotated',
			expect.stringContaining('on a schedule · MONGO_APP_PASSWORD · kept as previous: SESSION_SECRET'),
		);
		call.mockImplementation(async (_m: string, path: string) =>
			path === '/secrets/places'
				? { places: [{ project: 'acme-staging', environment: 'staging', tier: 'staging' }] }
				: { ...RESULT, changed: [], movedToPrevious: [] },
		);
		await c.rotate(req, 'acme', 'shop', 'staging', body('staging', false));
		expect(audit).toHaveBeenLastCalledWith('acme', 'secrets-rotated', 'staging · after a leak · nothing changed');
	});

	it('removes the old keys, words what it cleared, and refuses an unknown answer', async () => {
		const { c, call, audit } = make();
		await expect(c.clearPrevious(req, 'acme', 'shop', 'local', { pin: '123456' })).rejects.toThrow(
			'has no server tier',
		);
		await c.clearPrevious(req, 'acme', 'shop', 'staging', { pin: '123456' });
		expect(audit).toHaveBeenLastCalledWith('acme', 'secrets-previous-removed', 'staging · none were kept');
		call.mockImplementation(async (_m: string, path: string) =>
			path === '/secrets/places'
				? { places: [{ project: 'acme-staging', environment: 'staging', tier: 'staging' }] }
				: { ...RESULT, clearedPrevious: ['SESSION_SECRET_PREVIOUS'] },
		);
		await c.clearPrevious(req, 'acme', 'shop', 'staging', { pin: '123456' });
		expect(audit).toHaveBeenLastCalledWith('acme', 'secrets-previous-removed', 'staging · SESSION_SECRET_PREVIOUS');
		call.mockImplementation(async (_m: string, path: string) =>
			path === '/secrets/places'
				? { places: [{ project: 'acme-staging', environment: 'staging', tier: 'staging' }] }
				: { nope: 1 },
		);
		await expect(c.clearPrevious(req, 'acme', 'shop', 'staging', { pin: '123456' })).rejects.toThrow(
			'answered in a shape the console does not know',
		);
	});
});
