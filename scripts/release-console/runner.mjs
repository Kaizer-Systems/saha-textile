/**
 * The Release Console's Mac helper (`pnpm console:runner`, started by `pnpm console:up`).
 *
 * The console runs in Docker and cannot see the Mac or run its tools, and it must never hold the
 * Docker socket (that equals root on the Mac). This helper listens on 127.0.0.1 only, answers only
 * requests carrying the token in docker/release-console/env/runner-token, and runs a fixed list of
 * commands: read-only Mac and Docker figures, container logs, the local stack's own commands and
 * `pnpm pipeline:local`. It runs from the main checkout only, never from a worktree.
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	containerStats,
	jsonLines,
	memoryUsed,
	parseDf,
	parseLoad,
	parseNetstat,
	parseSwapUsed,
	parseTopCpu,
	parseVmStat,
} from './mac-stats.mjs';
import { ROOT } from '../secrets/inventory.mjs';

export const RUNNER_PORT = Number(process.env.CONSOLE_RUNNER_PORT ?? 4419);
export const TOKEN_FILE = join(ROOT, 'docker/release-console/env/runner-token');
export const STACK_PREFIX = 'saha-textile';
/** The stack's own services; its search server is left alone because `pnpm dev` uses it too. */
export const STACK_APP_SERVICES = ['edge', 'storefront', 'admin', 'api', 'worker', 'redis', 'mongo'];
export const PIPELINE_STAGES = ['checks', 'proof', 'images', 'release', 'deploy', 'record'];
/** Mode 1 and 2 servers in this checkout; while one answers, the checks stage would rebuild under it. */
export const DEV_PORTS = { api: 4000, storefront: 4200, admin: 4300 };
const MAX_LINES = 5000;

/**
 * Runs one of the helper's read-only tools without blocking: a slow `docker stats` must never hold up
 * the next request. Answers the tool's output, or '' when it fails or takes too long.
 */
const sh = (cmd, args, timeout = 15_000) =>
	new Promise((resolve) => {
		execFile(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? '' : String(stdout)),
		);
	});

/** @type {Map<string, { at: number, value: Promise<unknown> }>} */
const recent = new Map();
/**
 * One reading shared by every request within `ttl` ms (the console's 5-second poll and an open
 * screen ask at once), and one run at a time per reading.
 */
export function shared(key, ttl, read) {
	const hit = recent.get(key);
	if (hit && Date.now() - hit.at < ttl) return hit.value;
	const value = Promise.resolve()
		.then(read)
		.finally(() => {
			const now = recent.get(key);
			if (now?.value === value) now.at = Date.now();
		});
	recent.set(key, { at: Number.POSITIVE_INFINITY, value });
	value.catch(() => recent.delete(key));
	return value;
}

/** The Mac now: CPU, memory, swap, load, start-up disk and network byte counters. */
export async function macNow() {
	const [vmText, top, memsize, swap, loadavg, df, netstat, ncpu] = await Promise.all([
		sh('vm_stat', []),
		sh('top', ['-l', '1', '-n', '0']),
		sh('sysctl', ['-n', 'hw.memsize']),
		sh('sysctl', ['-n', 'vm.swapusage']),
		sh('sysctl', ['-n', 'vm.loadavg']),
		sh('df', ['-k', '/']),
		sh('netstat', ['-ib']),
		sh('sysctl', ['-n', 'hw.ncpu']),
	]);
	const vm = parseVmStat(vmText);
	return {
		at: new Date().toISOString(),
		cpu: parseTopCpu(top),
		memory: {
			total: Number(memsize.trim()) || null,
			used: memoryUsed(vm),
			compressed: vm.compressed,
			wired: vm.wired,
		},
		swapUsed: parseSwapUsed(swap),
		load: parseLoad(loadavg),
		disk: parseDf(df),
		network: parseNetstat(netstat),
		cpus: Number(ncpu.trim()) || null,
	};
}

