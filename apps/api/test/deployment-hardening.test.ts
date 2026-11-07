import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/app-config';
import { exitOnDeploymentConfigError } from '../src/config/boot-failure';
import {
	DeploymentConfigError,
	deploymentHardeningProblems,
	isStrictDeployment,
} from '../src/config/deployment-hardening';

/**
 * Production configuration fails closed (`deployment-hardening.ts`, owner choice 2026-11-03).
 *
 * Every rule is tested by breaking exactly one variable of an otherwise complete deployment
 * env and asserting that this — and only this — is what the boot refuses. A rule that never
 * fires, or fires for the wrong variable, is the defect these exist to catch.
 */

const secret = () => randomBytes(48).toString('hex');

/** A complete, valid production env. Fresh secrets per call so no test leans on a fixed value. */
const deployment = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
	const env: Record<string, string | undefined> = {
		NODE_ENV: 'production',
		DEPLOY_ENV: 'production',
		JWT_ACCESS_SECRET: secret(),
		JWT_REFRESH_SECRET: secret(),
		CSRF_SECRET: secret(),
		COOKIE_SECURE: 'true',
		CORS_ALLOWED_ORIGINS: 'https://sahatextile.com,https://admin.sahatextile.com',
		TRUST_PROXY: 'true',
		CLIENT_IP_HEADER: 'cf-connecting-ip',
		NOTIFICATION_PROVIDER: 'msg91',
		MSG91_AUTH_KEY: 'msg91-auth-key-for-tests',
		MONGODB_USERNAME: 'saha_textile_api',
		MONGODB_PASSWORD: 'mongo-password-for-tests',
		REDIS_PASSWORD: 'redis-password-for-tests',
		SPACES_KEY: 'DO_TEST_KEY',
		SPACES_SECRET: 'spaces-secret-for-tests',
		SPACES_BUCKET: 'saha-textile-media',
		SPACES_CDN_URL: 'https://cdn.sahatextile.com',
		...overrides,
	};
	for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
	return env as NodeJS.ProcessEnv;
};

/** The problems a given env produces, without throwing. */
const problemsFor = (env: NodeJS.ProcessEnv): string[] => {
	try {
		loadConfig(env);
		return [];
	} catch (error) {
		if (error instanceof DeploymentConfigError) return error.problems;
		throw error;
	}
};

