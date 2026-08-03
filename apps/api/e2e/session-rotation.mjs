#!/usr/bin/env node
/**
 * Session rotation against the REAL application and a REAL replica set.
 *
 * Auth pass 3c wired 401 recovery into both Angular apps and proved it at the interceptor
 * boundary with mocked handlers. That left the half carrying the actual risk unproven:
 * whether a genuinely expired access cookie rotates against this API, whether the replay
 * then succeeds, and — the part that would be a security incident rather than a bug —
 * whether ordinary rotation trips the reuse detection that revokes an entire refresh family.
 *
 * It drives the SAME application `main.ts` runs (composition lives in `src/bootstrap.ts` for
 * exactly this reason) through Fastify's `inject()`, with a real cookie jar. No browser and
 * no socket, so it is deterministic and repeatable — which the Browser pane, per the auth
 * continuation brief's gotcha 13, is not.
 *
 *   pnpm --filter @saha-textile/api build
 *   MONGODB_PORT=27018 node apps/api/e2e/session-rotation.mjs
 *
 * ## Why a script rather than a Vitest suite
 *
 * Nest resolves constructor dependencies from `emitDecoratorMetadata`, which esbuild — and
 * therefore Vitest — cannot produce. Booting the real `AppModule` under Vitest fails with
 * "Nest can't resolve dependencies of the SessionGuard (?, …)". The alternatives were to add
 * `unplugin-swc` plus `@swc/core` (two dependencies, one with a native binary, purely for
 * test tooling) or to run the compiled output, which `nest build` produces through tsc with
 * full metadata. The compiled output is also the artifact production actually runs, so this
 * is the higher-fidelity option as well as the cheaper one. It is deliberately NOT wired into
 * `pnpm test`: it needs a live replica set, exactly like the adapter integration suite.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Short enough to expire inside a run, long enough for the requests before it. */
const ACCESS_TTL = '1s';
const ACCESS_EXPIRY_WAIT_MS = 1_400;

/**
 * A dedicated database. Probe rows are deleted explicitly afterwards regardless, but keeping
 * this out of `saha_textile_local` means a failed run cannot leave debris in the working
 * database.
 */
const E2E_DB_NAME = 'saha_textile_e2e';

/** Minimal browser cookie jar: absorbs `set-cookie`, replays as a `cookie` header. */
class CookieJar {
	#jar = new Map();

	absorb(response) {
		for (const cookie of response.cookies) {
			// The API clears a cookie by setting it empty with maxAge 0; a browser drops it.
			if (cookie.value === '') this.#jar.delete(cookie.name);
			else this.#jar.set(cookie.name, cookie.value);
		}
	}

