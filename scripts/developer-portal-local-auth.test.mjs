import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
	assertLoopbackHost,
	clearSessionCookie,
	createDeveloperPortalLocalAuth,
	createSessionCookie,
	developerPortalPasswordVariable,
	developerPortalSessionCookie,
	developerPortalUsernameVariable,
	environmentWithoutDeveloperPortalCredentials,
	formatPortalOrigin,
	hasExpectedPortalOrigin,
	readDeveloperPortalCredentials,
	readUrlEncodedBody,
	sanitizePortalReturnPath,
} from './developer-portal-local-auth.mjs';

test('the portal server accepts loopback hosts and rejects network bindings', () => {
	for (const host of ['127.0.0.1', 'localhost', '::1']) {
		assert.doesNotThrow(() => assertLoopbackHost(host));
	}
	assert.throws(() => assertLoopbackHost('0.0.0.0'), /local-only/u);
	assert.throws(() => assertLoopbackHost('192.168.1.20'), /local-only/u);
	assert.equal(formatPortalOrigin('::1', 3457), 'http://[::1]:3457');
});

test('credentials load from the server environment without introducing defaults', async () => {
	const credentials = await readDeveloperPortalCredentials({
		environment: {
			[developerPortalUsernameVariable]: 'portal-owner',
			[developerPortalPasswordVariable]: 'correct-horse-battery-staple',
		},
		filePath: '/path/that/does/not/exist',
	});
	assert.deepEqual(credentials, {
		username: 'portal-owner',
		password: 'correct-horse-battery-staple',
	});

	await assert.rejects(
		readDeveloperPortalCredentials({ environment: {}, filePath: '/path/that/does/not/exist' }),
		/missing/u,
	);
});

test('credential variables are removed from child build environments', () => {
	assert.deepEqual(
		environmentWithoutDeveloperPortalCredentials({
			PATH: '/usr/bin',
			[developerPortalUsernameVariable]: 'portal-owner',
			[developerPortalPasswordVariable]: 'secret',
		}),
		{ PATH: '/usr/bin' },
	);
});

test('return paths preserve safe deep links and reject external or internal destinations', () => {
	assert.equal(sanitizePortalReturnPath('/tools/storybook?panel=docs#intro'), '/tools/storybook?panel=docs#intro');
	assert.equal(sanitizePortalReturnPath('https://example.com/private'), '/');
	assert.equal(sanitizePortalReturnPath('//example.com/private'), '/');
	assert.equal(sanitizePortalReturnPath('/__portal/events'), '/');
	assert.equal(sanitizePortalReturnPath(undefined), '/');
});

test('credential validation and sessions stay process-local', () => {
	const auth = createDeveloperPortalLocalAuth({ username: 'portal-owner', password: 'secret' });
	assert.equal(auth.authenticate('portal-owner', 'secret'), true);
	assert.equal(auth.authenticate('portal-owner', 'incorrect'), false);
	assert.equal(auth.authenticate('incorrect', 'secret'), false);

	const token = auth.createSession();
	const cookie = `${developerPortalSessionCookie}=${token}; another=value`;
	assert.equal(auth.hasSession(cookie), true);
	assert.equal(auth.destroySession(cookie), true);
	assert.equal(auth.hasSession(cookie), false);
	assert.match(createSessionCookie(token), /HttpOnly; SameSite=Strict; Path=\//u);
	assert.match(clearSessionCookie(), /Max-Age=0/u);
});

test('state-changing requests require a matching loopback origin and host on the configured port', () => {
	for (const localOrigin of ['http://127.0.0.1:3457', 'http://localhost:3457', 'http://[::1]:3457']) {
		assert.equal(
			hasExpectedPortalOrigin(
				{ headers: { origin: localOrigin, host: new URL(localOrigin).host } },
				'http://127.0.0.1:3457',
			),
			true,
		);
	}
	assert.equal(
		hasExpectedPortalOrigin(
			{ headers: { origin: 'http://localhost:3457', host: '127.0.0.1:3457' } },
			'http://127.0.0.1:3457',
		),
		false,
	);
	assert.equal(
		hasExpectedPortalOrigin(
			{ headers: { origin: 'http://127.0.0.1:3460', host: '127.0.0.1:3460' } },
			'http://127.0.0.1:3457',
		),
		false,
	);
	assert.equal(
		hasExpectedPortalOrigin(
			{ headers: { origin: 'https://elsewhere.example', host: '127.0.0.1:3457' } },
			'http://127.0.0.1:3457',
		),
		false,
	);
	assert.equal(
		hasExpectedPortalOrigin(
			{ headers: { origin: 'http://192.168.1.20:3457', host: '192.168.1.20:3457' } },
			'http://127.0.0.1:3457',
		),
		false,
	);
});

test('URL-encoded bodies are parsed and bounded', async () => {
	const request = Readable.from(['username=portal-owner&password=secret&next=%2Ftypedoc%2F']);
	const body = await readUrlEncodedBody(request);
	assert.equal(body.get('username'), 'portal-owner');
	assert.equal(body.get('next'), '/typedoc/');

	const oversizedRequest = Readable.from(['password=123456789']);
	await assert.rejects(readUrlEncodedBody(oversizedRequest, 8), (error) => error.statusCode === 413);
});