/** Docker on this Mac: its VM's size, this project's containers, and each one's live figures. */
export async function dockerNow() {
	const [infoText, ps, statsText] = await Promise.all([
		sh('docker', ['info', '--format', '{{json .}}']),
		sh('docker', ['ps', '-a', '--format', '{{json .}}']),
		sh('docker', ['stats', '--no-stream', '--format', '{{json .}}'], 30_000),
	]);
	const info = (() => {
		try {
			return JSON.parse(infoText || '{}');
		} catch {
			return {};
		}
	})();
	const containers = jsonLines(ps)
		.filter((c) => String(c.Names ?? '').startsWith(STACK_PREFIX))
		.map((c) => ({
			name: String(c.Names),
			image: String(c.Image),
			state: String(c.State),
			status: String(c.Status),
			ports: String(c.Ports ?? ''),
		}));
	const names = new Set(containers.map((c) => c.name));
	const stats = jsonLines(statsText)
		.map(containerStats)
		.filter((s) => names.has(s.name));
	return {
		at: new Date().toISOString(),
		reachable: Boolean(info.ServerVersion),
		version: info.ServerVersion ?? null,
		cpus: info.NCPU ?? null,
		memoryTotal: info.MemTotal ?? null,
		containers,
		stats,
	};
}

/** Container logs, newest last; only this project's containers (an unknown name throws at once). */
export function containerLogs(container, { tail = 300, since = '' } = {}) {
	if (!/^saha-textile[a-z0-9_.-]*$/.test(container))
		throw Object.assign(new Error('Unknown container.'), { status: 400 });
	const n = Math.min(Math.max(Number(tail) || 300, 1), 5000);
	const args = ['logs', '--timestamps', '--tail', String(n)];
	if (since && /^\d+[smh]$/.test(since)) args.push('--since', since);
	args.push(container);
	return new Promise((resolve) => {
		execFile('docker', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (_e, out, err) =>
			resolve({ container, lines: `${out ?? ''}${err ?? ''}`.split('\n').filter(Boolean).slice(-n) }),
		);
	});
}

/**
 * The Secrets screen's names and states, from Infisical with the owner's login. The CLI calls block,
 * so they run in their own process (`secret-names.mjs`); its output holds names only, never values.
 */
export function secretNames() {
	return new Promise((resolve, reject) => {
		execFile(
			process.execPath,
			[join(ROOT, 'scripts/release-console/secret-names.mjs')],
			{ cwd: ROOT, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
			(_error, stdout) => {
				try {
					const out = JSON.parse(String(stdout));
					if (out.error) reject(Object.assign(new Error(out.error), { status: 502 }));
					else resolve(out);
				} catch {
					reject(Object.assign(new Error('Infisical could not be read.'), { status: 502 }));
				}
			},
		);
	});
}

/** Which mode 1/2 servers answer on this Mac. */
export async function devServers() {
	const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
	return Object.fromEntries(
		Object.entries(DEV_PORTS).map(([name, port]) => [name, new RegExp(`:${port} \\(LISTEN\\)`).test(out)]),
	);
}

/** GET a local https health address that uses the mkcert certificate; answers `null` when it cannot. */
function localHealth(url) {
	return new Promise((resolve) => {
		const req = httpsRequest(url, { rejectUnauthorized: false, timeout: 4000 }, (res) => {
			let body = '';
			res.on('data', (d) => (body += d));
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, body: JSON.parse(body) });
				} catch {
					resolve({ status: res.statusCode, body: null });
				}
			});
		});
		req.on('error', () => resolve(null));
		req.on('timeout', () => req.destroy());
		req.end();
	});
}

/** The shop's readiness in mode 1 (`pnpm dev`) and mode 3 (the stack). */
export async function shopHealth() {
	const stackPort =
		/STACK_HTTPS_PORT=(\d+)/.exec(
			existsSync(join(ROOT, 'docker/stack/env/stack.env'))
				? readFileSync(join(ROOT, 'docker/stack/env/stack.env'), 'utf8')
				: '',
		)?.[1] ?? '443';
	const [dev, stack] = await Promise.all([
		localHealth('https://localhost:4000/health/ready'),
		localHealth(`https://api-local.saha-textile.localhost:${stackPort}/health/ready`),
	]);
	return { at: new Date().toISOString(), dev, stack, stackPort: Number(stackPort) };
}