	header() {
		return [...this.#jar].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	get(name) {
		return this.#jar.get(name) ?? null;
	}

	set(name, value) {
		this.#jar.set(name, value);
	}

	drop(name) {
		this.#jar.delete(name);
	}

	names() {
		return [...this.#jar.keys()];
	}
}

const results = [];

async function check(name, run) {
	try {
		await run();
		results.push({ name, ok: true });
		console.log(`  PASS  ${name}`);
	} catch (error) {
		results.push({ name, ok: false, error });
		console.error(`  FAIL  ${name}`);
		console.error(`        ${error instanceof Error ? error.message : String(error)}`);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
	// Everything goes on `process.env`, not into a config object handed to `createApp`.
	// `ConfigModule` provides `APP_CONFIG` through its own `loadConfig()` call, so the services
	// — including the one that signs the access token with `JWT_ACCESS_TTL` — read the ambient
	// environment. The first version of this harness passed the TTL to `createApp` and watched
	// the access cookie stubbornly refuse to expire.
	process.env.NODE_ENV = 'test';
	process.env.MONGODB_DB_NAME = E2E_DB_NAME;
	process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-not-a-real-key';
	process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-not-a-real-key';
	process.env.JWT_ACCESS_TTL = ACCESS_TTL;
	// The limiter keys on client IP and every injected request shares one, so the default
	// would throttle the run rather than the behaviour under test.
	process.env.RATE_LIMIT_MAX = '10000';

	const { createApp } = await import('../dist/bootstrap.js');
	const { loadConfig } = await import('../dist/config/app-config.js');
	const models = await import('@saha-textile/adapters-db-mongo');

	const config = loadConfig();

	const app = await createApp(config);
	await app.init();

	// Registration is rate-limited by client IP under the `login` action, and exceeding it
	// throws a deliberate 401 ("Too many attempts") rather than a 429 so the response confirms
	// nothing. Every injected request shares one synthetic address, and the counters persist,
	// so without this a third consecutive run fails every case with a misleading
	// "registration failed: 401". Clearing them makes runs independent — it is harness
	// hygiene, not a weakened control: the limiter is exercised by its own tests.
	await models.AuthRateLimitModel.deleteMany({});

	const emails = [];

	/** Sends a request carrying the jar, echoing the CSRF value on unsafe methods. */
	async function request(jar, method, url, options = {}) {
		const headers = {};
		const cookie = jar.header();
		if (cookie) headers.cookie = cookie;

		const csrf = jar.get('st_csrf');
		// Mirrors the browser client: the header goes on unsafe methods only, and only when
		// there is a readable value to echo.
		if (csrf && options.csrf !== false && method !== 'GET') headers['x-csrf-token'] = csrf;

		const response = await app.inject({ method, url, headers, payload: options.payload });
		jar.absorb(response);
		return response;
	}

	async function registerCustomer() {
		const email = `rotation-probe-${randomUUID()}@example.test`;
		emails.push(email);
		const jar = new CookieJar();
		const response = await request(jar, 'POST', '/auth/storefront/register', {
			payload: { email, password: 'a-very-long-probe-password' },
		});
		assert.equal(response.statusCode, 201, `registration failed: ${response.statusCode} ${response.body}`);
		return jar;
	}

	console.log(`\nsession rotation e2e — database ${E2E_DB_NAME}, access TTL ${ACCESS_TTL}\n`);

	await check('issues httpOnly session cookies and no token material in the body', async () => {
		const jar = await registerCustomer();
		for (const name of ['st_access', 'st_refresh', 'st_csrf']) {
			assert.ok(jar.names().includes(name), `missing cookie ${name}`);
		}

		const me = await request(jar, 'GET', '/auth/storefront/me');
		assert.equal(me.statusCode, 200);
		assert.ok(!me.body.includes(jar.get('st_refresh')), 'refresh token appeared in a response body');
	});

	await check('recovers an expired access cookie by rotating, and the replay succeeds', async () => {
		const jar = await registerCustomer();
		assert.equal((await request(jar, 'GET', '/auth/storefront/me')).statusCode, 200);

		await sleep(ACCESS_EXPIRY_WAIT_MS);

		// The exact state the client's 401 recovery exists for: the access JWT has expired
		// while the refresh cookie remains valid for its full idle window.
		assert.equal(
			(await request(jar, 'GET', '/auth/storefront/me')).statusCode,
			401,
			'access cookie did not expire',
		);

		const before = jar.get('st_refresh');
		const rotated = await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} });
		assert.equal(rotated.statusCode, 200, `rotation failed: ${rotated.statusCode} ${rotated.body}`);
		assert.notEqual(jar.get('st_refresh'), before, 'refresh token was not rotated');
		// Rotation replaces the CSRF secret too, which is why the client must re-read the
		// cookie before replaying rather than reusing the header it already built.
		assert.ok(jar.get('st_csrf'), 'no CSRF cookie after rotation');

		assert.equal(
			(await request(jar, 'GET', '/auth/storefront/me')).statusCode,
			200,
			'replay after rotation failed',
		);
	});

