import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { rotateArgs, rotateSecrets } from './runner.mjs';

test('asks the rotate script only for a server tier and known value ids', () => {
	assert.deepEqual(rotateArgs({ tier: 'staging', ids: ['redis', 'sign-in', 'redis', 'nope'], grace: true }), [
		'--silent',
		'secrets:rotate',
		'--',
		'staging',
		'--names',
		'redis,sign-in',
		'--json',
	]);
	assert.deepEqual(rotateArgs({ tier: 'production', ids: ['csrf'], grace: false }).slice(4), [
		'--names',
		'csrf',
		'--no-grace',
		'--json',
	]);
	assert.deepEqual(rotateArgs({ tier: 'staging', clearPrevious: true }).slice(4), ['--clear-previous', '--json']);
	assert.throws(() => rotateArgs({ tier: 'local', ids: ['redis'] }), /server environment/);
	assert.throws(() => rotateArgs({ tier: 'staging', ids: [] }), /at least one/);
});

/** A stand-in child process that prints `out` and ends with `code`. */
function child(out, code, err = '') {
	const c = new EventEmitter();
	c.stdout = new PassThrough();
	c.stderr = new PassThrough();
	c.kill = () => {};
	setImmediate(() => {
		c.stdout.end(out);
		c.stderr.end(err);
		setImmediate(() => c.emit('close', code));
	});
	return c;
}

test('answers with the script’s last JSON line, or its last error line', async () => {
	const answer = { tier: 'staging', changed: ['REDIS_PASSWORD'], needsRotateDeploy: true };
	const got = await rotateSecrets({ tier: 'staging', ids: ['redis'] }, () =>
		child(`> secrets:rotate\n${JSON.stringify(answer)}\n`, 0),
	);
	assert.deepEqual(got, answer);
	await assert.rejects(
		rotateSecrets({ tier: 'staging', ids: ['redis'] }, () =>
			child('', 1, 'starting\nInfisical sign-in has expired.\n'),
		),
		/Infisical sign-in has expired/,
	);
});

test('finds the deploy identity of the tier an Infisical place belongs to', async () => {
	const { deployIdentityOf } = await import('./runner.mjs');
	const inventory = {
		projects: {
			local: { name: 'saha-textile-local', environment: 'dev' },
			development: { name: 'saha-textile-development', environment: 'dev' },
			staging: {
				name: 'saha-textile-staging',
				environment: 'staging',
				deployIdentityId: '1f0b5c2e-0000-4000-8000-000000000001',
			},
			production: { name: 'saha-textile-production', environment: 'prod', deployIdentityId: '' },
		},
	};
	assert.deepEqual(deployIdentityOf({ project: 'saha-textile-staging', environment: 'staging' }, inventory), {
		tier: 'staging',
		identityId: '1f0b5c2e-0000-4000-8000-000000000001',
	});
	assert.deepEqual(deployIdentityOf({ project: 'saha-textile-production', environment: 'prod' }, inventory), {
		tier: 'production',
		identityId: null,
	});
	assert.deepEqual(deployIdentityOf({ project: 'elsewhere', environment: 'x' }, inventory), {
		tier: null,
		identityId: null,
	});
});
