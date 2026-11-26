import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ADDRESS, NAME, addressIn, setLine, switchTracing, tracingState, writeAddress } from './tracing.mjs';

/** A folder shaped like the repository, with an API settings file holding example names only. */
function repo({ env = true, overrides = null } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'tracing-'));
	mkdirSync(join(root, 'apps/api'), { recursive: true });
	if (env) writeFileSync(join(root, 'apps/api/.env'), '# written by secrets:pull\nPORT=4000\n', { mode: 0o600 });
	if (overrides !== null) writeFileSync(join(root, 'apps/api/.env.overrides'), overrides, { mode: 0o600 });
	return root;
}

/** A fake fetch: the store answers once `up()` says so; searches find spans for `sending` services. */
function store({ up = () => true, sending = [] } = {}) {
	return async (url) => {
		if (!up()) throw new Error('refused');
		const service = new URL(url).searchParams.get('service');
		const data = url.includes('/traces?') ? (sending.includes(service) ? [{ traceID: 'a' }] : []) : ['x'];
		return { ok: true, json: async () => ({ data }) };
	};
}

/** A fake execFile that records each call and answers `ps --services` with the running stack apps. */
function docker({ running = [], dockerUp = true } = {}) {
	const calls = [];
	const exec = async (cmd, args) => {
		calls.push([cmd, ...args].join(' '));
		if (args[0] === 'info' && !dockerUp) throw new Error('Cannot connect to the Docker daemon');
		if (args.includes('ps') && args.includes('--services')) return { stdout: running.join('\n') };
		return { stdout: '' };
	};
	return { exec, calls };
}

test('sets, replaces and removes one setting line, keeping every other line', () => {
	assert.equal(setLine('', NAME, 'x'), `${NAME}=x\n`);
	assert.equal(setLine('PORT=1\n', NAME, 'x'), `PORT=1\n${NAME}=x\n`);
	assert.equal(setLine(`PORT=1\n${NAME}=old\nA=2\n`, NAME, 'x'), `PORT=1\n${NAME}=x\nA=2\n`);
	assert.equal(setLine(`PORT=1\n${NAME}=old\nA=2\n`, NAME, null), 'PORT=1\nA=2\n');
	assert.equal(setLine('PORT=1\n', NAME, null), 'PORT=1\n');
});

test('writes the address into the override file (made private) and the API settings, and takes it out again', () => {
	const root = repo();
	assert.deepEqual(writeAddress(root, true), ['apps/api/.env.overrides', 'apps/api/.env']);
	assert.equal(addressIn(root), ADDRESS);
	assert.equal(statSync(join(root, 'apps/api/.env.overrides')).mode & 0o777, 0o600);
	assert.match(readFileSync(join(root, 'apps/api/.env'), 'utf8'), /^# written by secrets:pull\nPORT=4000\n/);
	assert.deepEqual(writeAddress(root, true), [], 'a second press changes nothing');
	assert.deepEqual(writeAddress(root, false), ['apps/api/.env.overrides', 'apps/api/.env']);
	assert.equal(addressIn(root), null);
	assert.equal(readFileSync(join(root, 'apps/api/.env'), 'utf8'), '# written by secrets:pull\nPORT=4000\n');
});

test('turning on starts only the store, sets the address, recreates the running stack apps and names who sends', async () => {
	const root = repo({ overrides: 'MSG91_PROVIDER=console\n' });
	let started = false;
	const { exec, calls } = docker({ running: ['api', 'storefront'] });
	const lines = [];
	let stackOn = null;
	await switchTracing(true, {
		root,
		exec: async (cmd, args, o) => {
			if (args.includes('traces') && args.includes('up')) started = true;
			return exec(cmd, args, o);
		},
		get: store({ up: () => started, sending: ['saha-textile-api', 'saha-textile-storefront'] }),
		load: async () => ({ setStackTracing: async (_r, on) => (stackOn = on) }),
		say: (l) => lines.push(l),
		pause: async () => {},
		firstTraces: 50,
	});
	assert.ok(calls.includes('docker compose -f docker/stack/compose.yaml --profile tracing up -d traces'));
	assert.ok(
		calls.includes('docker compose -f docker/stack/compose.yaml up -d --no-deps --force-recreate api storefront'),
	);
	assert.equal(stackOn, true);
	assert.equal(addressIn(root), ADDRESS);
	assert.match(readFileSync(join(root, 'apps/api/.env.overrides'), 'utf8'), /^MSG91_PROVIDER=console\n/);
	assert.equal(lines[0], 'Trace store started · 127.0.0.1:10428 · keeps 7 days, at most 2 GiB');
	assert.ok(lines.includes('Local stack: api, storefront running again'));
	assert.ok(lines.includes('First traces: API ✓ · worker — · shop ✓'));
	assert.equal(lines.at(-1), 'Tracing is on for this Mac');
});

test('turning on refuses without Docker, and leaves the stack alone until stack:env can take the address', async () => {
	const off = docker({ dockerUp: false });
	await assert.rejects(
		switchTracing(true, { root: repo(), exec: off.exec, get: store(), say: () => {} }),
		/Docker is not running on this Mac/,
	);
	const { exec, calls } = docker({ running: ['api'] });
	const lines = [];
	await switchTracing(true, {
		root: repo(),
		exec,
		get: store(),
		load: async () => ({}),
		say: (l) => lines.push(l),
		pause: async () => {},
		firstTraces: 0,
	});
	assert.equal(lines[0], 'Trace store already running · 127.0.0.1:10428');
	assert.ok(lines.some((l) => l.startsWith('Local stack: its own address waits')));
	assert.ok(!calls.some((c) => c.includes('--force-recreate')), 'no restart without the stack address');
});

test('turning off removes the address first, recreates the stack apps, then stops the store', async () => {
	const root = repo();
	writeAddress(root, true);
	const { exec, calls } = docker({ running: ['api', 'worker'] });
	const lines = [];
	await switchTracing(false, {
		root,
		exec,
		get: store(),
		load: async () => ({ setStackTracing: async () => {} }),
		say: (l) => lines.push(l),
	});
	assert.equal(addressIn(root), null);
	const recreate = calls.findIndex((c) => c.includes('--force-recreate api worker'));
	const stop = calls.findIndex((c) => c.endsWith('--profile tracing stop traces'));
	assert.ok(recreate >= 0 && stop > recreate, 'the apps lose the address before the store stops');
	assert.equal(lines.at(-1), 'Tracing is off on this Mac');
});

test('reads the state: store, address, the stack apps and what listens on 4000 and 4200', async () => {
	const root = repo();
	writeAddress(root, true);
	const exec = async (cmd, args) => {
		if (cmd === 'docker' && args.includes('--services')) return { stdout: 'worker\n' };
		if (cmd === 'lsof') return { stdout: args.some((a) => a.includes(':4200')) ? '321\n' : '' };
		if (cmd === 'ps') return { stdout: 'Mon Nov 23 17:00:00 2026     node /x/node_modules/.bin/vite' };
		return { stdout: '' };
	};
	const state = await tracingState(root, { exec, get: store() });
	assert.equal(state.docker, true);
	assert.equal(state.store, true);
	assert.equal(state.address, true);
	assert.deepEqual(state.stack, ['worker']);
	assert.equal(state.outside.api, null);
	assert.equal(state.outside.storefront?.vite, true);
});
