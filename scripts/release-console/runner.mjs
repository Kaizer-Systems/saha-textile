/**
 * The Release Console's Mac helper (`pnpm console:runner`, started by `pnpm console:up`).
 *
 * The console runs in Docker and cannot see the Mac or run its tools, and it must never hold the
 * Docker socket (that equals root on the Mac). This helper listens on 127.0.0.1 only, answers only
 * requests carrying the token in docker/release-console/env/runner-token, and runs a fixed list of
 * commands: read-only Mac and Docker figures, container logs, the local stack's own commands and
 * `pnpm pipeline:local`. It runs from the main checkout only, never from a worktree.
 */
import {
	InspectError,
	commandList,
	connectionsOf,
	factsOf,
	meiliReport,
	mongoProfile,
	mongoReport,
	networks,
	patches,
	redisReport,
	restart,
	terminal,
	topOf,
} from './inspect.mjs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { toolsGh } from './gh-tools.mjs';
import { BRANCH_NAME, checkoutBranches, menusFileAt } from './git-branches.mjs';
import { repositoryOf } from './infisical-places.mjs';
import { loadInventory, ROOT, SERVER_TIERS, TIERS } from '../secrets/inventory.mjs';
import { FirstBootError, firstBootTemplate, prepareFirstBoot } from './first-boot.mjs';
import {
	SetupError,
	aopPair,
	certificateFiles,
	environmentRules,
	githubEnvironment,
	observe,
	saveObserverToken,
	knownHosts,
	originCsr,
} from './server-setup.mjs';

export const RUNNER_PORT = Number(process.env.CONSOLE_RUNNER_PORT ?? 4419);
export const TOKEN_FILE = join(ROOT, 'docker/release-console/env/runner-token');
export const STACK_PREFIX = 'saha-textile';
/** The stack's own services; its search server is left alone because `pnpm dev` uses it too. */
export const STACK_APP_SERVICES = ['edge', 'storefront', 'admin', 'api', 'worker', 'redis', 'mongo'];
export const PIPELINE_STAGES = ['checks', 'proof', 'images', 'release', 'deploy', 'record'];
/** Mode 1 and 2 servers in this checkout; while one answers, the checks stage would rebuild under it. */
export const DEV_PORTS = { api: 4000, storefront: 4200, admin: 4300 };
/**
 * An environment's place in Infisical, as the API sends it: checked again here before it becomes a
 * command-line argument, so nothing can start with a dash or hold anything but a name or a path.
 */
export function placeFrom(input) {
	const place = {
		project: String(input?.project ?? ''),
		environment: String(input?.environment ?? ''),
		folder: String(input?.folder || '/'),
	};
	const ok =
		/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(place.project) &&
		/^[a-z0-9][a-z0-9-]{0,63}$/.test(place.environment) &&
		/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(place.folder);
	return ok ? place : null;
}
const placeKey = (place) => `secrets:${place.project}|${place.environment}|`;
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
/**
 * nginx's error lines (the edge's stderr) print the full request line and referrer, which can carry
 * a sign-in or reset token (Infisical chat, 21 Nov). The console keeps only the request's path
 * without its query, and the referrer's host, before any line leaves the helper.
 */