describe('deployment hardening', () => {
	describe('when the rules apply', () => {
		it.each([
			// [NODE_ENV, DEPLOY_ENV, strict?]
			['production', undefined, true], // forgotten DEPLOY_ENV fails closed
			['production', 'production', true],
			['production', 'staging', true],
			['production', 'local', false], // the mode-3 Docker stack
			['development', undefined, false],
			['test', undefined, false],
			['development', 'local', false],
		] as const)('NODE_ENV=%s DEPLOY_ENV=%s → strict %s', (nodeEnv, deployEnv, strict) => {
			expect(isStrictDeployment({ nodeEnv, deployEnv })).toBe(strict);
		});

		it('treats a production build without DEPLOY_ENV as a deployment', () => {
			expect(problemsFor({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).length).toBeGreaterThan(5);
		});

		it.each(['staging', 'production'])('refuses DEPLOY_ENV=%s on a development build', (deployEnv) => {
			expect(problemsFor(deployment({ NODE_ENV: 'development', DEPLOY_ENV: deployEnv }))).toEqual([
				`DEPLOY_ENV=${deployEnv} requires NODE_ENV=production.`,
			]);
		});

		it('rejects an unknown DEPLOY_ENV rather than guessing', () => {
			expect(() => loadConfig(deployment({ DEPLOY_ENV: 'prod' }))).toThrow();
		});
	});

	describe('a complete deployment', () => {
		it.each(['production', 'staging'])('boots as %s with no problems', (deployEnv) => {
			expect(problemsFor(deployment({ DEPLOY_ENV: deployEnv }))).toEqual([]);
		});

		it('boots with an SRV URI carrying credentials', () => {
			const env = deployment({
				MONGODB_USERNAME: undefined,
				MONGODB_PASSWORD: undefined,
				MONGODB_URI: 'mongodb+srv://saha_textile_api:pw@cluster.example.net/saha_textile',
			});
			expect(problemsFor(env)).toEqual([]);
		});

		it('boots with credentials carried in a multi-host MONGODB_URI instead', () => {
			const env = deployment({
				MONGODB_USERNAME: undefined,
				MONGODB_PASSWORD: undefined,
				MONGODB_URI: 'mongodb://saha_textile_api:pw@mongo-1:27017,mongo-2:27017/saha_textile?replicaSet=rs0',
			});
			expect(problemsFor(env)).toEqual([]);
		});
	});

	describe('non-strict environments are unchanged', () => {
		it('boots a bare development env on its built-in fallbacks', () => {
			const config = loadConfig({} as NodeJS.ProcessEnv);
			expect(config.jwt.accessSecret).toBe('dev-access-secret-change-me');
			expect(config.notifications.provider).toBe('console');
		});

		it('boots the mode-3 stack shape: production build, DEPLOY_ENV=local, dev secrets, console', () => {
			const env = {
				NODE_ENV: 'production',
				DEPLOY_ENV: 'local',
				JWT_ACCESS_SECRET: 'replace_me_access_secret',
				JWT_REFRESH_SECRET: 'replace_me_refresh_secret',
				NOTIFICATION_PROVIDER: 'console',
				CORS_ALLOWED_ORIGINS: 'https://local.saha-textile.localhost:8443',
			} as NodeJS.ProcessEnv;
			expect(() => loadConfig(env)).not.toThrow();
		});

		it('still refuses a fixed OTP on any production build, local or not', () => {
			expect(() =>
				loadConfig({
					NODE_ENV: 'production',
					DEPLOY_ENV: 'local',
					OTP_LOCAL_FIXED_CODE: '123456',
				} as NodeJS.ProcessEnv),
			).toThrow(/OTP_LOCAL_FIXED_CODE/);
		});
	});

	describe('secrets', () => {
		it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CSRF_SECRET'])('requires %s to be set', (name) => {
			expect(problemsFor(deployment({ [name]: undefined }))).toEqual([
				`${name} must be set; a deployment never falls back to a built-in development value.`,
			]);
		});

		it('treats an empty secret as unset rather than failing on shape', () => {
			expect(problemsFor(deployment({ JWT_ACCESS_SECRET: '' }))).toEqual([
				'JWT_ACCESS_SECRET must be set; a deployment never falls back to a built-in development value.',
			]);
		});

		it.each([
			['the built-in development value', 'dev-access-secret-change-me'],
			['the .env.example value', 'replace_me_access_secret'],
			['a long placeholder', `${'0123456789abcdef'.repeat(4)}CHANGEME`],
			['an "example" value', `example-${secret()}`],
		])('refuses %s as a placeholder', (_label, value) => {
			expect(problemsFor(deployment({ JWT_ACCESS_SECRET: value }))).toEqual([
				'JWT_ACCESS_SECRET looks like a placeholder; generate one with `openssl rand -hex 48`.',
			]);
		});

		it('refuses a secret shorter than 64 characters', () => {
			expect(problemsFor(deployment({ CSRF_SECRET: secret().slice(0, 63) }))).toEqual([
				'CSRF_SECRET must be at least 64 characters; generate one with `openssl rand -hex 48`.',
			]);
		});

		it('accepts a secret of exactly 64 characters', () => {
			expect(problemsFor(deployment({ CSRF_SECRET: secret().slice(0, 64) }))).toEqual([]);
		});

		it.each([
			['one repeated character', 'a'.repeat(96)],
			['a short repeated pattern', 'ab'.repeat(48)],
		])('refuses %s as too repetitive', (_label, value) => {
			expect(problemsFor(deployment({ JWT_REFRESH_SECRET: value }))).toEqual([
				'JWT_REFRESH_SECRET is too repetitive to be random; generate one with `openssl rand -hex 48`.',
			]);
		});

		it.each([
			['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
			['JWT_ACCESS_SECRET', 'CSRF_SECRET'],
			['JWT_REFRESH_SECRET', 'CSRF_SECRET'],
		])('refuses %s reused as %s', (a, b) => {
			const shared = secret();
			expect(problemsFor(deployment({ [a]: shared, [b]: shared }))).toEqual([
				`${a} and ${b} must be different secrets.`,
			]);
		});
	});

	describe('browser boundary', () => {
		it('requires secure cookies', () => {
			expect(problemsFor(deployment({ COOKIE_SECURE: 'false' }))).toEqual([
				'COOKIE_SECURE must be true: deployed session cookies need Secure and the __Host- prefix.',
			]);
		});

		it('refuses the built-in localhost CORS default', () => {
			expect(problemsFor(deployment({ CORS_ALLOWED_ORIGINS: undefined }))).toEqual([
				'CORS_ALLOWED_ORIGINS must be set: the built-in default only lists localhost origins.',
			]);
		});

		it.each([
			['https://localhost:4200', 'must not include a local origin'],
			['https://127.0.0.1', 'must not include a local origin'],
			['https://[::1]:4300', 'must not include a local origin'],
			['https://0.0.0.0', 'must not include a local origin'],
			['https://admin-local.saha-textile.localhost:8443', 'must not include a local origin'],
			['http://sahatextile.com', 'must use https'],
			['*', 'not a wildcard'],
			['https://*.sahatextile.com', 'not a wildcard'],
			['sahatextile.com', 'not a URL'],
		])('refuses the origin %s', (origin, reason) => {
			const problems = problemsFor(deployment({ CORS_ALLOWED_ORIGINS: `https://sahatextile.com,${origin}` }));
			expect(problems).toHaveLength(1);
			expect(problems[0]).toContain(reason);
			expect(problems[0]).toContain(origin);
		});
	});

	describe('client identity behind the proxy', () => {
		it('requires TRUST_PROXY', () => {
			expect(problemsFor(deployment({ TRUST_PROXY: undefined }))).toEqual([
				'TRUST_PROXY must be true behind Cloudflare and Nginx, or every visitor shares one rate-limit bucket.',
			]);
		});

		it('requires CLIENT_IP_HEADER', () => {
			expect(problemsFor(deployment({ CLIENT_IP_HEADER: undefined }))).toEqual([
				'CLIENT_IP_HEADER must be set (cf-connecting-ip), or audit rows record the proxy address.',
			]);
		});
	});

	describe('delivery and one-time codes', () => {
		it('refuses the console provider', () => {
			expect(problemsFor(deployment({ NOTIFICATION_PROVIDER: 'console' }))).toEqual([
				'NOTIFICATION_PROVIDER must be msg91: the console provider only logs codes and links.',
			]);
		});

		it('refuses an unset provider, which defaults to console', () => {
			expect(problemsFor(deployment({ NOTIFICATION_PROVIDER: undefined }))).toEqual([
				'NOTIFICATION_PROVIDER must be msg91: the console provider only logs codes and links.',
			]);
		});

		it('refuses msg91 without an auth key, which would silently fall back to console', () => {
			expect(problemsFor(deployment({ MSG91_AUTH_KEY: undefined }))).toEqual([
				'MSG91_AUTH_KEY must be set when NOTIFICATION_PROVIDER=msg91.',
			]);
		});
	});

	describe('social sign-in', () => {
		it.each([
			[{ FACEBOOK_OAUTH_APP_ID: '123456789' }],
			[{ FACEBOOK_OAUTH_APP_SECRET: 'facebook-secret-for-tests' }],
		])('refuses a half-set Facebook pair %o', (half) => {
			expect(problemsFor(deployment(half))).toEqual([
				'Set both FACEBOOK_OAUTH_APP_ID and FACEBOOK_OAUTH_APP_SECRET, or neither.',
			]);
		});

		it('accepts Facebook fully set or fully unset', () => {
			expect(
				problemsFor(
					deployment({
						FACEBOOK_OAUTH_APP_ID: '123456789',
						FACEBOOK_OAUTH_APP_SECRET: 'facebook-secret-for-tests',
					}),
				),
			).toEqual([]);
		});
	});

	describe('data stores', () => {
		const mongoProblem =
			'MongoDB must authenticate: set MONGODB_USERNAME and MONGODB_PASSWORD, or a MONGODB_URI with credentials.';

		it.each([
			['no credentials at all', { MONGODB_USERNAME: undefined, MONGODB_PASSWORD: undefined }],
			['a username without a password', { MONGODB_PASSWORD: undefined }],
			[
				'a URI without credentials',
				{ MONGODB_USERNAME: undefined, MONGODB_PASSWORD: undefined, MONGODB_URI: 'mongodb://mongo:27017/db' },
			],
			[
				'a URI with a user but no password',
				{
					MONGODB_USERNAME: undefined,
					MONGODB_PASSWORD: undefined,
					MONGODB_URI: 'mongodb://user@mongo:27017/db',
				},
			],
			[
				'a URI with an empty password',
				{
					MONGODB_USERNAME: undefined,
					MONGODB_PASSWORD: undefined,
					MONGODB_URI: 'mongodb://user:@mongo:27017/db',
				},
			],
			[
				'a URI that does not parse',
				{ MONGODB_USERNAME: undefined, MONGODB_PASSWORD: undefined, MONGODB_URI: 'not a uri' },
			],
		])('refuses %s', (_label, overrides) => {
			expect(problemsFor(deployment(overrides))).toEqual([mongoProblem]);
		});

		it('refuses an open Redis', () => {
			expect(problemsFor(deployment({ REDIS_PASSWORD: undefined }))).toEqual([
				'REDIS_PASSWORD must be set: the media job queue must not run open.',
			]);
		});

		it('refuses unconfigured media storage', () => {
			expect(
				problemsFor(deployment({ SPACES_KEY: undefined, SPACES_SECRET: undefined, SPACES_BUCKET: undefined })),
			).toEqual(['Media storage must be configured: set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET.']);
		});

		it('requires the CDN URL, and over https', () => {
			expect(problemsFor(deployment({ SPACES_CDN_URL: undefined }))).toEqual([
				'SPACES_CDN_URL must be set to the https CDN host that serves media.',
			]);
			expect(problemsFor(deployment({ SPACES_CDN_URL: 'http://cdn.sahatextile.com' }))).toEqual([
				'SPACES_CDN_URL must be an https URL.',
			]);
		});
	});

	describe('the refusal itself', () => {
		it('lists every problem at once, so the env is fixed in one pass', () => {
			const problems = problemsFor({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
			const variables = [
				'JWT_ACCESS_SECRET',
				'JWT_REFRESH_SECRET',
				'CSRF_SECRET',
				'CORS_ALLOWED_ORIGINS',
				'TRUST_PROXY',
				'CLIENT_IP_HEADER',
				'NOTIFICATION_PROVIDER',
				'MongoDB',
				'REDIS_PASSWORD',
				'Media storage',
				'SPACES_CDN_URL',
			];
			for (const variable of variables) {
				expect(problems.some((problem) => problem.includes(variable))).toBe(true);
			}
		});

		it('never prints a secret value', () => {
			const leaky = {
				JWT_ACCESS_SECRET: 'replace_me_ACCESS_canary_1',
				JWT_REFRESH_SECRET: 'REFRESH_canary_2',
				CSRF_SECRET: 'a'.repeat(70),
				MSG91_AUTH_KEY: 'MSG91_canary_3',
				MONGODB_URI: 'mongodb://user_canary_4@mongo:27017/db',
				REDIS_PASSWORD: undefined,
			};
			let message = '';
			try {
				loadConfig(deployment({ ...leaky, NOTIFICATION_PROVIDER: 'console', MONGODB_USERNAME: undefined }));
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message).toContain('Refusing to start');
			for (const canary of ['canary_1', 'canary_2', 'aaaaaaaaaa', 'canary_3', 'canary_4']) {
				expect(message).not.toContain(canary);
			}
		});

		it('is reported through deploymentHardeningProblems without throwing', () => {
			const config = loadConfig({} as NodeJS.ProcessEnv);
			expect(deploymentHardeningProblems({ ...config, nodeEnv: 'production' }, {})).not.toEqual([]);
		});
	});

	describe('boot failure handling', () => {
		afterEach(() => vi.restoreAllMocks());

		it('prints the list and exits 1 for a hardening refusal', () => {
			const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
			const printed = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			exitOnDeploymentConfigError(new DeploymentConfigError(['REDIS_PASSWORD must be set.']));

			expect(exit).toHaveBeenCalledWith(1);
			expect(printed.mock.calls[0]?.[0]).toContain('REDIS_PASSWORD must be set.');
		});

		it('rethrows anything else untouched', () => {
			const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
			const crash = new Error('database unreachable');

			expect(() => exitOnDeploymentConfigError(crash)).toThrow(crash);
			expect(exit).not.toHaveBeenCalled();
		});
	});
});
