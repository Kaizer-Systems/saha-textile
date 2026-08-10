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
	// The Mongo adapter reads its connection settings from `process.env` at connect time, so
	// the database name is the one value that still has to go through the environment.
	process.env.MONGODB_DB_NAME = E2E_DB_NAME;

	const { createApp } = await import('../dist/bootstrap.js');
	const { loadConfig } = await import('../dist/config/app-config.js');
	const models = await import('@saha-textile/adapters-db-mongo');

	// Everything else is passed as configuration, which is also the proof that
	// `AppModule.forRoot` genuinely reaches the services: if `APP_CONFIG` still came from
	// `loadConfig()` internally, `JWT_ACCESS_TTL` would fall back to fifteen minutes and the
	// expiry case below would fail. It did exactly that before the config module took an
	// explicit config.
	const config = loadConfig({
		NODE_ENV: 'test',
		JWT_ACCESS_SECRET: 'e2e-access-secret-not-a-real-key',
		JWT_REFRESH_SECRET: 'e2e-refresh-secret-not-a-real-key',
		JWT_ACCESS_TTL: ACCESS_TTL,
		// The limiter keys on client IP and every injected request shares one, so the default
		// would throttle the run rather than the behaviour under test.
		RATE_LIMIT_MAX: '10000',
	});

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
	/** Users created directly rather than through registration, cleaned up by id. */
	const probeUserIds = [];

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

	/**
	 * An admin request that survives the deliberately tiny access TTL.
	 *
	 * `JWT_ACCESS_TTL` is one second so the expiry case above is real, which means any check
	 * doing more than a couple of admin calls will cross the boundary mid-way. Rotating once
	 * on `session_expired` and replaying is exactly what both Angular interceptors do in
	 * production (auth pass 4c), so this mirrors the client rather than weakening anything:
	 * a 401 for any OTHER reason, and every 403, still surfaces untouched.
	 */
	async function adminRequest(jar, method, url, options = {}) {
		const first = await request(jar, method, url, options);
		if (first.statusCode !== 401) return first;

		let reason;
		try {
			reason = JSON.parse(first.body).error?.reason;
		} catch {
			return first;
		}
		if (reason !== 'session_expired') return first;

		const rotated = await request(jar, 'POST', '/auth/admin/refresh', { payload: {} });
		if (rotated.statusCode !== 200) return first;
		return request(jar, method, url, options);
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

	/**
	 * Seeds an administrator directly and signs them in.
	 *
	 * Direct creation because no first-administrator bootstrap exists yet (pass 6a). The
	 * `permissions` argument is the EMBEDDED grant list, which is what lets a probe hold
	 * exactly the authority a case needs and nothing else.
	 */
	async function seedAdmin(permissions = []) {
		const { AUTH_PORT } = await import('../dist/infra/tokens.js');
		const auth = app.get(AUTH_PORT);
		const email = `negative-probe-${randomUUID()}@example.test`;
		emails.push(email);
		const password = 'a-very-long-probe-password';
		const userId = `user_${randomUUID()}`;

		await models.UserModel.create([
			{
				_id: userId,
				email,
				emailNormalized: email,
				passwordHash: await auth.hashPassword(password),
				role: 'admin',
				status: 'active',
				permissions,
				tokenVersion: 0,
				permissionsVersion: 0,
				emailVerifiedAt: new Date(),
			},
		]);
		probeUserIds.push(userId);

		const jar = new CookieJar();
		const login = await request(jar, 'POST', '/auth/admin/login', { payload: { identifier: email, password } });
		assert.equal(login.statusCode, 200, `probe admin login failed: ${login.statusCode} ${login.body}`);
		return { userId, jar, email, password };
	}

	console.log(`\nsession rotation e2e — database ${E2E_DB_NAME}, access TTL ${ACCESS_TTL}\n`);

	/**
	 * Runs FIRST, and the ordering is part of the test.
	 *
	 * A bootstrap is what happens to a system that has no administrator, and every later check
	 * seeds one directly — which is exactly the state this must refuse. Placed at the end, it
	 * failed on its own success criterion, correctly.
	 */
	await check('first-administrator bootstrap: creates one, then refuses forever (pass 6a)', async () => {
		const { bootstrapFirstAdmin, FirstAdminAlreadyExistsError } = await import('../dist/first-admin.js');
		const { ADMINISTRATOR_ROLE_KEY, UserModel, ensureSystemRoles, AuditLogModel } = models;
		const deps = { models: { UserModel }, ensureSystemRoles, administratorRoleKey: ADMINISTRATOR_ROLE_KEY };

		const email = `first-admin-${randomUUID()}@example.test`;
		emails.push(email);

		const created = await bootstrapFirstAdmin(app, { email }, deps);
		probeUserIds.push(created.userId);
		assert.ok(created.password.length >= 12, 'generated password is below the policy floor');
		assert.equal(created.roleKey, ADMINISTRATOR_ROLE_KEY);

		// The bootstrap must produce a WORKING administrator, not merely rows: sign in with the
		// generated credential and reach a deny-by-default surface.
		const jar = new CookieJar();
		const login = await request(jar, 'POST', '/auth/admin/login', {
			payload: { identifier: created.email, password: created.password },
		});
		assert.equal(login.statusCode, 200, `bootstrapped administrator cannot sign in: ${login.statusCode}`);

		const roles = await adminRequest(jar, 'GET', '/admin/roles');
		assert.equal(roles.statusCode, 200, `bootstrapped administrator was refused: ${roles.statusCode}`);

		// It is audited, at the highest severity, with no credential material anywhere in it.
		const entry = await AuditLogModel.findOne({ action: 'admin.bootstrap.first_administrator' }).lean().exec();
		assert.ok(entry, 'the bootstrap was not audited');
		assert.equal(entry.severity, 'critical');
		assert.equal(entry.actorUserId, null, 'nobody granted this; the actor must be null');
		assert.ok(!JSON.stringify(entry).includes(created.password), 'the password reached the audit log');

		// THE PROPERTY: refusal, not a silent no-op, and not a second administrator.
		await assert.rejects(
			() => bootstrapFirstAdmin(app, { email: `second-${randomUUID()}@example.test` }, deps),
			(error) => error instanceof FirstAdminAlreadyExistsError,
			'a second bootstrap was permitted',
		);

		/**
		 * The assignment-holder refusal, ISOLATED.
		 *
		 * The two refusal checks overlap in every ordinary state, so removing either one alone
		 * still leaves the bootstrap refusing — defence in depth, and untestable through the
		 * happy path. This constructs the one state where only the holder check applies: an
		 * admin-tier assignment held by an account that is NOT itself `role: 'admin'`.
		 */
		await models.UserModel.deleteMany({ role: 'admin' }).exec();
		const staffId = `user_${randomUUID()}`;
		await models.UserModel.create([
			{
				_id: staffId,
				email: `staff-holder-${randomUUID()}@example.test`,
				role: 'staff',
				status: 'active',
				permissions: [],
				tokenVersion: 0,
				permissionsVersion: 0,
			},
		]);
		await models.UserRoleAssignmentModel.create([
			{
				_id: `ura_${randomUUID()}`,
				userId: staffId,
				roleId: (await models.RoleModel.findOne({ key: ADMINISTRATOR_ROLE_KEY }).lean().exec())._id,
				assignedByUserId: null,
				assignedAt: new Date(),
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			},
		]);
		await assert.rejects(
			() => bootstrapFirstAdmin(app, { email: `holder-${randomUUID()}@example.test` }, deps),
			(error) => error instanceof FirstAdminAlreadyExistsError,
			'bootstrap ran again despite a live administrator assignment',
		);
		await models.UserRoleAssignmentModel.deleteMany({ userId: staffId }).exec();
		await models.UserModel.deleteOne({ _id: staffId }).exec();

		// Refusal also holds for an account carrying the coarse role but no assignment yet,
		// which is the state a partially-completed earlier attempt would leave behind.
		await models.UserModel.create([
			{ _id: created.userId, email: created.email, role: 'admin', status: 'active', permissions: [] },
		]);
		await models.UserRoleAssignmentModel.deleteMany({ userId: created.userId }).exec();
		await assert.rejects(
			() => bootstrapFirstAdmin(app, { email: `third-${randomUUID()}@example.test` }, deps),
			(error) => error instanceof FirstAdminAlreadyExistsError,
			'bootstrap ran again despite an existing admin account',
		);
	});

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

	await check('revokes the family for a stolen refresh cookie with no CSRF token', async () => {
		const jar = await registerCustomer();
		const stolen = jar.get('st_refresh');
		assert.equal((await request(jar, 'POST', '/auth/storefront/refresh', { payload: {} })).statusCode, 200);

		// What an attacker who exfiltrated only the refresh cookie actually holds: no access
		// cookie, no CSRF token. This used to be refused 403 by CsrfGuard BEFORE reuse
		// detection ran — the request was blocked but the family survived, the legitimate
		// session kept working, and nothing was recorded. Detection now runs first.
		const attacker = new CookieJar();
		attacker.set('st_refresh', stolen);
		const attempt = await request(attacker, 'POST', '/auth/storefront/refresh', { payload: {} });
		assert.equal(attempt.statusCode, 401, `expected the stolen token to be detected, got ${attempt.statusCode}`);

		const user = await models.UserModel.findOne({ email: emails[emails.length - 1] }).lean();
		const sessions = await models.AuthSessionModel.find({ userId: String(user._id) }).lean();
		assert.ok(sessions.length > 0, 'no session rows found for the probe account');
		for (const session of sessions) {
			assert.ok(session.revokedAt, 'the family survived a stolen-token replay');
			assert.equal(session.revokeReason, 'reuse_detected');
		}

		// And the victim's own session is genuinely gone, not merely flagged.
		assert.notEqual((await request(jar, 'GET', '/auth/storefront/me')).statusCode, 200);
	});

	// The carrier-grade NAT case, which is the reason the counting model changed. Asserted
	// against the COUNTERS rather than by driving traffic at the ceiling: with the address
	// ceiling at a hundred, a handful of logins would pass under attempt counting too, and a
	// test that cannot fail for the reason it claims is worse than none.
	await check('successful logins consume no rate-limit budget at all', async () => {
		await models.AuthRateLimitModel.deleteMany({ action: 'storefront_login' });
		const jar = await registerCustomer();
		const email = emails[emails.length - 1];
		await request(jar, 'POST', '/auth/storefront/logout', { payload: {} });

		for (let attempt = 1; attempt <= 5; attempt += 1) {
			const response = await request(new CookieJar(), 'POST', '/auth/storefront/login/password', {
				payload: { email, password: 'a-very-long-probe-password' },
			});
			assert.equal(response.statusCode, 200, `login ${attempt} answered ${response.statusCode}`);
		}

		// Under the previous attempt counting each of these spent one slot from a bucket
		// shared with every other subscriber behind the same public address.
		const counters = await models.AuthRateLimitModel.countDocuments({ action: 'storefront_login' });
		assert.equal(counters, 0, `successful logins left ${counters} counter row(s)`);
	});

	await check('a success clears the account budget but never the shared address budget', async () => {
		await models.AuthRateLimitModel.deleteMany({ action: 'storefront_login' });
		const jar = await registerCustomer();
		const email = emails[emails.length - 1];
		await request(jar, 'POST', '/auth/storefront/logout', { payload: {} });

		const attemptLogin = (password) =>
			request(new CookieJar(), 'POST', '/auth/storefront/login/password', { payload: { email, password } });

		for (let attempt = 1; attempt <= 4; attempt += 1) {
			assert.equal((await attemptLogin('wrong-password-entirely')).statusCode, 401);
		}
		const failing = await models.AuthRateLimitModel.find({ action: 'storefront_login' }).lean();
		assert.equal(failing.find((row) => row.scope === 'identifier')?.count, 4);
		assert.equal(failing.find((row) => row.scope === 'ip')?.count, 4);

		assert.equal((await attemptLogin('a-very-long-probe-password')).statusCode, 200);

		const after = await models.AuthRateLimitModel.find({ action: 'storefront_login' }).lean();
		assert.equal(
			after.find((row) => row.scope === 'identifier'),
			undefined,
			'account budget was not cleared',
		);
		// Deliberately still counted. Resetting the shared address on success would let an
		// attacker wipe their failure history by logging into an account they control.
		assert.equal(after.find((row) => row.scope === 'ip')?.count, 4, 'the shared address budget was cleared');
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

	await check('a valid access token presented as a bearer header authenticates nothing', async () => {
		const jar = await registerCustomer();
		const access = jar.get('st_access');
		assert.ok(access, 'no access cookie to replay');

		// It works as a cookie, so the token itself is unquestionably valid and unexpired.
		const viaCookie = await request(jar, 'GET', '/auth/storefront/me');
		assert.equal(viaCookie.statusCode, 200, `cookie session should work: ${viaCookie.statusCode}`);

		// The SAME token, same instant, offered the other way: header only, no cookies. This
		// is what the retired JwtAuthGuard used to accept. Deleting the file removes the code;
		// this check is what keeps the behaviour from coming back, since a guard reinstated by
		// a future template port or a copied snippet would turn this 401 into a 200.
		const viaBearer = await app.inject({
			method: 'GET',
			url: '/auth/storefront/me',
			headers: { authorization: `Bearer ${access}` },
		});
		assert.equal(viaBearer.statusCode, 401, `bearer header was accepted: ${viaBearer.statusCode}`);
	});

	await check('session-bound refusals name a reason on the wire; credential refusals do not', async () => {
		const reasonOf = (response) => {
			const body = JSON.parse(response.body);
			return body.error?.reason;
		};

		// No cookies at all.
		const missing = await app.inject({ method: 'GET', url: '/auth/storefront/me' });
		assert.equal(missing.statusCode, 401);
		assert.equal(reasonOf(missing), 'session_missing');

		// A live session whose access cookie has aged out. ACCESS_TTL is deliberately tiny.
		const jar = await registerCustomer();
		await sleep(ACCESS_EXPIRY_WAIT_MS);
		const expired = await request(jar, 'GET', '/auth/storefront/me');
		assert.equal(expired.statusCode, 401);
		assert.equal(reasonOf(expired), 'session_expired', 'an aged access cookie must be distinguishable');

		// Revoked is NOT reachable through the logging-out tab itself: logout clears the
		// cookies, so that tab presents nothing and correctly reads as session_missing. It
		// takes a second tab still holding a valid access cookie for a session killed
		// server-side — which is the case that matters, because that tab must stop asking
		// rather than try to rotate.
		const live = await registerCustomer();
		const otherTab = new CookieJar();
		otherTab.set('st_access', live.get('st_access'));
		otherTab.set('st_csrf', live.get('st_csrf'));

		await request(live, 'POST', '/auth/storefront/logout', { payload: {} });

		const revoked = await request(otherTab, 'GET', '/auth/storefront/me');
		assert.equal(revoked.statusCode, 401);
		assert.equal(reasonOf(revoked), 'session_revoked', 'a still-held cookie for a dead session must say revoked');

		// The security property: a refused CREDENTIAL says nothing. If this ever carries a
		// reason, "PIN locked" becomes distinguishable from "wrong PIN" to a stranger, which
		// confirms a guessed account exists.
		const wrongPassword = await app.inject({
			method: 'POST',
			url: '/auth/storefront/login/password',
			payload: { email: 'nobody-here@example.test', password: 'not-the-right-password' },
		});
		assert.equal(wrongPassword.statusCode, 401);
		assert.equal(reasonOf(wrongPassword), undefined, 'a credential refusal must not name a reason');

		const wrongPin = await app.inject({
			method: 'POST',
			url: '/auth/admin/login/pin',
			payload: { identifier: 'nobody-here@example.test', pin: '000000' },
		});
		assert.equal(wrongPin.statusCode, 401);
		assert.equal(reasonOf(wrongPin), undefined, 'a refused PIN must not name a reason');
	});

	await check('admin role routes are deny-by-default: a role alone opens nothing', async () => {
		const { AUTH_PORT } = await import('../dist/infra/tokens.js');
		const { ensureSystemRoles, UserModel, RoleModel, UserRoleAssignmentModel } = models;
		const auth = app.get(AUTH_PORT);

		// A real administrator, created directly because no first-admin bootstrap exists yet
		// (pass 6a). Deliberately granted NO permissions.
		const email = `roles-probe-${randomUUID()}@example.test`;
		emails.push(email);
		const password = 'a-very-long-probe-password';
		const userId = `user_${randomUUID()}`;
		await UserModel.create([
			{
				_id: userId,
				email,
				emailNormalized: email,
				passwordHash: await auth.hashPassword(password),
				role: 'admin',
				status: 'active',
				permissions: [],
				tokenVersion: 0,
				permissionsVersion: 0,
				emailVerifiedAt: new Date(),
			},
		]);
		probeUserIds.push(userId);

		// Anonymous: refused before any permission question is asked.
		const anonymous = await app.inject({ method: 'GET', url: '/admin/roles' });
		assert.equal(anonymous.statusCode, 401, `anonymous reached /admin/roles: ${anonymous.statusCode}`);

		// A storefront customer, who has a perfectly valid session for the wrong audience.
		const customer = await registerCustomer();
		const wrongAudience = await request(customer, 'GET', '/admin/roles');
		assert.equal(wrongAudience.statusCode, 401, 'a storefront session reached an admin surface');

		const jar = new CookieJar();
		const login = await adminRequest(jar, 'POST', '/auth/admin/login', {
			payload: { identifier: email, password },
		});
		assert.equal(login.statusCode, 200, `admin login failed: ${login.statusCode} ${login.body}`);

		// THE PROPERTY: an authenticated administrator, correct audience, admin role — and
		// still refused, because the grant list is authoritative and this one is empty.
		const ungranted = await adminRequest(jar, 'GET', '/admin/roles');
		assert.equal(ungranted.statusCode, 403, `an ungranted admin was allowed in: ${ungranted.statusCode}`);

		// Granting the seeded administrator role opens it, with no re-login: the guard resolves
		// effective permissions per request rather than trusting what the token was minted with.
		await ensureSystemRoles();
		await UserRoleAssignmentModel.create([
			{
				_id: `ura_${randomUUID()}`,
				userId,
				roleId: 'role_system_administrator',
				assignedByUserId: null,
				assignedAt: new Date(),
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			},
		]);

		const granted = await adminRequest(jar, 'GET', '/admin/roles');
		assert.equal(granted.statusCode, 200, `a granted admin was refused: ${granted.statusCode} ${granted.body}`);
		assert.ok(JSON.parse(granted.body).items.length >= 1, 'role list came back empty');

		await Promise.all([
			UserRoleAssignmentModel.deleteMany({ userId }).exec(),
			RoleModel.deleteMany({ _id: 'role_system_administrator' }).exec(),
		]);
	});

	await check('escalation rules hold on the wire: no delegation above self, last admin protected', async () => {
		const { AUTH_PORT } = await import('../dist/infra/tokens.js');
		const { ensureSystemRoles, UserModel, RoleModel, UserRoleAssignmentModel } = models;
		const auth = app.get(AUTH_PORT);
		await ensureSystemRoles();

		const password = 'a-very-long-probe-password';
		const makeAdmin = async (permissions) => {
			const email = `escalation-probe-${randomUUID()}@example.test`;
			emails.push(email);
			const userId = `user_${randomUUID()}`;
			await UserModel.create([
				{
					_id: userId,
					email,
					emailNormalized: email,
					passwordHash: await auth.hashPassword(password),
					role: 'admin',
					status: 'active',
					permissions,
					tokenVersion: 0,
					permissionsVersion: 0,
					emailVerifiedAt: new Date(),
				},
			]);
			probeUserIds.push(userId);
			const jar = new CookieJar();
			const login = await adminRequest(jar, 'POST', '/auth/admin/login', {
				payload: { identifier: email, password },
			});
			assert.equal(login.statusCode, 200, `probe admin login failed: ${login.statusCode}`);
			return { userId, jar };
		};

		// A limited operator: may assign roles, but holds nothing else.
		const limited = await makeAdmin(['user_role.assign', 'user_role.revoke', 'user.index', 'role.create']);
		const victim = await makeAdmin([]);

		// A role carrying a permission the actor does NOT hold.
		const created = await adminRequest(limited.jar, 'POST', '/admin/roles', {
			payload: {
				key: `escalation-${randomUUID().slice(0, 8)}`,
				label: 'Escalation',
				baseRole: 'staff',
				permissions: ['role.destroy'],
			},
		});
		assert.equal(created.statusCode, 201, `role create failed: ${created.statusCode} ${created.body}`);
		const escalationRoleId = JSON.parse(created.body).id;

		// THE PROPERTY: granting it would hand over authority the actor does not have.
		const escalate = await adminRequest(limited.jar, 'POST', `/admin/users/${victim.userId}/roles`, {
			payload: { roleId: escalationRoleId },
		});
		assert.equal(
			escalate.statusCode,
			403,
			`privilege escalation was allowed: ${escalate.statusCode} ${escalate.body}`,
		);
		assert.ok(!escalate.body.includes('role.destroy'), 'the refusal named the missing permission');

		// The administrator role is admin-tier; granting it is refused for the same reason.
		const grantAdmin = await adminRequest(limited.jar, 'POST', `/admin/users/${victim.userId}/roles`, {
			payload: { roleId: 'role_system_administrator' },
		});
		assert.equal(grantAdmin.statusCode, 403, `admin-tier grant was allowed: ${grantAdmin.statusCode}`);

		// Last-administrator protection: seed the only admin assignment, then try to remove it.
		await UserRoleAssignmentModel.create([
			{
				_id: `ura_${randomUUID()}`,
				userId: victim.userId,
				roleId: 'role_system_administrator',
				assignedByUserId: null,
				assignedAt: new Date(),
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			},
		]);

		const revokeLast = await adminRequest(
			limited.jar,
			'DELETE',
			`/admin/users/${victim.userId}/roles/role_system_administrator`,
		);
		assert.equal(revokeLast.statusCode, 409, `the last administrator was revocable: ${revokeLast.statusCode}`);

		await Promise.all([
			UserRoleAssignmentModel.deleteMany({ userId: victim.userId }).exec(),
			RoleModel.deleteMany({ _id: escalationRoleId }).exec(),
			RoleModel.deleteMany({ _id: 'role_system_administrator' }).exec(),
		]);
	});

	/**
	 * Security-negative campaign (auth pass 5c.6).
	 *
	 * The brief's list, each written to FAIL if the control were removed rather than to
	 * describe it. Angular route guards and permission directives are usability only; every
	 * case here calls the endpoint directly, which is the only test that proves anything.
	 */
	await check('direct API: every admin route refuses an ungranted administrator', async () => {
		const probe = await seedAdmin([]);
		const roleId = 'role_system_administrator';

		const surfaces = [
			['GET', '/admin/roles'],
			['GET', `/admin/roles/${roleId}`],
			['POST', '/admin/roles'],
			['PATCH', `/admin/roles/${roleId}`],
			['DELETE', `/admin/roles/${roleId}`],
			['GET', '/admin/permissions'],
			['GET', `/admin/users/${probe.userId}/authority`],
			['POST', `/admin/users/${probe.userId}/roles`],
			['DELETE', `/admin/users/${probe.userId}/roles/${roleId}`],
			['PATCH', `/admin/users/${probe.userId}/status`],
		];

		for (const [method, url] of surfaces) {
			const response = await request(probe.jar, method, url, {
				payload: method === 'GET' || method === 'DELETE' ? undefined : {},
			});
			// 403 is the answer for "authenticated, correct audience, no grant". A 404 or a 400
			// would mean the handler RAN and the authorization gate did not.
			assert.equal(response.statusCode, 403, `${method} ${url} answered ${response.statusCode}, not 403`);
		}
	});

	await check('vertical escalation: a customer session cannot reach any admin surface', async () => {
		const customer = await registerCustomer();

		for (const [method, url] of [
			['GET', '/admin/roles'],
			['GET', '/admin/permissions'],
			['POST', '/admin/roles'],
		]) {
			const response = await request(customer, method, url, { payload: method === 'GET' ? undefined : {} });
			// 401, not 403: the audience boundary answers before any permission question, so a
			// storefront session cannot even learn that the surface exists.
			assert.equal(response.statusCode, 401, `${method} ${url} answered ${response.statusCode}, not 401`);
		}
	});

	await check('BOLA: one customer cannot read another customer’s order', async () => {
		const mine = await registerCustomer();
		const theirs = await registerCustomer();

		const list = await request(mine, 'GET', '/orders');
		assert.equal(list.statusCode, 200, `own order list failed: ${list.statusCode}`);

		// A guessed identifier must not become a read. Absent an order to point at, the
		// property under test is that an id belonging to nobody in this session is refused
		// rather than served.
		const foreign = await request(theirs, 'GET', '/orders/order_00000000-0000-4000-8000-000000000000');
		assert.ok(
			[403, 404].includes(foreign.statusCode),
			`a foreign order id answered ${foreign.statusCode}; expected 403 or 404`,
		);
	});

	await check('self-escalation: an operator cannot grant themselves authority they lack', async () => {
		const { ensureSystemRoles, RoleModel } = models;
		await ensureSystemRoles();
		const probe = await seedAdmin(['user_role.assign', 'user.index']);

		// Granting to SELF is the shortest escalation path, and the subset rule is what closes
		// it: the administrator role holds every code, which this actor does not.
		const response = await adminRequest(probe.jar, 'POST', `/admin/users/${probe.userId}/roles`, {
			payload: { roleId: 'role_system_administrator' },
		});
		assert.equal(response.statusCode, 403, `self-escalation was allowed: ${response.statusCode} ${response.body}`);

		await RoleModel.deleteMany({ _id: 'role_system_administrator' }).exec();
	});

	await check('mixed-target grant is refused whole, never partially applied', async () => {
		const probe = await seedAdmin(['user_role.assign', 'user.index', 'role.create', 'order.index']);
		const victim = await seedAdmin([]);

		// One permission the actor holds, one it does not. A partial application would leave
		// the target holding half a role nobody decided to give them.
		const created = await adminRequest(probe.jar, 'POST', '/admin/roles', {
			payload: {
				key: `mixed-${randomUUID().slice(0, 8)}`,
				label: 'Mixed',
				baseRole: 'staff',
				permissions: ['order.index', 'role.destroy'],
			},
		});
		assert.equal(created.statusCode, 201, `role create failed: ${created.statusCode} ${created.body}`);
		const mixedRoleId = JSON.parse(created.body).id;

		const grant = await adminRequest(probe.jar, 'POST', `/admin/users/${victim.userId}/roles`, {
			payload: { roleId: mixedRoleId },
		});
		assert.equal(grant.statusCode, 403, `a mixed-target grant was allowed: ${grant.statusCode}`);

		// Nothing was applied: the victim still holds no roles at all.
		const after = await adminRequest(probe.jar, 'GET', `/admin/users/${victim.userId}/authority`);
		assert.equal(after.statusCode, 200);
		assert.equal(JSON.parse(after.body).roles.length, 0, 'a refused grant left a role behind');

		await models.RoleModel.deleteMany({ _id: mixedRoleId }).exec();
	});

	await check('TOCTOU and multi-tab: revoking authority takes effect on an existing session', async () => {
		const { ensureSystemRoles, RoleModel, UserRoleAssignmentModel } = models;
		await ensureSystemRoles();

		const probe = await seedAdmin([]);
		const assignmentId = `ura_${randomUUID()}`;
		await UserRoleAssignmentModel.create([
			{
				_id: assignmentId,
				userId: probe.userId,
				roleId: 'role_system_administrator',
				assignedByUserId: null,
				assignedAt: new Date(),
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			},
		]);

		// A SECOND tab: the same account, a separate session established before the revocation.
		const secondTab = new CookieJar();
		const login = await adminRequest(secondTab, 'POST', '/auth/admin/login', {
			payload: { identifier: probe.email, password: probe.password },
		});
		assert.equal(login.statusCode, 200, `second-tab login failed: ${login.statusCode}`);
		assert.equal(
			(await adminRequest(secondTab, 'GET', '/admin/roles')).statusCode,
			200,
			'grant did not take effect',
		);

		// Authority removed underneath both live sessions.
		await UserRoleAssignmentModel.updateOne({ _id: assignmentId }, { $set: { revokedAt: new Date() } }).exec();

		// THE PROPERTY: no re-login, no token change, no cache expiry — the very next request
		// on each existing session must already be refused, because the guard re-derives
		// permissions per request rather than trusting what the token was minted with.
		for (const [label, jar] of [
			['first tab', probe.jar],
			['second tab', secondTab],
		]) {
			const response = await adminRequest(jar, 'GET', '/admin/roles');
			assert.equal(response.statusCode, 403, `${label} kept revoked authority: ${response.statusCode}`);
		}

		await Promise.all([
			UserRoleAssignmentModel.deleteMany({ userId: probe.userId }).exec(),
			RoleModel.deleteMany({ _id: 'role_system_administrator' }).exec(),
		]);
	});

	await check('no HTTP route can create an administrator (pass 6a)', async () => {
		// The bootstrap is an operator action precisely so the network cannot reach it. These
		// are the shapes somebody would try if they assumed otherwise.
		for (const url of [
			'/auth/admin/bootstrap',
			'/auth/admin/first-admin',
			'/admin/bootstrap',
			'/admin/users/bootstrap',
		]) {
			const response = await app.inject({ method: 'POST', url, payload: { email: 'x@example.test' } });
			assert.equal(response.statusCode, 404, `${url} exists and answered ${response.statusCode}`);
		}

		// And self-registration cannot escalate: the storefront route ignores any role asked for.
		const jar = new CookieJar();
		const email = `role-injection-${randomUUID()}@example.test`;
		emails.push(email);
		const registered = await request(jar, 'POST', '/auth/storefront/register', {
			payload: { email, password: 'a-very-long-probe-password', role: 'admin', permissions: ['role.destroy'] },
		});
		assert.equal(registered.statusCode, 201, `registration failed: ${registered.statusCode}`);

		// Queried by `email`, and the document's own address is re-asserted before its role is
		// read. An earlier version filtered on `emailNormalized`, which registration does not
		// reliably set, so it matched a DIFFERENT account and reported a privilege-escalation
		// vulnerability that does not exist. A probe against a clean database showed the
		// handler hard-codes `role: 'customer'`.
		const created = await models.UserModel.findOne({ email }).lean().exec();
		assert.ok(created, 'the registered account was not found');
		assert.equal(created.email, email, 'matched the wrong account');
		assert.equal(created.role, 'customer', `registration honoured an injected role: ${created.role}`);
		assert.deepEqual(created.permissions ?? [], [], 'registration honoured injected permissions');
	});

	await check('admin Security Settings: PIN lifecycle and recent-password proof (pass 6b)', async () => {
		const password = 'a-very-long-probe-password';
		const probe = await seedAdmin(['user.index']);
		const settings = () => adminRequest(probe.jar, 'GET', '/auth/admin/security');

		const initial = await settings();
		assert.equal(initial.statusCode, 200, `security settings unreachable: ${initial.statusCode}`);
		const before = JSON.parse(initial.body);
		assert.equal(before.hasPin, false, 'a fresh administrator should have no PIN');
		assert.equal(before.preferredLoginMethod, 'password');
		assert.ok(before.activeSessions >= 1, 'the calling session should be counted');
		// The state exists, the credential never does.
		assert.ok(!initial.body.includes('pinHash'), 'settings leaked the PIN hash field');

		// Recent-password proof: the wrong password sets nothing.
		const refused = await adminRequest(probe.jar, 'POST', '/auth/admin/pin', {
			payload: { currentPassword: 'not-the-password', pin: '135790' },
		});
		assert.equal(refused.statusCode, 401, `a PIN was set without password proof: ${refused.statusCode}`);
		assert.equal(JSON.parse((await settings()).body).hasPin, false, 'a refused attempt still set a PIN');

		const set = await adminRequest(probe.jar, 'POST', '/auth/admin/pin', {
			payload: { currentPassword: password, pin: '135790', preferredLoginMethod: 'pin' },
		});
		assert.equal(set.statusCode, 204, `setting a PIN failed: ${set.statusCode} ${set.body}`);
		const afterSet = JSON.parse((await settings()).body);
		assert.equal(afterSet.hasPin, true);
		assert.equal(afterSet.preferredLoginMethod, 'pin');

		// The PIN actually works as a credential, which is the only proof that matters.
		const pinJar = new CookieJar();
		const pinLogin = await request(pinJar, 'POST', '/auth/admin/login/pin', {
			payload: { identifier: probe.email, pin: '135790' },
		});
		assert.equal(pinLogin.statusCode, 200, `PIN login failed after setup: ${pinLogin.statusCode}`);

		// Removal needs the same proof, and takes the preferred method back with it.
		const removeRefused = await adminRequest(probe.jar, 'POST', '/auth/admin/pin/remove', {
			payload: { currentPassword: 'not-the-password' },
		});
		assert.equal(removeRefused.statusCode, 401, 'a PIN was removed without password proof');

		const removed = await adminRequest(probe.jar, 'POST', '/auth/admin/pin/remove', {
			payload: { currentPassword: password },
		});
		assert.equal(removed.statusCode, 204, `removing the PIN failed: ${removed.statusCode}`);
		const afterRemove = JSON.parse((await settings()).body);
		assert.equal(afterRemove.hasPin, false);
		// Left on `pin`, an operator would be shown a PIN screen for a credential that no
		// longer exists — a login they cannot complete and cannot explain.
		assert.equal(afterRemove.preferredLoginMethod, 'password', 'preferred method survived PIN removal');

		const pinAfterRemoval = await request(new CookieJar(), 'POST', '/auth/admin/login/pin', {
			payload: { identifier: probe.email, pin: '135790' },
		});
		assert.equal(pinAfterRemoval.statusCode, 401, 'a removed PIN still authenticates');
	});

	await check('admin password change ends every session, including the one that changed it (pass 6b)', async () => {
		const password = 'a-very-long-probe-password';
		const next = 'an-even-longer-replacement-password';
		const probe = await seedAdmin(['user.index']);

		// A second tab, established before the change.
		const otherTab = new CookieJar();
		const secondLogin = await request(otherTab, 'POST', '/auth/admin/login', {
			payload: { identifier: probe.email, password },
		});
		assert.equal(secondLogin.statusCode, 200);
		assert.equal((await adminRequest(otherTab, 'GET', '/auth/admin/security')).statusCode, 200);

		const wrongProof = await adminRequest(probe.jar, 'POST', '/auth/admin/password/change', {
			payload: { currentPassword: 'not-the-password', newPassword: next },
		});
		assert.equal(wrongProof.statusCode, 401, 'the password changed without proof of the old one');

		const changed = await adminRequest(probe.jar, 'POST', '/auth/admin/password/change', {
			payload: { currentPassword: password, newPassword: next },
		});
		assert.equal(changed.statusCode, 204, `password change failed: ${changed.statusCode} ${changed.body}`);

		// THE PROPERTY: a stolen cookie must not outlive the credential it was obtained under.
		// Rotation must not rescue either tab — the refresh tokens died with the sessions.
		for (const [label, jar] of [
			['changing tab', probe.jar],
			['other tab', otherTab],
		]) {
			const after = await adminRequest(jar, 'GET', '/auth/admin/security');
			assert.equal(after.statusCode, 401, `${label} survived the password change: ${after.statusCode}`);
		}

		/**
		 * The assertion that separates the two implementations.
		 *
		 * `setPasswordHash` bumps `tokenVersion`, so the ACCESS tokens die whether or not the
		 * sessions are revoked — checking for a 401 alone passes either way, which it did
		 * until a mutation run exposed it. What actually matters is that the REFRESH token
		 * died too: otherwise a stolen cookie rotates straight back into a live session and
		 * outlives the credential it was obtained under.
		 */
		for (const [label, jar] of [
			['changing tab', probe.jar],
			['other tab', otherTab],
		]) {
			const rotated = await request(jar, 'POST', '/auth/admin/refresh', { payload: {} });
			assert.notEqual(rotated.statusCode, 200, `${label} rotated back in after the password change`);
		}

		assert.equal(
			(
				await request(new CookieJar(), 'POST', '/auth/admin/login', {
					payload: { identifier: probe.email, password },
				})
			).statusCode,
			401,
			'the old password still works',
		);
		assert.equal(
			(
				await request(new CookieJar(), 'POST', '/auth/admin/login', {
					payload: { identifier: probe.email, password: next },
				})
			).statusCode,
			200,
			'the new password does not work',
		);
	});

	// Probe rows are removed explicitly, not merely isolated in their own database.
	//
	// RBAC rows are cleared here as well as inside the checks that create them, because a
	// check's own cleanup is skipped when an assertion throws. A failed run used to leave
	// roles and assignments behind, and the NEXT run then failed for reasons that had nothing
	// to do with the code under test — last-admin protection tripping on a stale assignment.
	// Diagnosing that costs far more than deleting a few rows unconditionally.
	await models.AuthRateLimitModel.deleteMany({});
	await models.UserRoleAssignmentModel.deleteMany({});
	await models.RoleModel.deleteMany({});
	// Audit rows are written by the admin surfaces this run exercises. They are evidence in
	// production and debris here, and they were silently accumulating across runs while the
	// summary below reported "0 remaining" — which counted users only. Cleared and counted so
	// the claim matches what is actually left.
	const auditRemoved = (await models.AuditLogModel.deleteMany({})).deletedCount ?? 0;
	// Registration issues a verification token per probe, and those were accumulating unseen —
	// 404 of them, while the summary said "0 remaining". Every collection a run can write to is
	// cleared, and the assertion below is what stops the next one being discovered by accident.
	await Promise.all([
		models.EmailVerificationTokenModel.deleteMany({}),
		models.OtpChallengeModel.deleteMany({}),
		models.PasswordResetTokenModel.deleteMany({}),
		models.OAuthStateModel.deleteMany({}),
		models.AdminInviteModel.deleteMany({}),
	]);
	/**
	 * Users are cleared WHOLESALE, not by tracked id or address.
	 *
	 * The refusal assertions call the bootstrap with addresses they expect to be rejected, so
	 * those are never registered for cleanup — and when a refusal genuinely fails, the account
	 * it should not have created survives into the next run and breaks it for an unrelated
	 * reason. Tracking every address a check MIGHT create is a losing game in a database that
	 * exists only for this suite.
	 */
	const probeAccounts = await models.UserModel.countDocuments({});
	await models.AuthSessionModel.deleteMany({});
	await models.UserModel.deleteMany({});
	const remaining = await models.UserModel.countDocuments({});

	/**
	 * The claim, verified rather than asserted in prose.
	 *
	 * Enumerating the database beats listing what we think we wrote: two leaks (audit rows,
	 * verification tokens) were found only because someone looked. A collection that survives
	 * this is reported by name and fails the run.
	 */
	const leftovers = [];
	// Reached through the adapter, which owns the mongoose dependency; the API does not have one.
	const database = models.getMongoose().connection.db;
	for (const collection of await database.listCollections().toArray()) {
		const count = await database.collection(collection.name).countDocuments({});
		if (count > 0) leftovers.push(`${collection.name}=${count}`);
	}

	await app.close();

	console.log(
		`\nrefusal codes: session-without-csrf=${refusalCodes.sessionWithoutCsrf} no-cookies=${refusalCodes.noCookies}`,
	);
	console.log(
		`probe accounts created ${emails.length}, present at teardown ${probeAccounts}, remaining ${remaining}; ` +
			`audit rows removed ${auditRemoved}`,
	);

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
	if (remaining !== 0) {
		console.error('cleanup incomplete — probe rows remain');
		process.exitCode = 1;
	}
	if (leftovers.length > 0) {
		console.error(`cleanup incomplete — collections still populated: ${leftovers.join(', ')}`);
		process.exitCode = 1;
	}
	if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
