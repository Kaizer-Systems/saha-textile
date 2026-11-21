import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { keyFolder } from './first-boot.mjs';
import { SetupError, certificateFiles, githubEnvironment, knownHosts } from './server-setup.mjs';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----\n';

test('certificate files: only what changed is saved, the Origin key from this machine', async () => {
	const fetchText = async () => CERT;
	// A kept Origin Certificate with a new origin-pulls CA saves the CA alone.
	const only = await certificateFiles({ project: 'example-x', environment: 'staging', aopCa: CERT }, { fetchText });
	assert.deepEqual(Object.keys(only.files), ['cloudflare-client-ca.pem']);
	assert.equal(only.keyFile, null);
	await assert.rejects(certificateFiles({ project: 'example-x', environment: 'staging' }, { fetchText }), SetupError);
	await assert.rejects(
		certificateFiles({ project: 'example-x', environment: 'staging', certificate: CERT }, { fetchText }),
		/key is not on this machine/,
	);
	// With the key made here, the certificate and its key go together, plus Cloudflare's root.
	const folder = keyFolder('example-y', 'staging');
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'origin.key'), '-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----\n');
	const all = await certificateFiles(
		{ project: 'example-y', environment: 'staging', certificate: CERT, originCa: true },
		{ fetchText },
	);
	assert.deepEqual(Object.keys(all.files).sort(), ['origin-ca.pem', 'origin.key', 'origin.pem']);
	assert.ok(all.keyFile?.startsWith(join(homedir(), '.release-console', 'servers')));
	rmSync(folder, { recursive: true, force: true });
});

test('the GitHub environment is made only when missing, and secrets go on stdin', async () => {
	const calls = [];
	const exec = async (cmd, args) => {
		calls.push(args.join(' '));
		if (args[0] === 'api' && args.length === 2) throw new Error('404');
		return { stdout: '' };
	};
	const stdins = [];
	const spawnFn = (_cmd, args) => {
		const child = new EventEmitter();
		child.stdin = new PassThrough();
		child.stderr = new PassThrough();
		let input = '';
		child.stdin.on('data', (c) => (input += c));
		child.stdin.on('end', () => {
			stdins.push([args[2], input]);
			setImmediate(() => child.emit('close', 0));
		});
		return child;
	};
	const r = await githubEnvironment(
		{
			repository: 'example/shop',
			environment: 'staging',
			variables: { SERVER_SSH_HOST: 'ssh-staging.example.com' },
			secrets: { CF_ACCESS_CLIENT_ID: 'example-id' },
		},
		{ exec, spawnFn },
	);
	assert.equal(r.environmentMade, true);
	assert.ok(calls.includes('api -X PUT repos/example/shop/environments/staging'));
	assert.ok(calls.some((c) => c.startsWith('variable set SERVER_SSH_HOST --env staging')));
	assert.deepEqual(stdins, [['CF_ACCESS_CLIENT_ID', 'example-id']]);
	// No secret value ever appears on a command line.
	assert.ok(!calls.some((c) => c.includes('example-id')));
	await assert.rejects(
		githubEnvironment({ repository: 'bad', environment: 'staging' }, { exec, spawnFn }),
		SetupError,
	);
});

test('the host key read says plainly when cloudflared is missing', async () => {
	const exec = async (cmd) => {
		if (cmd === 'which') throw new Error('not found');
		return { stdout: '' };
	};
	await assert.rejects(
		knownHosts({ host: 'ssh-staging.example.com', tokenId: 'a', tokenSecret: 'b' }, { exec }),
		/cloudflared is not on this machine/,
	);
	assert.ok(mkdtempSync(join(tmpdir(), 'rc-')));
});
