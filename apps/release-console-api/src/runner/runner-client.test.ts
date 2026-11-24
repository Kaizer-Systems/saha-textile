import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HelperError, RunnerClient } from './runner-client.js';

/**
 * The client for the Mac helper, with its own key file and a stubbed network, so it reads the same on this Mac
 * (where the helper's real key file exists) as in a clean copy and in CI (where it does not).
 */

const keyFile = (contents: string | null): string => {
	const dir = mkdtempSync(join(tmpdir(), 'runner-client-'));
	const file = join(dir, 'runner-token');
	if (contents !== null) writeFileSync(file, contents);
	return file;
};

const answer = (status: number, body: string) =>
	vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('RunnerClient', () => {
	it('says the helper has not run when its key file is missing or blank', async () => {
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile(null));
		await expect(new RunnerClient().call('GET', '/mac')).rejects.toMatchObject({ status: 503 });
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile('  \n'));
		await expect(new RunnerClient().call('GET', '/mac')).rejects.toThrow('has not run yet');
	});

	it('finds the key file the helper writes beside the console when none is named', async () => {
		const root = mkdtempSync(join(tmpdir(), 'runner-root-'));
		mkdirSync(join(root, 'docker/release-console/env'), { recursive: true });
		writeFileSync(join(root, 'docker/release-console/env/runner-token'), 'from-the-helper');
		mkdirSync(join(root, 'apps/release-console-api'), { recursive: true });
		vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'apps/release-console-api'));
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', undefined);
		const fetch = answer(200, '{"ok":true}');
		vi.stubGlobal('fetch', fetch);
		await expect(new RunnerClient().call('GET', '/mac')).resolves.toEqual({ ok: true });
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.headers).toEqual({ authorization: 'Bearer from-the-helper' });
	});

	it('reads with the key, and sends a body as JSON to the address it was given', async () => {
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile('example-runner-token\n'));
		vi.stubEnv('CONSOLE_RUNNER_URL', 'http://host.docker.internal:4419');
		const fetch = answer(200, '[{"id":"job_1"}]');
		vi.stubGlobal('fetch', fetch);
		const client = new RunnerClient();
		await expect(client.call('GET', '/jobs')).resolves.toEqual([{ id: 'job_1' }]);
		await client.call('POST', '/run', { step: 'build' });
		const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
		expect(url).toBe('http://host.docker.internal:4419/run');
		expect(init).toMatchObject({
			method: 'POST',
			headers: { authorization: 'Bearer example-runner-token', 'content-type': 'application/json' },
			body: '{"step":"build"}',
		});
	});

	it('says the helper is not answering when the call cannot be made', async () => {
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile('example-runner-token'));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			}),
		);
		const refused = new RunnerClient().call('GET', '/mac');
		await expect(refused).rejects.toBeInstanceOf(HelperError);
		await expect(refused).rejects.toMatchObject({ status: 503, message: expect.stringContaining('not answering') });
	});

	it('passes on the helper’s own refusal, or its status when it gave no words', async () => {
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile('example-runner-token'));
		vi.stubGlobal('fetch', answer(409, '{"message":"A job is already running."}'));
		await expect(new RunnerClient().call('POST', '/run', {})).rejects.toMatchObject({
			status: 409,
			message: 'A job is already running.',
		});
		vi.stubGlobal('fetch', answer(500, '{"error":7}'));
		await expect(new RunnerClient().call('GET', '/mac')).rejects.toThrow('The Mac helper answered 500.');
		vi.stubGlobal('fetch', answer(502, 'Bad gateway'));
		await expect(new RunnerClient().call('GET', '/mac')).rejects.toMatchObject({ status: 502 });
	});

	it('answers nothing when an answered call carries no JSON', async () => {
		vi.stubEnv('CONSOLE_RUNNER_TOKEN_FILE', keyFile('example-runner-token'));
		vi.stubGlobal('fetch', answer(200, ''));
		await expect(new RunnerClient().call('GET', '/mac')).resolves.toBeNull();
	});
});
