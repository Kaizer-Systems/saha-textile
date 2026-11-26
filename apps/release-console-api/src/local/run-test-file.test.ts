import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';

const req = { headers: { 'x-console-session': 'session' } } as never;

function controller(pinOk = true) {
	const runner = { call: vi.fn(async () => ({ id: 'j1', label: 'Run apps/a/src/x.spec.ts', status: 'running' })) };
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
		{} as never,
	);
	return { c, runner, lock, store };
}

describe('running one test file on this Mac (Coverage)', () => {
	it('hands the helper the test file after the PIN, and records the run', async () => {
		const { c, runner, lock, store } = controller();
		await c.run(req, 'test-file', { pin: '135790', path: 'apps/a/src/x.spec.ts' });
		expect(lock.confirm).toHaveBeenCalledWith('session', '135790', 'test-file');
		expect(runner.call).toHaveBeenCalledWith('POST', '/run/test-file', { path: 'apps/a/src/x.spec.ts' });
		expect(store.audit).toHaveBeenCalledWith(null, 'local-job-started', 'Run apps/a/src/x.spec.ts');
		await c.run(req, 'stack-up', { pin: '135790' });
		expect(runner.call).toHaveBeenLastCalledWith('POST', '/run/stack-up', {});
	});

	it('needs the file named, and the PIN, before anything runs', async () => {
		const { c, runner } = controller();
		await expect(c.run(req, 'test-file', { pin: '135790' })).rejects.toThrow('Name the test file to run.');
		await expect(c.run(req, 'test-file', { pin: '135790', path: 'scripts/a.test.mjs' })).rejects.toThrow();
		const refused = controller(false);
		await expect(refused.c.run(req, 'test-file', { pin: '000000', path: 'apps/a/src/x.spec.ts' })).rejects.toThrow(
			'Wrong PIN',
		);
		expect(runner.call).not.toHaveBeenCalled();
		expect(refused.runner.call).not.toHaveBeenCalled();
	});
});
