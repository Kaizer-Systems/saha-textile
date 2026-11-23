import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FirstBootError, deployKey, keyFolder, passwordHash, prepareFirstBoot } from './first-boot.mjs';

const ADMIN = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleOnlyExampleOnlyExampleOnlyExample admin@example';
const TOKEN = 'eyJhIjoiZXhhbXBsZS1vbmx5LXRva2VuLWZvci10ZXN0cyJ9eyJhIjoiZXhhbXBsZSJ9';

/** A stand-in for ssh-keygen: writes a made-up public key where the real one would go. */
const fakeKeygen = async (_cmd, args) => {
	const file = args[args.indexOf('-f') + 1];
	writeFileSync(file, 'private (test)');
	writeFileSync(
		`${file}.pub`,
		'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployDeployDeployDeployDeployDeployDeploy deploy@test\n',
	);
	return { stdout: '' };
};

test('the deploy key pair is made once per server and reused', async () => {
	const home = mkdtempSync(join(tmpdir(), 'rc-first-boot-'));
	let made = 0;
	const exec = async (c, a) => {
		made += 1;
		return fakeKeygen(c, a);
	};
	const one = await deployKey('saha-textile', 'staging', { home, exec });
	const two = await deployKey('saha-textile', 'staging', { home, exec });
	assert.equal(made, 1);
	assert.equal(one.file, join(home, '.release-console', 'servers', 'saha-textile-staging', 'deploy_key'));
	assert.equal(two.publicKey, one.publicKey);
	assert.throws(() => keyFolder('../x', 'staging', home), FirstBootError);
	assert.throws(() => keyFolder('saha-textile', undefined, home), FirstBootError);
});

test('the admin password is hashed with SHA-512 crypt and refused when too short', async () => {
	const hash = await passwordHash('example only words');
	assert.match(hash, /^\$6\$/);
	await assert.rejects(passwordHash('short'), FirstBootError);
	await assert.rejects(passwordHash('two\nlines here please'), FirstBootError);
});

test('the first-boot file is filled with every marker and refuses a bad key or token', async () => {
	const root = mkdtempSync(join(tmpdir(), 'rc-first-boot-root-'));
	const home = mkdtempSync(join(tmpdir(), 'rc-first-boot-home-'));
	mkdirSync(join(root, 'docker/production/bin'), { recursive: true });
	writeFileSync(join(root, 'docker/production/bin/receive-release.sh'), '#!/bin/sh\necho receive\n');
	writeFileSync(join(root, 'docker/production/bin/observe.sh'), '#!/bin/sh\necho observe\n');
	// The markers the real file has (docker/production/first-boot.yaml), the observer's among them (M9).
	writeFileSync(
		join(root, 'docker/production/first-boot.yaml'),
		"users:\n  - name: '@@ADMIN_USER@@'\n    passwd: '@@ADMIN_PASSWORD_HASH@@'\n    keys: ['@@ADMIN_SSH_KEY@@', '@@DEPLOY_SSH_KEY@@', '@@OBSERVER_SSH_KEY@@']\ntoken: '@@TUNNEL_TOKEN@@'\nreceive: '@@RECEIVE_RELEASE_B64@@'\nobserve: '@@OBSERVE_B64@@'\n",
	);
	const deps = { root, home, exec: fakeKeygen, hash: async () => '$6$salt$hash' };
	const out = await prepareFirstBoot(
		{
			project: 'saha-textile',
			environment: 'staging',
			adminKey: ADMIN,
			password: 'not used here',
			tunnelToken: TOKEN,
		},
		deps,
	);
	assert.doesNotMatch(out.userData, /@@/);
	assert.match(out.userData, /saha-textile-admin/);
	assert.match(out.userData, /\$6\$salt\$hash/);
	assert.match(out.deployPublicKey, /^ssh-ed25519 /);
	assert.match(
		out.userData,
		new RegExp(Buffer.from('#!/bin/sh\necho observe\n').toString('base64').replace(/[+/=]/g, '.')),
	);
	assert.ok(existsSync(join(home, '.release-console', 'servers', 'saha-textile-staging', 'observer_key')));
	await assert.rejects(
		prepareFirstBoot(
			{ project: 'saha-textile', environment: 'staging', adminKey: 'nope', password: 'x', tunnelToken: TOKEN },
			deps,
		),
		/not an SSH public key/,
	);
	await assert.rejects(
		prepareFirstBoot(
			{ project: 'saha-textile', environment: 'staging', adminKey: ADMIN, password: 'x', tunnelToken: 'short' },
			deps,
		),
		/tunnel token/,
	);
});