/* ------------------------------------------------------------------ jobs */

/** @type {Map<string, any>} */
const jobs = new Map();
let lastId = 0;

function startJob(kind, label, cmd, args) {
	for (const j of jobs.values())
		if (j.status === 'running' && j.kind === kind)
			throw Object.assign(new Error(`A ${kind} job is already running (${j.label}).`), { status: 409 });
	const id = `${Date.now().toString(36)}-${++lastId}`;
	const job = {
		id,
		kind,
		label,
		status: 'running',
		startedAt: new Date().toISOString(),
		finishedAt: null,
		exitCode: null,
		lines: [],
		seq: 0,
	};
	jobs.set(id, job);
	const child = spawn(cmd, args, {
		cwd: ROOT,
		env: { ...process.env, FORCE_COLOR: '0' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	job.child = child;
	const take = (stream) => {
		let rest = '';
		return (chunk) => {
			const parts = (rest + chunk.toString()).split('\n');
			rest = parts.pop() ?? '';
			for (const text of parts) {
				let event = null;
				if (stream === 'out' && text.startsWith('{')) {
					try {
						event = JSON.parse(text);
					} catch {
						event = null;
					}
				}
				job.lines.push({ seq: ++job.seq, stream, text, event });
				if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
			}
		};
	};
	child.stdout.on('data', take('out'));
	child.stderr.on('data', take('err'));
	child.on('close', (code) => {
		job.status = code === 0 ? 'passed' : job.status === 'stopping' ? 'stopped' : 'failed';
		job.exitCode = code;
		job.finishedAt = new Date().toISOString();
		delete job.child;
		const done = [...jobs.values()].filter((j) => j.status !== 'running');
		for (const old of done.slice(0, Math.max(0, done.length - 20))) jobs.delete(old.id);
	});
	return job;
}

const publicJob = (j, after = 0) => ({
	id: j.id,
	kind: j.kind,
	label: j.label,
	status: j.status,
	startedAt: j.startedAt,
	finishedAt: j.finishedAt,
	exitCode: j.exitCode,
	lines: j.lines.filter((l) => l.seq > after),
});

/**
 * The commands the console may start; anything else is refused. `busy` names the dev servers that
 * answer now (from `devServers()`), which keep the checks stage from running under them.
 */
export function commandFor(action, body = {}, busy = []) {
	switch (action) {
		case 'stack-env':
			return ['stack', 'Write the stack’s files from Infisical', 'bash', ['scripts/stack.sh', 'env']];
		case 'stack-up':
			return ['stack', 'Start the local stack', 'bash', ['scripts/stack.sh', 'up']];
		case 'stack-stop-apps':
			return [
				'stack',
				'Stop the stack’s own services',
				'docker',
				['compose', '-f', 'docker/stack/compose.yaml', 'stop', ...STACK_APP_SERVICES],
			];
		case 'stack-start-apps':
			return [
				'stack',
				'Start the stack’s own services',
				'docker',
				['compose', '-f', 'docker/stack/compose.yaml', 'start', ...STACK_APP_SERVICES],
			];
		case 'pipeline': {
			const args = ['scripts/pipeline/local.mjs', '--json'];
			const { from, only } = body;
			if (from && only) throw Object.assign(new Error('Choose “from” or “only”, not both.'), { status: 400 });
			for (const s of [from, only])
				if (s && !PIPELINE_STAGES.includes(s))
					throw Object.assign(new Error('Unknown stage.'), { status: 400 });
			if (from) args.push('--from', from);
			if (only) args.push('--only', only);
			const runsChecks = only ? only === 'checks' : !from || from === 'checks';
			if (runsChecks && busy.length)
				throw Object.assign(
					new Error(
						`The checks stage rebuilds the apps under the running dev servers (${busy.join(', ')}). Stop them, or start from the proof stage.`,
					),
					{ status: 409 },
				);
			return [
				'pipeline',
				`Local pipeline ${only ? `(only ${only})` : from ? `(from ${from})` : '(all stages)'}`,
				'node',
				args,
			];
		}
		default:
			throw Object.assign(new Error('Unknown action.'), { status: 404 });
	}
}

/* ------------------------------------------------------------------ server */

export function ensureToken(file = TOKEN_FILE) {
	if (!existsSync(file)) {
		mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
		writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
	}
	return readFileSync(file, 'utf8').trim();
}

export function tokenMatches(header, token) {
	const given = Buffer.from(String(header ?? '').replace(/^Bearer /, ''));
	const want = Buffer.from(token);
	return given.length === want.length && timingSafeEqual(given, want);
}

/** True when this checkout is a git worktree rather than the main folder. */
export function isWorktree(root = ROOT) {
	const dir = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim();
	const common = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim();
	return Boolean(dir) && dir !== common;
}

export function createRunner(token) {
	return createServer(async (req, res) => {
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			res.end(JSON.stringify(body));
		};
		try {
			if (!tokenMatches(req.headers.authorization, token)) return send(401, { message: 'Not allowed.' });
			const url = new URL(req.url ?? '/', 'http://runner');
			const path = url.pathname;
			if (req.method === 'GET' && path === '/health') return send(200, { ok: true, root: ROOT });
			if (req.method === 'GET' && path === '/mac') return send(200, await shared('mac', 2000, macNow));
			if (req.method === 'GET' && path === '/docker') return send(200, await shared('docker', 2000, dockerNow));
			if (req.method === 'GET' && path === '/dev-servers') return send(200, await devServers());
			if (req.method === 'GET' && path === '/secrets')
				return send(
					200,
					await shared(`secrets${url.searchParams.get('fresh') ? Date.now() : ''}`, 60_000, secretNames),
				);
			if (req.method === 'GET' && path === '/shop-health')
				return send(200, await shared('shop-health', 2000, shopHealth));
			if (req.method === 'GET' && path === '/logs')
				return send(
					200,
					await containerLogs(url.searchParams.get('container') ?? '', {
						tail: url.searchParams.get('tail'),
						since: url.searchParams.get('since') ?? '',
					}),
				);
			if (req.method === 'GET' && path === '/jobs')
				return send(
					200,
					[...jobs.values()].map((j) => ({ ...publicJob(j), lines: [] })),
				);
			const jobMatch = /^\/jobs\/([a-z0-9-]+)(\/stop)?$/.exec(path);
			if (jobMatch) {
				const job = jobs.get(jobMatch[1]);
				if (!job) return send(404, { message: 'No such job.' });
				if (req.method === 'GET' && !jobMatch[2])
					return send(200, publicJob(job, Number(url.searchParams.get('after') ?? 0)));
				if (req.method === 'POST' && jobMatch[2]) {
					if (job.status === 'running' && job.child) {
						job.status = 'stopping';
						job.child.kill('SIGTERM');
					}
					return send(200, { ...publicJob(job), lines: [] });
				}
			}
			const action = /^\/run\/([a-z-]+)$/.exec(path)?.[1];
			if (req.method === 'POST' && action) {
				let raw = '';
				for await (const chunk of req) raw += chunk;
				const body = raw ? JSON.parse(raw) : {};
				const busy =
					action === 'pipeline'
						? Object.entries(await devServers())
								.filter(([, up]) => up)
								.map(([n]) => n)
						: [];
				const [kind, label, cmd, args] = commandFor(action, body, busy);
				return send(202, { ...publicJob(startJob(kind, label, cmd, args)), lines: [] });
			}
			return send(404, { message: 'Unknown request.' });
		} catch (error) {
			return send(error.status ?? 500, { message: error.status ? error.message : 'The helper failed.' });
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (isWorktree() && process.env.CONSOLE_RUNNER_ALLOW_WORKTREE !== '1') {
		console.error('The Release Console helper runs from the main folder only, never from a worktree.');
		process.exit(1);
	}
	const token = ensureToken();
	const server = createRunner(token);
	server.listen(RUNNER_PORT, '127.0.0.1', () =>
		console.log(`Release Console helper on 127.0.0.1:${RUNNER_PORT} for ${ROOT}`),
	);
	const stop = () => {
		for (const j of jobs.values()) j.child?.kill('SIGTERM');
		server.close(() => process.exit(0));
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
