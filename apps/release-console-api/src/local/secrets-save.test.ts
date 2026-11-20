import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';

const req = { headers: { 'x-console-session': 's1' } } as never;
const body = (over: Record<string, unknown> = {}) => ({
	tier: 'staging',
	projectId: 'p',
	pin: '135790',
	confirmName: 'staging',
	changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }],
	...over,
});

function controller(pinOk = true) {
	const runner = {
		call: vi.fn(async () => ({
			tier: 'staging',
			project: 'saha-textile-staging',
			environment: 'staging',
			results: [{ folder: 'api', names: ['COOKIE_DOMAIN'], saved: true, error: null }],
		})),
	};
	const lock = {
		confirm: vi.fn(() => {
			if (!pinOk) throw new ForbiddenException('Wrong PIN or password.');
		}),
	};
	const store = { audit: vi.fn() };
	const c = new LocalController(
		runner as never,
		{} as never,
		lock as never,
		store as never,
		{} as never,
		{} as never,
	);
	return { c, runner, lock, store };
}

describe('saving Secrets drafts', () => {
	it('needs the environment’s name typed for staging and production, before anything else', async () => {
		const { c, runner, lock } = controller();
		await expect(c.saveSecrets(req, body({ confirmName: 'prod' }))).rejects.toThrow(/Type staging/);
		expect(lock.confirm).not.toHaveBeenCalled();
		expect(runner.call).not.toHaveBeenCalled();
	});

	it('sends nothing on a wrong PIN', async () => {
		const { c, runner } = controller(false);
		await expect(c.saveSecrets(req, body())).rejects.toThrow(/Wrong PIN/);
		expect(runner.call).not.toHaveBeenCalled();
	});

	it('saves through the helper and logs names only', async () => {
		const { c, runner, store } = controller();
		const answer = await c.saveSecrets(req, body());
		expect(runner.call).toHaveBeenCalledWith(
			'POST',
			'/secrets/save',
			{ tier: 'staging', changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }] },
			190_000,
		);
		expect(store.audit).toHaveBeenCalledWith(
			'p',
			'secrets-saved',
			'saha-textile-staging · staging · /api: COOKIE_DOMAIN',
		);
		expect(JSON.stringify(store.audit.mock.calls)).not.toContain('test-value-not-real');
		expect(JSON.stringify(answer)).not.toContain('test-value-not-real');
	});

	it('needs no typed name for dev', async () => {
		const { c, runner } = controller();
		await c.saveSecrets(req, body({ tier: 'dev', confirmName: '' }));
		expect(runner.call).toHaveBeenCalledTimes(1);
	});
});
