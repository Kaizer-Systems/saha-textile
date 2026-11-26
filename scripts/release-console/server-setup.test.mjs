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

test('adds the branch and release-tag rules, keeps the reviewers, and only reads them', async () => {
	const { environmentRules } = await import('./server-setup.mjs');
	const calls = [];
	const exec = async (cmd, args, opts) => {
		calls.push({ args, input: opts?.input });
		const path = args.at(-1);
		if (args[1] === 'repos/o/r/environments/staging')
			return {
				stdout: JSON.stringify({
					protection_rules: [
						{
							type: 'required_reviewers',
							prevent_self_review: false,
							reviewers: [{ type: 'User', reviewer: { id: 7 } }],
						},
					],
					deployment_branch_policy: null,
				}),
			};
		if (String(path).includes('deployment-branch-policies?'))
			return { stdout: JSON.stringify({ branch_policies: [{ name: 'staging', type: 'branch' }] }) };
		return { stdout: '{}' };
	};
	let put = '';
	const spawnFn = (_cmd, args) => {
		const child = new EventEmitter();
		child.stderr = new PassThrough();
		child.stdin = new PassThrough();
		child.stdin.on('data', (c) => (put += c));
		child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0)));
		calls.push({ args });
		return child;
	};
	const r = await environmentRules(
		{ repository: 'o/r', environment: 'staging', branch: 'staging' },
		{ exec, spawnFn },
	);
	assert.equal(r.reviewers, 1);
	assert.deepEqual(r.set, ['branch rules: only the listed branches and tags', 'tag staging-*']);
	assert.ok(calls.some((c) => c.args.includes('PUT')));
	assert.deepEqual(JSON.parse(put).reviewers, [{ type: 'User', id: 7 }]);
	assert.ok(calls.some((c) => c.args.includes('name=staging-*') && c.args.includes('type=tag')));
	await assert.rejects(
		environmentRules({ repository: 'o/r', environment: 'staging', branch: 'bad branch' }, { exec, spawnFn }),
	);
});

test('asks the observer only what observe.sh answers, with its token in the environment', async () => {
	const { observe, saveObserverToken } = await import('./server-setup.mjs');
	const home = mkdtempSync(join(tmpdir(), 'rc-observe-'));
	const before = process.env.HOME;
	process.env.HOME = home;
	try {
		await assert.rejects(
			observe({
				project: 'example',
				environment: 'staging',
				host: 'ssh-staging.example.com',
				request: 'logs api; id',
			}),
			/does not answer that request/,
		);
		await assert.rejects(
			observe({
				project: 'example',
				environment: 'staging',
				host: 'ssh-staging.example.com',
				request: 'containers',
			}),
			/no observer key or token/,
		);
		const folder = keyFolder('example', 'staging');
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'observer_key'), 'private (test)');
		saveObserverToken({
			project: 'example',
			environment: 'staging',
			clientId: 'example-client-id',
			clientSecret: 'example-client-secret-0001',
		});
		let seen;
		const exec = async (_cmd, args, opts) => {
			seen = { args, env: opts.env };
			return { stdout: '{"containers":[]}' };
		};
		const out = await observe(
			{
				project: 'example',
				environment: 'staging',
				host: 'ssh-staging.example.com',
				request: 'logs api --since 15',
			},
			{ exec },
		);
		assert.deepEqual(out, { containers: [] });
		assert.equal(seen.args.at(-1), 'logs api --since 15');
		assert.equal(seen.args.at(-2), 'observer@ssh-staging.example.com');
		assert.equal(seen.env.TUNNEL_SERVICE_TOKEN_ID, 'example-client-id');
		assert.ok(!seen.args.join(' ').includes('example-client-secret'));
	} finally {
		process.env.HOME = before;
		rmSync(home, { recursive: true, force: true });
	}
});
