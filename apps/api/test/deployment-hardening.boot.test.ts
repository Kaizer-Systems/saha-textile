import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * The real entrypoints, as real processes (`deployment-hardening.ts`).
 *
 * The unit tests prove the rules; these prove the PROCESSES obey them — that `main.ts` and
 * `worker.ts` run the check before anything connects, print a plain list instead of a stack
 * trace, never echo a secret, and exit non-zero so an orchestrator marks the deploy failed.
 *
 * Each child gets a CLEAN environment: nothing inherited from the test runner (which sets
 * NODE_ENV=test) and no `apps/api/.env`, which dotenv would otherwise load on top.
 */

const API_ROOT = resolve(__dirname, '..');
const secret = () => randomBytes(48).toString('hex');

interface Run {
	code: number | null;
	stdout: string;
	stderr: string;
}

const running: ChildProcess[] = [];

afterEach(() => {
	for (const child of running.splice(0)) child.kill('SIGKILL');
});

/**
 * Starts an entrypoint and resolves when it exits — or, if `until` is given, as soon as stdout
 * contains it (the process is then killed: past the gate it would go on to dial Mongo).
 */
function start(entry: 'src/main.ts' | 'src/worker.ts', env: Record<string, string>, until?: string): Promise<Run> {
	return new Promise((done, fail) => {
		const child = spawn(process.execPath, ['--import', 'tsx', entry], {
			cwd: API_ROOT,
			env: {
				PATH: process.env.PATH ?? '',
				HOME: process.env.HOME ?? '',
				DOTENV_CONFIG_PATH: resolve(API_ROOT, 'test/.no-such-env-file'),
				...env,
			},
		});
		running.push(child);
		const run: Run = { code: null, stdout: '', stderr: '' };
		child.stdout.on('data', (chunk: Buffer) => {
			run.stdout += chunk.toString();
			if (until && run.stdout.includes(until)) {
				child.kill('SIGKILL');
				done(run);
			}
		});
		child.stderr.on('data', (chunk: Buffer) => (run.stderr += chunk.toString()));
		child.on('error', fail);
		child.on('exit', (code) => {
			run.code = code;
			done(run);
		});
	});
}

const deployment = (overrides: Record<string, string> = {}): Record<string, string> => ({
	NODE_ENV: 'production',
	DEPLOY_ENV: 'production',
	JWT_ACCESS_SECRET: secret(),
	JWT_REFRESH_SECRET: secret(),
	CSRF_SECRET: secret(),
	CORS_ALLOWED_ORIGINS: 'https://sahatextile.com,https://admin.sahatextile.com',
	TRUST_PROXY: 'true',
	CLIENT_IP_HEADER: 'cf-connecting-ip',
	NOTIFICATION_PROVIDER: 'msg91',
	MSG91_AUTH_KEY: 'msg91-auth-key-for-tests',
	MONGODB_USERNAME: 'saha_textile_api',
	MONGODB_PASSWORD: 'mongo-password-for-tests',
	// A port nothing listens on: a process that got past the gate must not reach a real store.
	MONGODB_PORT: '1',
	REDIS_PASSWORD: 'redis-password-for-tests',
	SPACES_KEY: 'DO_TEST_KEY',
	SPACES_SECRET: 'spaces-secret-for-tests',
	SPACES_BUCKET: 'saha-textile-media',
	SPACES_CDN_URL: 'https://cdn.sahatextile.com',
	PORT: '45991',
	...overrides,
});

describe('entrypoints refuse an unsafe deployment', { timeout: 60_000 }, () => {
	it('the API exits 1 with the plain list when a production build has no configuration', async () => {
		const run = await start('src/main.ts', { NODE_ENV: 'production' });

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('Refusing to start');
		for (const variable of ['JWT_ACCESS_SECRET', 'CSRF_SECRET', 'CORS_ALLOWED_ORIGINS', 'REDIS_PASSWORD']) {
			expect(run.stderr).toContain(variable);
		}
		// A list to act on, not a crash to debug.
		expect(run.stderr).not.toMatch(/^\s+at /m);
		expect(run.stdout).not.toContain('API listening');
	});

	it('the API never prints a secret it refused', async () => {
		const run = await start(
			'src/main.ts',
			deployment({ JWT_ACCESS_SECRET: 'replace_me_canary_access', MSG91_AUTH_KEY: '', REDIS_PASSWORD: '' }),
		);

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('JWT_ACCESS_SECRET looks like a placeholder');
		expect(run.stderr).not.toContain('canary_access');
	});

	it('the worker refuses the same way', async () => {
		const run = await start('src/worker.ts', { NODE_ENV: 'production' });

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('Refusing to start');
		expect(run.stderr).not.toMatch(/^\s+at /m);
	});

	it('the API refuses a staging label on a development build', async () => {
		const run = await start('src/main.ts', deployment({ NODE_ENV: 'development', DEPLOY_ENV: 'staging' }));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('DEPLOY_ENV=staging requires NODE_ENV=production.');
	});
});

describe('entrypoints accept a safe or local configuration', { timeout: 60_000 }, () => {
	it('the API passes the gate with a complete deployment config', async () => {
		const run = await start('src/main.ts', deployment(), 'hardening checks passed');

		expect(run.stdout).toContain('Strict deployment (production): hardening checks passed.');
		expect(run.stderr).not.toContain('Refusing to start');
	});

	it('the API passes the gate as the mode-3 stack: production build, DEPLOY_ENV=local, dev secrets', async () => {
		const run = await start(
			'src/main.ts',
			{
				NODE_ENV: 'production',
				DEPLOY_ENV: 'local',
				JWT_ACCESS_SECRET: 'replace_me_access_secret',
				JWT_REFRESH_SECRET: 'replace_me_refresh_secret',
				MONGODB_PORT: '1',
				PORT: '45991',
			},
			'Non-strict environment',
		);

		expect(run.stdout).toContain('Non-strict environment (NODE_ENV=production, DEPLOY_ENV=local).');
	});
});