export function maskLogLine(line) {
	return (
		line
			// A payment link's token, anywhere in an address, plain or URL-encoded (Infisical chat, 21 Nov).
			.replace(/\/pay\/[^/?&#"\s]+/gi, '/pay/{{token}}')
			.replace(/%2Fpay%2F[^&#"\s%]+/gi, '%2Fpay%2F{{token}}')
			.replace(/(request: "[A-Z]+ [^"?\s]*)\?[^"\s]*/g, '$1')
			.replace(/(upstream: "[^"?]*)\?[^"]*"/g, '$1"')
			.replace(/referrer: "([a-z][a-z0-9+.-]*:\/\/)?(?:[^@"/]*@)?([^/:"?#]*)[^"]*"/gi, 'referrer: "$2"')
	);
}

export function containerLogs(container, { tail = 300, since = '' } = {}) {
	if (!/^saha-textile[a-z0-9_.-]*$/.test(container))
		throw Object.assign(new Error('Unknown container.'), { status: 400 });
	const n = Math.min(Math.max(Number(tail) || 300, 1), 5000);
	const args = ['logs', '--timestamps', '--tail', String(n)];
	if (since && /^\d+[smh]$/.test(since)) args.push('--since', since);
	args.push(container);
	return new Promise((resolve) => {
		execFile('docker', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (_e, out, err) =>
			resolve({
				container,
				lines: `${out ?? ''}${err ?? ''}`.split('\n').filter(Boolean).slice(-n).map(maskLogLine),
			}),
		);
	});
}

/**
 * The Secrets screen's names and states for one environment's place, from Infisical with the owner's
 * login. The CLI calls block, so they run in their own process (`secret-names.mjs`); its output holds
 * names only, never values.
 */
export function secretNames(place) {
	return new Promise((resolve, reject) => {
		execFile(
			process.execPath,
			[
				join(ROOT, 'scripts/release-console/secret-names.mjs'),
				'--project',
				place.project,
				'--environment',
				place.environment,
				'--folder',
				place.folder,
			],
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

/**
 * The name list's places (each tier's Infisical project and environment) and the repository this
 * checkout belongs to, so the console can offer to fill in an environment's place in one click.
 */
export async function secretPlaces() {
	const inventory = loadInventory();
	return {
		repository: repositoryOf(await sh('git', ['-C', ROOT, 'remote', 'get-url', 'origin'])),
		places: TIERS.map((tier) => ({
			tier,
			project: inventory.projects[tier].name,
			environment: inventory.projects[tier].environment,
		})),
	};
}

/**
 * Saves one place's Secrets drafts through `secret-save.mjs` in its own process. The batch, values
 * included, goes to that process on stdin only; nothing here keeps or prints it.
 */
export function saveSecrets(body) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(ROOT, 'scripts/release-console/secret-save.mjs')], {
			cwd: ROOT,
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		let out = '';
		const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => (out += chunk));
		child.on('close', () => {
			clearTimeout(timer);
			try {
				const answer = JSON.parse(out);
				if (answer.error) reject(Object.assign(new Error(answer.error), { status: 422 }));
				else resolve(answer);
			} catch {
				reject(Object.assign(new Error('Infisical could not be written.'), { status: 502 }));
			}
		});
		child.stdin.end(JSON.stringify(body));
	});
}

/**
 * The deploy identity id of the tier an Infisical place belongs to, from the name list (not a
 * secret; the Infisical chat, 23 Nov). The create job sets it as INFISICAL_IDENTITY_ID (Release Path
 * brief C5); a tier without one answers null.
 */
export function deployIdentityOf(place, inventory = loadInventory()) {
	const tier = TIERS.find(
		(t) =>
			inventory.projects[t]?.name === place?.project && inventory.projects[t]?.environment === place?.environment,
	);
	const id = tier ? inventory.projects[tier].deployIdentityId : null;
	return { tier: tier ?? null, identityId: typeof id === 'string' && id ? id : null };
}

/** The rotate script's value ids (Release Path brief, Part 3; the Infisical chat's `pnpm secrets:rotate`). */
export const ROTATE_IDS = [
	'mongo-app',
	'redis',
	'mongo-root',
	'mongo-monitor',
	'search',
	'keyfile',
	'sign-in',
	'csrf',
	'mailbox',
];

/**
 * The arguments for `pnpm secrets:rotate` from the console's request: a server tier, then either the
 * ids to change (with `--no-grace` after a leak) or `--clear-previous` alone. Anything else is refused.
 */
export function rotateArgs(body) {
	const tier = SERVER_TIERS.includes(body?.tier) ? body.tier : null;
	if (!tier) throw Object.assign(new Error('Rotation is for a server environment.'), { status: 400 });
	const args = ['--silent', 'secrets:rotate', '--', tier];
	if (body.clearPrevious === true) args.push('--clear-previous');
	else {
		const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((i) => ROTATE_IDS.includes(i)))] : [];
		if (!ids.length) throw Object.assign(new Error('Pick at least one value to change.'), { status: 400 });
		args.push('--names', ids.join(','));
		if (body.grace === false) args.push('--no-grace');
	}
	args.push('--json');
	return args;
}

/**
 * Makes new values and writes them into Infisical through the Infisical chat's script, on this Mac
 * with the owner's Infisical sign-in. The script prints names only; its last JSON line is the answer.
 */
export function rotateSecrets(body, run = spawn) {
	return new Promise((resolve, reject) => {
		let args;
		try {
			args = rotateArgs(body);
		} catch (err) {
			reject(err);
			return;
		}
		const child = run('pnpm', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		const timer = setTimeout(() => child.kill('SIGTERM'), 300_000);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => (out += chunk));
		child.stderr.on('data', (chunk) => (err += chunk));
		child.on('error', () => {
			clearTimeout(timer);
			reject(Object.assign(new Error('pnpm could not be started on this Mac.'), { status: 502 }));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			const last = out
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => l.startsWith('{'))
				.pop();
			try {
				if (code === 0 && last) return resolve(JSON.parse(last));
			} catch {
				/* falls through to the error below */
			}
			const said = err
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean)
				.pop();
			reject(Object.assign(new Error(said || 'The rotate script did not finish.'), { status: 422 }));
		});
	});
}

/** Drops kept readings whose key starts with `prefix`, so the next read is fresh. */
export function forget(prefix) {
	for (const key of recent.keys()) if (key.startsWith(prefix)) recent.delete(key);
}

/** Which mode 1/2 servers answer on this Mac. */
export async function devServers() {
	const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
	return Object.fromEntries(
		Object.entries(DEV_PORTS).map(([name, port]) => [name, new RegExp(`:${port} \\(LISTEN\\)`).test(out)]),
	);
}

/**
 * Reads this computer's stack API's operations address (`/ops/jobs` or `/ops/messages`) with the key
 * the console API hands over for this one call (brief 26gq3NbcbBESea6abRtsa3, Q1 A). Local only, so the
 * stack's own certificate is accepted; the key is never logged or kept.
 */
export async function localOps(body, root = ROOT) {
	const kind = String(body.kind ?? '');
	const token = String(body.token ?? '');
	const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 168);
	if (kind !== 'jobs' && kind !== 'messages')
		throw Object.assign(new Error('Unknown operations read.'), { status: 400 });
	if (!/^[a-f0-9]{64}$/.test(token)) throw Object.assign(new Error('No operations key.'), { status: 400 });
	const file = join(root, 'docker/stack/env/stack.env');
	const port = /STACK_HTTPS_PORT=(\d+)/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '')?.[1] ?? '443';
	const url = `https://api-local.saha-textile.localhost:${port}/ops/${kind}${kind === 'messages' ? `?hours=${hours}` : ''}`;
	return new Promise((resolve, reject) => {
		const req = httpsRequest(
			url,
			{ rejectUnauthorized: false, timeout: 8000, headers: { authorization: `Bearer ${token}` } },
			(res) => {
				let text = '';
				res.on('data', (d) => (text += d));
				res.on('end', () => {
					if (res.statusCode !== 200)
						return reject(
							Object.assign(new Error(`The stack's API answered ${res.statusCode} to /ops/${kind}.`), {
								status: 502,
							}),
						);
					try {
						resolve(JSON.parse(text));
					} catch {
						reject(Object.assign(new Error('The stack’s API did not answer JSON.'), { status: 502 }));
					}
				});
			},
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', () => reject(Object.assign(new Error('The stack’s API is not answering.'), { status: 502 })));
		req.end();
	});
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
		// Only the GitHub Connect job takes answers (yes or no to an update), on standard input.
		stdio: [kind === 'github' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
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

/** Whether a read-only tool exits 0, without waiting on its output. */
const succeeds = (cmd, args, timeout = 10_000) =>
	new Promise((resolve) => execFile(cmd, args, { timeout }, (error) => resolve(!error)));

/** The gh to run, without blocking: the machine's own on PATH, else the copy Connect fetched, else null. */
export async function ghPath() {
	if (await succeeds('gh', ['--version'], 5000)) return 'gh';
	return toolsGh();
}

/**
 * Whether the GitHub CLI where the console runs is installed and signed in, and as whom. Never the
 * token. `gh auth status` decides: `gh auth token` can still find a keychain entry for a config
 * that has no account, so it is not proof of a sign-in.
 */
export async function githubStatus() {
	const gh = await ghPath();
	if (!gh) return { installed: false, signedIn: false, account: null };
	const signedIn = await succeeds(gh, ['auth', 'status', '--hostname', 'github.com']);
	const account = signedIn ? (await sh(gh, ['api', 'user', '--jq', '.login'], 10_000)).trim() || null : null;
	return { installed: true, signedIn, account };
}

/**
 * Connect's check before any terminal opens: is gh signed in, does that sign-in still answer (an
 * expired or revoked token does not), and can it open this repository. `fullName` is GitHub's own
 * name for it, which differs after a rename or a move.
 * @param {string} repository  owner/name, checked by the caller
 */
export async function githubCheck(repository) {
	const status = await githubStatus();
	if (!status.signedIn || !status.account)
		return {
			...status,
			repository,
			fullName: null,
			reachable: false,
			message: status.installed
				? 'Not signed in, or the sign-in no longer answers.'
				: 'The GitHub CLI is not on this machine yet.',
		};
	const gh = (await ghPath()) ?? 'gh';
	const name = (await sh(gh, ['api', `repos/${repository}`, '--jq', '.full_name'], 15_000)).trim();
	return {
		...status,
		repository,
		fullName: name || null,
		reachable: name !== '',
		message: name ? '' : `${status.account} cannot open ${repository}. Ask for access, or use another account.`,
	};
}

/** The CLI sign-in's token, only when `gh auth status` says it is signed in. */
export async function githubToken() {
	const gh = await ghPath();
	if (!gh || !(await succeeds(gh, ['auth', 'status', '--hostname', 'github.com']))) return null;
	return (await sh(gh, ['auth', 'token', '--hostname', 'github.com'], 5000)).trim() || null;
}

/**
 * Connect's second way in (brief Q2 = A): a pasted token, handed to `gh auth login --with-token` on
 * standard input and never kept here; then Git is set up to use it. Answers names only.
 * @param {string} token  checked by the caller
 */
export async function githubTokenLogin(token) {
	const gh = await ghPath();
	if (!gh)
		return {
			ok: false,
			account: null,
			message: 'The GitHub CLI is not on this machine yet: press Connect once to fetch it.',
		};
	const status = await new Promise((resolve) => {
		const child = spawn(
			gh,
			['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'],
			{
				stdio: ['pipe', 'ignore', 'ignore'],
			},
		);
		const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
		child.on('error', () => resolve(1));
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve(code);
		});
		child.stdin.end(`${token}\n`);
	});
	if (status !== 0)
		return {
			ok: false,
			account: null,
			message: 'GitHub refused that token. Check that it is current and has the repo and read:org scopes.',
		};
	await succeeds(gh, ['auth', 'setup-git', '--hostname', 'github.com']);
	const account = (await sh(gh, ['api', 'user', '--jq', '.login'], 10_000)).trim() || null;
	return { ok: true, account, message: '' };
}

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
		case 'github-login': {
			// A Node script, so it runs wherever the console does: a Mac, Linux or Windows.
			const repository = String(body.repository ?? '');
			const mode = body.mode === 'another' ? 'another' : 'login';
			if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
				throw Object.assign(new Error('Give the repository as owner/name.'), { status: 400 });
			return [
				'github',
				'Connect to GitHub',
				process.execPath,
				['scripts/release-console/github-login.mjs', '--repository', repository, '--mode', mode],
			];
		}
		case 'sitemap-check': {
			// Search engines (brief 26gq3NbcbBESea6abRtsa3, screen 5): one polite crawl at a time, read only.
			const path = body.path === undefined ? '/sitemap.xml' : String(body.path);
			if (!/^\/[A-Za-z0-9._\-/]*\.xml$/.test(path))
				throw Object.assign(new Error('The sitemap path must be like /sitemap.xml.'), { status: 400 });
			const site = body.local === true ? ['--local'] : ['--origin', String(body.origin ?? '')];
			if (body.local !== true && !/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(site[1]))
				throw Object.assign(new Error('Give the site as https://host.'), { status: 400 });
			return [
				'seo',
				`Check the sitemap of ${body.local === true ? 'this computer' : site[1]}`,
				process.execPath,
				['scripts/release-console/sitemap-check.mjs', ...site, '--path', path],
			];
		}
		case 'pipeline': {
			const args = ['scripts/pipeline/local.mjs', '--json'];
			const { from, only, branch } = body;
			if (branch !== undefined && (typeof branch !== 'string' || !BRANCH_NAME.test(branch)))
				throw Object.assign(new Error('Not a branch name.'), { status: 400 });
			if (branch) args.push('--branch', branch);
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
				`Local pipeline ${only ? `(only ${only})` : from ? `(from ${from})` : '(all stages)'}${branch ? ` · ${branch}` : ''}`,
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
			if (req.method === 'POST' && path === '/secrets/save') {
				let raw = '';
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 512 * 1024) return send(413, { message: 'Too many changes at once.' });
				}
				const body = raw ? JSON.parse(raw) : {};
				raw = '';
				const place = placeFrom(body.place);
				if (!place) return send(400, { message: 'That is not a place in Infisical.' });
				try {
					return send(200, await saveSecrets({ place, changes: body.changes }));
				} finally {
					forget(placeKey(place));
				}
			}
			// Release Path brief, Part 3: new values made on this Mac and written into Infisical (names only back).
			if (req.method === 'POST' && path === '/secrets/rotate') {
				let raw = '';
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 8 * 1024) return send(413, { message: 'Too long.' });
				}
				try {
					return send(200, await rotateSecrets(raw ? JSON.parse(raw) : {}));
				} catch (err) {
					return send(err.status ?? 500, { message: err.message });
				} finally {
					forget('secrets');
				}
			}
			// A new server's first-boot file (DigitalOcean › Droplets › create): the deploy key pair is made
			// here and its private half stays on this Mac; the password and the tunnel token are used once and
			// never kept or logged. The answer goes only to the console API, which holds the helper's token.
			if (req.method === 'POST' && path === '/server/first-boot') {
				let raw = '';
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 16 * 1024) return send(413, { message: 'Too long.' });
				}
				const body = raw ? JSON.parse(raw) : {};
				raw = '';
				try {
					return send(200, await prepareFirstBoot(body));
				} catch (error) {
					if (error instanceof FirstBootError) return send(400, { message: error.message });
					throw error;
				}
			}
			// A new server's setup on this machine (owner, 21 Nov): certificate keys made here, the files
			// saved to the environment's Infisical /infrastructure, GitHub's environment set with gh, and the
			// host key read through the tunnel. Bodies are size-limited; nothing is logged.
			const setupRoutes = {
				'/server/origin-csr': (b) => originCsr(b),
				'/server/aop-pair': (b) => aopPair(b),
				'/server/certificates-save': async (b) => {
					const { files, keyFile } = await certificateFiles(b);
					const place = {
						project: String(b.place?.project ?? ''),
						environment: String(b.place?.environment ?? ''),
						folder: '/',
					};
					const saved = await saveSecrets({
						place,
						changes: Object.entries(files).map(([name, value]) => ({
							folder: 'infrastructure',
							name,
							value,
						})),
					});
					if (keyFile) rmSync(keyFile, { force: true });
					return { saved: Object.keys(files), result: saved };
				},
				'/github/environment': (b) => githubEnvironment(b),
				'/github/environment-rules': (b) => environmentRules(b),
				'/server/deploy-identity': (b) => deployIdentityOf(b),
				'/server/observer-token': (b) => saveObserverToken(b),
				'/server/observe': (b) => observe(b),
				'/server/known-hosts': (b) => knownHosts(b),
			};
			if (req.method === 'POST' && Object.hasOwn(setupRoutes, path)) {
				let raw = '';
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 64 * 1024) return send(413, { message: 'Too long.' });
				}
				const body = raw ? JSON.parse(raw) : {};
				raw = '';
				try {
					return send(200, await setupRoutes[path](body));
				} catch (error) {
					if (error instanceof SetupError || error instanceof FirstBootError)
						return send(400, { message: error.message });
					throw error;
				}
			}
			if (req.method === 'GET' && path === '/server/first-boot/template')
				return send(200, { text: firstBootTemplate() });
			if (req.method === 'GET' && path === '/github/check') {
				const repository = url.searchParams.get('repository') ?? '';
				if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
					return send(400, { message: 'Write the repository as owner/name.' });
				return send(200, await githubCheck(repository));
			}
			if (req.method === 'POST' && path === '/github/login-token') {
				let raw = '';
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 4096) return send(413, { message: 'That is too long for a token.' });
				}
				const token = String((raw ? JSON.parse(raw) : {}).token ?? '').trim();
				raw = '';
				if (!/^[A-Za-z0-9_]{20,255}$/.test(token))
					return send(400, { message: 'That does not look like a GitHub token.' });
				forget('github-status');
				return send(200, await githubTokenLogin(token));
			}
			if (req.method === 'GET' && path === '/github/status')
				return send(200, await shared('github-status', 2000, githubStatus));
			// The CLI sign-in's token, for the console API in Docker (its own container has no gh).
			// Only a caller holding the helper's token gets here; nothing logs it.
			if (req.method === 'GET' && path === '/github/token') return send(200, { token: await githubToken() });
			// Branch pickers: this checkout's branches, and the menus file at one of them (read only).
			if (req.method === 'GET' && path === '/git/branches')
				return send(
					200,
					await checkoutBranches(url.searchParams.get('repository') ?? '', undefined, {
						fetch: url.searchParams.get('fetch') === '1',
					}),
				);
			if (req.method === 'GET' && path === '/git/file')
				return send(
					200,
					await menusFileAt(url.searchParams.get('repository') ?? '', url.searchParams.get('ref') ?? ''),
				);
			if (req.method === 'GET' && path === '/secrets/places')
				return send(200, await shared('secrets-places', 600_000, secretPlaces));
			if (req.method === 'GET' && path === '/secrets') {
				const place = placeFrom({
					project: url.searchParams.get('project'),
					environment: url.searchParams.get('environment'),
					folder: url.searchParams.get('folder'),
				});
				if (!place) return send(400, { message: 'That is not a place in Infisical.' });
				const key = `${placeKey(place)}${place.folder}${url.searchParams.get('fresh') ? `:${Date.now()}` : ''}`;
				return send(200, await shared(key, 60_000, () => secretNames(place)));
			}
			if (req.method === 'POST' && path === '/ops') {
				let raw = '';
				for await (const chunk of req) raw += chunk;
				return send(200, await localOps(raw ? JSON.parse(raw) : {}));
			}
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
			if (path.startsWith('/inspect/')) {
				const q = (k) => url.searchParams.get(k) ?? '';
				const body = async () => {
					let raw = '';
					for await (const chunk of req) raw += chunk;
					return raw ? JSON.parse(raw) : {};
				};
				try {
					if (req.method === 'GET' && path === '/inspect/top') return send(200, await topOf(q('container')));
					if (req.method === 'GET' && path === '/inspect/facts')
						return send(200, await factsOf(q('container')));
					if (req.method === 'GET' && path === '/inspect/connections')
						return send(200, await connectionsOf(q('container')));
					if (req.method === 'GET' && path === '/inspect/networks')
						return send(200, await shared('networks', 5000, networks));
					if (req.method === 'GET' && path === '/inspect/mongo')
						return send(
							200,
							await shared(`mongo:${q('container')}:${q('db')}`, 5000, () =>
								mongoReport(q('container'), q('db')),
							),
						);
					if (req.method === 'POST' && path === '/inspect/mongo/profile') {
						const b = await body();
						return send(200, await mongoProfile(b.container, b.db, b.on === true));
					}
					if (req.method === 'GET' && path === '/inspect/redis')
						return send(
							200,
							await shared(`redis:${q('container')}`, 5000, () => redisReport(q('container'))),
						);
					if (req.method === 'GET' && path === '/inspect/meili')
						return send(
							200,
							await shared(`meili:${q('container')}`, 5000, () => meiliReport(q('container'))),
						);
					if (req.method === 'GET' && path === '/inspect/patches')
						return send(200, await shared('patches', 300_000, patches));
					if (req.method === 'GET' && path === '/inspect/commands') return send(200, commandList());
					if (req.method === 'POST' && path === '/inspect/restart')
						return send(200, await restart((await body()).container));
					if (req.method === 'GET' && path === '/inspect/migration-files')
						return send(
							200,
							readdirSync(join(ROOT, 'packages/adapters-db-mongo/src/migrations')).filter(
								(f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'),
							),
						);
					if (req.method === 'POST' && path === '/inspect/terminal') {
						const b = await body();
						const t = await terminal(b.container, b.command);
						return send(200, { ...t, lines: t.lines.map(maskLogLine) });
					}
				} catch (err) {
					if (err instanceof InspectError) return send(400, { message: err.message });
					throw err;
				}
				return send(404, { message: 'No such inspection.' });
			}
			if (req.method === 'GET' && path === '/jobs')
				return send(
					200,
					[...jobs.values()].map((j) => ({ ...publicJob(j), lines: [] })),
				);
			const answerMatch = /^\/jobs\/([a-z0-9-]+)\/answer$/.exec(path);
			if (answerMatch && req.method === 'POST') {
				const job = jobs.get(answerMatch[1]);
				if (!job) return send(404, { message: 'No such job.' });
				let raw = '';
				for await (const chunk of req) raw += chunk;
				const answer = (raw ? JSON.parse(raw) : {}).answer;
				if (job.kind !== 'github') return send(403, { message: 'Only the GitHub Connect job takes answers.' });
				if (answer !== 'yes' && answer !== 'no') return send(400, { message: 'Answer yes or no.' });
				if (job.status !== 'running' || !job.child?.stdin?.writable)
					return send(409, { message: 'That job is not waiting for an answer.' });
				job.child.stdin.write(answer === 'yes' ? 'y\n' : 'n\n');
				return send(200, { ...publicJob(job), lines: [] });
			}
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
