import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';
import { githubCliToken } from '../projects/projects.service.js';

function controller(job = { id: 'j1', kind: 'github', label: 'Sign in to GitHub' }) {
	const runner = { call: vi.fn(async (_method: string, _path: string) => job) };
	const store = { audit: vi.fn() };
	const c = new LocalController(
		runner as never,
		{} as never,
		{} as never,
		store as never,
		{} as never,
		{} as never,
		{} as never,
	);
	return { c, runner, store };
}

describe('the GitHub sign-in from the console', () => {
	it('starts the helper’s fixed sign-in job, without a PIN, and logs it', async () => {
		const { c, runner, store } = controller();
		await c.githubLogin();
		expect(runner.call).toHaveBeenCalledWith('POST', '/run/github-login', {});
		expect(store.audit).toHaveBeenCalledWith(null, 'github-sign-in-started', 'Sign in to GitHub');
	});

	it('stops only a GitHub sign-in job', async () => {
		const ok = controller();
		await ok.c.stopGithubLogin('j1');
		expect(ok.runner.call).toHaveBeenLastCalledWith('POST', '/jobs/j1/stop');
		const other = controller({ id: 'p1', kind: 'pipeline', label: 'Local pipeline' });
		await expect(other.c.stopGithubLogin('p1')).rejects.toThrow(/Only a GitHub sign-in/);
		expect(other.runner.call).not.toHaveBeenCalledWith('POST', '/jobs/p1/stop');
		await expect(ok.c.stopGithubLogin('../x')).rejects.toThrow(/No such job/);
	});

	it('reads the CLI sign-in through the Mac helper when this container has no gh', async () => {
		const noGh = async () => Promise.reject(new Error('gh: not found'));
		const helper = { call: vi.fn(async () => ({ token: 'gh-token-not-real' })) };
		expect(await githubCliToken(helper as never, noGh)).toBe('gh-token-not-real');
		expect(helper.call).toHaveBeenCalledWith('GET', '/github/token', undefined, 10_000);
		const down = { call: vi.fn(async () => Promise.reject(new Error('helper down'))) };
		expect(await githubCliToken(down as never, noGh)).toBeNull();
		const localGh = async () => ({ stdout: 'local-token-not-real\n' });
		expect(await githubCliToken(down as never, localGh)).toBe('local-token-not-real');
	});
});
