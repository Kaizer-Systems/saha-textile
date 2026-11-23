import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	createServer,
	describePlan,
	destroyServer,
	firewallRules,
	firstBootValues,
	renderFirstBoot,
	ROOT,
	serverOf,
	ServerError,
} from './servers.mjs';

const template = readFileSync(join(ROOT, 'docker/production/first-boot.yaml'), 'utf8');
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyNotReal owner@laptop';
const RANGES = [
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'2400:cb00::/32',
];
const values = {
	ADMIN_USER: 'saha-textile-admin',
	ADMIN_SSH_KEY: KEY,
	DEPLOY_SSH_KEY: KEY.replace('owner@laptop', 'deploy'),
	ADMIN_PASSWORD_HASH: '$6$saltsalt$notarealhashnotarealhash',
	TUNNEL_TOKEN: 'test-tunnel-token-not-real-0123456789abcdefghijklmnop',
	RECEIVE_RELEASE_B64: Buffer.from('#!/bin/sh\n').toString('base64'),
	OBSERVER_SSH_KEY: KEY.replace('owner@laptop', 'observer'),
	OBSERVE_B64: Buffer.from('#!/bin/sh\n').toString('base64'),
};

/** A stand-in for doctl that records each call and answers from `answers` by its first two words. */
function doctl(answers = {}) {
	const calls = [];
	const exec = async (cmd, args) => {
		calls.push([cmd, ...args].join(' '));
		const key = args.slice(0, 3).join(' ');
		return { stdout: answers[key] ?? '[]' };
	};
	return { calls, exec };
}

test('one server per environment, production never removable', () => {
	assert.equal(serverOf('staging').name, 'saha-textile-staging');
	assert.equal(serverOf('production').size, 's-4vcpu-8gb');
	assert.equal(serverOf('production').removable, false);
	assert.throws(() => serverOf('qa'), /No server is planned for qa/);
});

test('the first-boot file is filled in full, and odd values are refused', () => {
	const out = renderFirstBoot(template, values);
	assert.ok(!out.includes('@@'), 'every marker is filled');
	assert.match(out, /^#cloud-config/);
	assert.match(out, /command="sudo -n \/opt\/saha-textile\/bin\/receive-release.sh" ssh-ed25519/);
	assert.throws(() => renderFirstBoot(template, { ...values, TUNNEL_TOKEN: "a'b" }), /line break or a quote/);
	assert.throws(() => renderFirstBoot(template, { ...values, ADMIN_USER: 'x\ny' }), /line break or a quote/);
	const { TUNNEL_TOKEN: _left, ...missing } = values;
	assert.throws(() => renderFirstBoot(template, missing), /TUNNEL_TOKEN unfilled/);
});

test('first-boot values come from the terminal, checked and never echoed', () => {
	const read = (path) => (path.endsWith('.sh') ? '#!/bin/sh\n' : `${KEY}\n`);
	const env = {
		SERVER_ADMIN_SSH_KEY_FILE: '/k/admin.pub',
		SERVER_DEPLOY_SSH_KEY_FILE: '/k/deploy.pub',
		SERVER_OBSERVER_SSH_KEY_FILE: '/k/observer.pub',
		SERVER_ADMIN_PASSWORD_HASH: values.ADMIN_PASSWORD_HASH,
		SERVER_TUNNEL_TOKEN: values.TUNNEL_TOKEN,
	};
	const got = firstBootValues(env, read);
	assert.equal(got.ADMIN_USER, 'saha-textile-admin');
	assert.equal(Buffer.from(got.RECEIVE_RELEASE_B64, 'base64').toString(), '#!/bin/sh\n');
	assert.equal(Buffer.from(got.OBSERVE_B64, 'base64').toString(), '#!/bin/sh\n');
	assert.ok(got.OBSERVER_SSH_KEY.startsWith('ssh-'));
	assert.throws(
		() =>
			firstBootValues({ ...env, SERVER_OBSERVER_SSH_KEY_FILE: '' }, (path) =>
				path === '' ? 'not a key' : read(path),
			),
		/SERVER_OBSERVER_SSH_KEY_FILE/,
	);
	assert.throws(() => firstBootValues({ ...env, SERVER_ADMIN_PASSWORD_HASH: 'plain' }, read), /SHA-512 crypt/);
	assert.throws(() => firstBootValues({ ...env, SERVER_TUNNEL_TOKEN: '' }, read), /SERVER_TUNNEL_TOKEN/);
	assert.throws(() => firstBootValues(env, () => 'not a key'), /not one public SSH key/);
	try {
		firstBootValues({ ...env, SERVER_ADMIN_PASSWORD_HASH: 'plain' }, read);
	} catch (error) {
		assert.ok(!String(error.message).includes(values.TUNNEL_TOKEN));
	}
});

test('the firewall lets in 443 from Cloudflare only', () => {
	const rules = firewallRules([...RANGES, 'junk', '']);
	assert.equal(rules.count, RANGES.length);
	assert.match(rules.inbound, /^protocol:tcp,ports:443,address:173\.245\.48\.0\/20/);
	assert.ok(!rules.inbound.includes('ports:22'));
	assert.throws(() => firewallRules(['junk']), /could not be read/);
});

test('the plan touches nothing and holds no value', () => {
	const text = describePlan('staging').join('\n');
	assert.match(text, /saha-textile-staging/);
	assert.match(text, /443 from Cloudflare/);
	assert.ok(!text.includes(values.TUNNEL_TOKEN));
});

test('create sets up the droplet and its firewall, and refuses an existing droplet', async () => {
	const { calls, exec } = doctl({
		'compute ssh-key list': JSON.stringify([{ public_key: KEY, fingerprint: 'aa:bb' }]),
	});
	await createServer('staging', { values, ranges: RANGES, exec, template });
	const create = calls.find((c) => c.includes('droplet create'));
	assert.match(create, /saha-textile-staging --region blr1 --size s-2vcpu-4gb/);
	assert.match(create, /--ssh-keys aa:bb/);
	assert.match(create, /--enable-monitoring/);
	assert.ok(
		!calls.join('\n').includes(values.TUNNEL_TOKEN),
		'the token goes in the user-data file, never an argument',
	);
	assert.ok(calls.some((c) => c.includes('firewall create --name saha-textile-staging')));
	const busy = doctl({ 'compute droplet list': JSON.stringify([{ id: 1 }]) });
	await assert.rejects(
		createServer('staging', { values, ranges: RANGES, exec: busy.exec, template }),
		/already exists/,
	);
	assert.ok(!busy.calls.some((c) => c.includes('droplet create')));
});

test('destroy removes staging but never production', async () => {
	const { calls, exec } = doctl({
		'compute firewall list': JSON.stringify([{ id: 'fw1', name: 'saha-textile-staging' }]),
	});
	await destroyServer('staging', { exec });
	assert.ok(calls.some((c) => c.includes('droplet delete saha-textile-staging --force')));
	assert.ok(calls.some((c) => c.includes('firewall delete fw1 --force')));
	await assert.rejects(destroyServer('production', { exec }), ServerError);
});
