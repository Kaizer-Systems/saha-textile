import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	containerStats,
	memoryUsed,
	parseDf,
	parseLoad,
	parseNetstat,
	parseSwapUsed,
	parseTopCpu,
	parseVmStat,
} from './mac-stats.mjs';
import { commandFor, containerLogs, createRunner, ensureToken, placeFrom, shared, tokenMatches } from './runner.mjs';

const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    22900.
Pages active:                                 845368.
Pages inactive:                               846756.
Pages speculative:                             11840.
Pages wired down:                             416146.
Pages purgeable:                               26469.
Pages occupied by compressor:                 945148.`;

test('reads the Mac’s own tools', () => {
	assert.deepEqual(parseTopCpu('CPU usage: 19.72% user, 12.34% sys, 67.93% idle'), {
		user: 19.72,
		sys: 12.34,
		idle: 67.93,
		used: 32.07,
	});
	const vm = parseVmStat(VM);
	assert.equal(vm.wired, 416146 * 16384);
	assert.equal(memoryUsed(vm), (845368 - 26469 + 416146 + 945148) * 16384);
	assert.deepEqual(parseLoad('{ 8.68 9.62 10.49 }'), { one: 8.68, five: 9.62, fifteen: 10.49 });
	assert.equal(parseSwapUsed('total = 16384.00M  used = 1024.00M  free = 15360.00M  (encrypted)'), 1024 * 1024 ** 2);
	assert.deepEqual(parseDf('Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s1s1 1000 10 600 19% /'), {
		total: 1024000,
		free: 614400,
		used: 409600,
	});
	assert.deepEqual(
		parseNetstat(`Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 84 0 110 84 0 110 0
en0 1500 <Link#11> aa:bb:cc:dd:ee:ff 10 0 5000 8 0 3000 0
en0 1500 192.168.1 192.168.1.5 10 - 5000 8 - 3000 -
en1 1500 <Link#10> 36:54:e5:3f:57:40 0 0 0 0 0 0 0`),
		{ rx: 5000, tx: 3000 },
	);
	assert.deepEqual(
		containerStats({
			Name: 'saha-textile-mongo',
			CPUPerc: '1.25%',
			MemUsage: '312.5MiB / 15.59GiB',
			NetIO: '544MB / 406kB',
			BlockIO: '54.9MB / 545MB',
			PIDs: '12',
		}),
		{
			name: 'saha-textile-mongo',
			cpuPercent: 1.25,
			memoryBytes: 327680000,
			memoryLimitBytes: Math.round(15.59 * 1024 ** 3),
			netRxBytes: 544e6,
			netTxBytes: 406e3,
			blockReadBytes: 54.9e6,
			blockWriteBytes: 545e6,
			pids: 12,
		},
	);
});

test('starts only commands on its list, and never the checks stage under running dev servers', () => {
	assert.throws(() => commandFor('rm-rf'), /Unknown action/);
	assert.throws(() => commandFor('pipeline', { only: 'everything' }), /Unknown stage/);
	assert.throws(() => commandFor('pipeline', { from: 'proof', only: 'deploy' }), /not both/);
	const [, , cmd, args] = commandFor('pipeline', { only: 'deploy' });
	assert.equal(cmd, 'node');
	assert.deepEqual(args, ['scripts/pipeline/local.mjs', '--json', '--only', 'deploy']);
	const [, , , stop] = commandFor('stack-stop-apps');
	assert.ok(!stop.includes('meilisearch'), 'the shared search server is never stopped');
	assert.throws(() => commandFor('pipeline', {}, ['api']), /rebuilds the apps under the running dev servers \(api\)/);
	assert.throws(() => commandFor('pipeline', { only: 'checks' }, ['storefront']), /storefront/);
	assert.doesNotThrow(() => commandFor('pipeline', { from: 'proof' }, ['api', 'admin']));
});

test('shares one reading between requests that arrive together, and never keeps a failure', async () => {
	let runs = 0;
	const slow = () => new Promise((r) => setTimeout(() => r(++runs), 30));
	const [a, b] = await Promise.all([shared('test-a', 1000, slow), shared('test-a', 1000, slow)]);
	assert.equal(a, 1);
	assert.equal(b, 1);
	assert.equal(await shared('test-a', 1000, slow), 1, 'a fresh reading is reused');
	assert.equal(await shared('test-b', 0, slow), 2);
	assert.equal(await shared('test-b', 0, slow), 3, 'an old reading is taken again');
	await assert.rejects(shared('test-c', 1000, () => Promise.reject(new Error('down'))));
	assert.equal(await shared('test-c', 1000, slow), 4, 'a failed reading is not kept');
});

test('reads logs of this project’s containers only, refusing others at once', () => {
	assert.throws(() => containerLogs('postgres'), /Unknown container/);
	assert.throws(() => containerLogs('saha-textile-api; rm -rf /'), /Unknown container/);
});

test('answers only requests carrying its token', async () => {
	const file = join(mkdtempSync(join(tmpdir(), 'runner-')), 'env', 'runner-token');
	const token = ensureToken(file);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(ensureToken(file), token);
	assert.ok(tokenMatches(`Bearer ${token}`, token));
	assert.ok(!tokenMatches('Bearer nope', token));
	const server = createRunner(token).listen(0, '127.0.0.1');
	await new Promise((r) => server.once('listening', r));
	const { port } = server.address();
	const without = await fetch(`http://127.0.0.1:${port}/health`);
	assert.equal(without.status, 401);
	const withToken = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } });
	assert.equal(withToken.status, 200);
	const unknown = await fetch(`http://127.0.0.1:${port}/run/format-disk`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
	});
	assert.equal(unknown.status, 404);
	server.close();
});

test('takes an Infisical place only when every part is a plain name or path', () => {
	assert.deepEqual(placeFrom({ project: 'client-shop-dev', environment: 'qa' }), {
		project: 'client-shop-dev',
		environment: 'qa',
		folder: '/',
	});
	assert.deepEqual(placeFrom({ project: 'p', environment: 'dev', folder: '/backend/api' })?.folder, '/backend/api');
	for (const bad of [
		{ project: '-p', environment: 'dev' },
		{ project: 'p', environment: '--env' },
		{ project: 'p', environment: 'dev', folder: 'api' },
		{ project: 'p', environment: 'dev', folder: '/a;b' },
		{ project: 'p;rm', environment: 'dev' },
		null,
	])
		assert.equal(placeFrom(bad), null, JSON.stringify(bad));
});

test('the GitHub connection is the helper’s fixed script, on any operating system', () => {
	const [kind, label, cmd, args] = commandFor('github-login', {
		repository: 'Kaizer-Systems/saha-textile',
		command: 'rm -rf /',
	});
	assert.equal(kind, 'github');
	assert.equal(label, 'Connect to GitHub');
	assert.equal(cmd, process.execPath, 'Node runs it, not a shell');
	assert.deepEqual(args, [
		'scripts/release-console/github-login.mjs',
		'--repository',
		'Kaizer-Systems/saha-textile',
		'--mode',
		'login',
	]);
	assert.equal(commandFor('github-login', { repository: 'a/b', mode: 'another' })[3].at(-1), 'another');
	assert.throws(() => commandFor('github-login', { repository: 'a/b; rm -rf /' }), /owner\/name/);
});