	await check('does not revoke the refresh family during ordinary rotation', async () => {
		const jar = await registerCustomer();
		await sleep(ACCESS_EXPIRY_WAIT_MS);

		// Three sequential rotations, as a long-lived tab would perform over time.
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const rotated = await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} });
			assert.equal(rotated.statusCode, 200, `rotation ${attempt} failed: ${rotated.statusCode}`);
		}

		// Still signed in: the family survived, which is the whole point. A false reuse
		// detection would have revoked it and this would answer 401.
		assert.equal((await request(jar, 'GET', '/auth/storefront/me')).statusCode, 200, 'family was revoked');
	});

	await check('still revokes the family when a rotated-away token is replayed', async () => {
		const jar = await registerCustomer();
		const stolen = jar.get('st_refresh');
		assert.ok(stolen);

		assert.equal((await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} })).statusCode, 200);

		// Present the token the rotation replaced, with everything else current and valid.
		// The access cookie matters: without it the guard falls back to resolving the session
		// from the refresh token, which no longer exists, and the request fails CSRF-closed
		// with a 403 before reuse detection can run. Isolating the rotated-away token as the
		// ONLY stale value is what makes this a test of reuse detection rather than of CSRF.
		const replayJar = new CookieJar();
		replayJar.set('st_access', jar.get('st_access'));
		replayJar.set('st_csrf', jar.get('st_csrf'));
		replayJar.set('st_refresh', stolen);
		const replayed = await request(replayJar, 'POST', '/auth/storefront/refresh', { payload: {} });
		assert.equal(replayed.statusCode, 401, 'a rotated-away token was accepted');

		// The CURRENT token is now dead too: the whole family was revoked. This is precisely
		// the behaviour the client's single-flight and cross-tab lock exist to avoid tripping.
		//
		// Asserted against the DATABASE rather than the status code on purpose. The refused
		// request answers 403, not 401, because the session is gone and `CsrfGuard` — which
		// binds the token to a live session — fails closed before the refresh handler runs.
		// That is correct, but it means the status code alone cannot distinguish "family
		// revoked" from "CSRF rejected", and an earlier version of this check read the 403 as
		// a failure to revoke.
		const afterRevocation = await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} });
		assert.ok(
			afterRevocation.statusCode === 401 || afterRevocation.statusCode === 403,
			`a revoked session was still accepted: ${afterRevocation.statusCode}`,
		);

		const user = await models.UserModel.findOne({ email: emails[emails.length - 1] }).lean();
		const sessions = await models.AuthSessionModel.find({ userId: String(user._id) }).lean();
		assert.ok(sessions.length > 0, 'no session rows found for the probe account');
		for (const session of sessions) {
			assert.ok(session.revokedAt, 'a session in the family survived reuse detection');
			assert.equal(session.revokeReason, 'reuse_detected');
		}
	});

	// Evidence for the pending 3c.3 decision: whether the client can rotate FIRST and only
	// acquire a CSRF token when the API says the token is what was missing. Today it acquires
	// unconditionally when no CSRF cookie is readable, which costs an anonymous visitor two
	// requests on first load. Reordering is only safe if these two states are distinguishable.
	const refusalCodes = {};

	await check('answers 403 when session cookies are present but the CSRF half is missing', async () => {
		const jar = await registerCustomer();
		// Exactly the returning-visitor state: `st_csrf` has no maxAge, so closing the browser
		// drops it while the persistent access/refresh cookies survive.
		jar.drop('st_csrf');

		const response = await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} });
		refusalCodes.sessionWithoutCsrf = response.statusCode;
		assert.equal(response.statusCode, 403);
	});

	await check('answers 401 when there are no cookies at all', async () => {
		const response = await request(new CookieJar(), 'POST', '/auth/storefront/refresh', { payload: {} });
		refusalCodes.noCookies = response.statusCode;
		assert.equal(response.statusCode, 401);
	});

	await check('recovers the missing CSRF half through the shared bootstrap endpoint', async () => {
		const jar = await registerCustomer();
		jar.drop('st_csrf');

		const issued = await request(jar, 'GET', '/auth/csrf');
		assert.equal(issued.statusCode, 200);
		assert.ok(jar.get('st_csrf'), 'no CSRF cookie issued');

		// The acquired token is bound to THIS session, so the rotation now succeeds — which is
		// what makes the client's acquire-then-rotate path a real recovery rather than a retry.
		const rotated = await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} });
		assert.equal(rotated.statusCode, 200, `rotation after CSRF recovery failed: ${rotated.statusCode}`);
	});

	// Probe rows are removed explicitly, not merely isolated in their own database.
	await models.AuthRateLimitModel.deleteMany({});
	let remaining = 0;
	for (const email of emails) {
		const user = await models.UserModel.findOne({ email }).lean();
		if (user) {
			await models.AuthSessionModel.deleteMany({ userId: String(user._id) });
			await models.UserModel.deleteOne({ _id: user._id });
		}
		remaining += await models.UserModel.countDocuments({ email });
	}

	await app.close();

	console.log(
		`\nrefusal codes: session-without-csrf=${refusalCodes.sessionWithoutCsrf} no-cookies=${refusalCodes.noCookies}`,
	);
	console.log(`probe accounts created ${emails.length}, remaining after cleanup ${remaining}`);

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
	if (remaining !== 0) {
		console.error('cleanup incomplete — probe rows remain');
		process.exitCode = 1;
	}
	if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
