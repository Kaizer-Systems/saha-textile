#!/usr/bin/env node
/**
 * Tracing on this Mac, one press (tracing switch brief 8UmNaHHAuiGLez47McHkj8, approved 23 Nov, Q1 A):
 *
 *   node scripts/release-console/tracing.mjs on    start the trace store, give the apps its address,
 *                                                  restart the local stack's apps that run, wait for traces
 *   node scripts/release-console/tracing.mjs off   remove the address, restart those apps, stop the store
 *
 * Run by the Mac helper as the `tracing-on` and `tracing-off` actions, so each step is a line in the
 * console's Output panel. The address is this Mac's own (`apps/api/.env.overrides`), never a secret,
 * never in Infisical. Only the trace store and the stack's own containers are started or restarted:
 * an API or shop someone started in a terminal is left running and picks the address up at its next
 * start. Nothing here prints a setting's value other than the address itself.
 */
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const NAME = 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT';
/** Where the apps on this Mac send their spans: the trace store's OTLP address. */
export const ADDRESS = 'http://127.0.0.1:10428/insert/opentelemetry/v1/traces';
export const STORE_URL = process.env.CONSOLE_TRACES_URL || 'http://127.0.0.1:10428';
const STACK = ['compose', '-f', 'docker/stack/compose.yaml'];
/** The local stack's apps that send traces. */
export const STACK_APPS = ['api', 'worker', 'storefront'];
export const OVERRIDES = 'apps/api/.env.overrides';
export const API_ENV = 'apps/api/.env';

const run = promisify(execFile);

/** `text` with one `NAME=value` line set (replaced in place, or added at the end), or removed when `value` is null. */
export function setLine(text, name, value) {
	const lines = text.split('\n');
	const at = lines.findIndex((l) => l.startsWith(`${name}=`));
	if (value === null) {
		if (at < 0) return text;
		lines.splice(at, 1);
		return lines.join('\n');
	}
	if (at >= 0) {
		lines[at] = `${name}=${value}`;
		return lines.join('\n');
	}
	const body = text.replace(/\n*$/, '');
	return `${body ? `${body}\n` : ''}${name}=${value}\n`;
}

/** The address as this Mac's override file holds it, or null. */
export function addressIn(root = ROOT) {
	const file = join(root, OVERRIDES);
	if (!existsSync(file)) return null;
	const line = readFileSync(file, 'utf8')
		.split('\n')
		.find((l) => l.startsWith(`${NAME}=`));
	const value = line?.slice(NAME.length + 1).trim();
	return value || null;
}

/** When the address was last written (the override file's time), or null. */
export function addressSince(root = ROOT) {
	const file = join(root, OVERRIDES);
	return addressIn(root) && existsSync(file) ? statSync(file).mtime : null;
}

/**
 * Sets or removes the address in the override file (Q1 A) and, in place, in apps/api/.env, so an API
 * started without a pull sees it too; the next `pnpm secrets:pull` lays the override file on top and
 * gives the same line. Each file keeps its mode; a new override file is private (0600).
 */
export function writeAddress(root, on) {
	const changed = [];
	for (const rel of [OVERRIDES, API_ENV]) {
		const file = join(root, rel);
		const exists = existsSync(file);
		if (!exists && (rel === API_ENV || !on)) continue;
		const before = exists ? readFileSync(file, 'utf8') : '';
		const after = setLine(before, NAME, on ? ADDRESS : null);
		if (after === before) continue;
		writeFileSync(file, after, exists ? undefined : { mode: 0o600 });
		if (!exists) chmodSync(file, 0o600);
		changed.push(rel);
	}
	return changed;
}

/** Whether the trace store answers its search address. */
export async function storeAnswering(get = fetch) {
	const res = await get(`${STORE_URL}/select/jaeger/api/services`, { signal: AbortSignal.timeout(2500) }).catch(
		() => null,
	);
	return !!res && res.ok;
}

/** The apps' names in the store, in words. */
export const SERVICE_WORDS = {
	'saha-textile-api': 'API',
	'saha-textile-worker': 'worker',
	'saha-textile-storefront': 'shop',
};

/** Our apps with at least one trace since `since` (ms); the store's own service list covers 7 days. */
export async function sendingSince(since, get = fetch) {
	const out = [];
	for (const service of Object.keys(SERVICE_WORDS)) {
		const q = new URLSearchParams({
			service,
			start: String(Math.floor(since) * 1000),
			end: String(Date.now() * 1000),
			limit: '1',
		});
		const res = await get(`${STORE_URL}/select/jaeger/api/traces?${q}`, {
			signal: AbortSignal.timeout(5000),
		}).catch(() => null);
		const body = res?.ok ? await res.json().catch(() => null) : null;
		if (Array.isArray(body?.data) && body.data.length) out.push(service);
	}
	return out;
}

/** The process listening on a local port: when it started and whether it is the vite dev server. */
export async function portProcess(port, exec = run) {
	const { stdout: pids } = await exec('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
		timeout: 5000,
	}).catch(() => ({ stdout: '' }));
	const pid = String(pids).split('\n').find(Boolean);
	if (!pid || !/^\d+$/.test(pid)) return null;
	const { stdout } = await exec('ps', ['-o', 'lstart=,command=', '-p', pid], { timeout: 5000 }).catch(() => ({
		stdout: '',
	}));
	const text = String(stdout).trim();
	const started = new Date(text.slice(0, 24));
	return {
		startedAt: Number.isNaN(started.getTime()) ? null : started.toISOString(),
		vite: /\bvite\b/.test(text.slice(24)),
	};
}

/**
 * What the Traces screen needs to choose its state: Docker, the store, the address, the stack's apps
 * that run, and the API and shop running outside the console on 4000 and 4200.
 */
export async function tracingState(root = ROOT, deps = {}) {
	const { exec = run, get = fetch } = deps;
	const docker = await dockerRunning(exec);
	return {
		docker,
		store: await storeAnswering(get),
		address: !!addressIn(root),
		addressSince: addressSince(root)?.toISOString() ?? null,
		stack: docker ? await stackAppsRunning(root, exec) : [],
		outside: { api: await portProcess(4000, exec), storefront: await portProcess(4200, exec) },
	};
}

/** Whether Docker answers on this Mac. */
export async function dockerRunning(exec = run) {
	return exec('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 })
		.then(() => true)
		.catch(() => false);
}

/** The local stack's apps that are running now. */
export async function stackAppsRunning(root = ROOT, exec = run) {
	const { stdout } = await exec('docker', [...STACK, 'ps', '--status', 'running', '--services'], {
		cwd: root,
		timeout: 15_000,
	}).catch(() => ({ stdout: '' }));
	const up = new Set(String(stdout).split('\n').filter(Boolean));
	return STACK_APPS.filter((s) => up.has(s));
}

/**
 * The stack's own copy of the address (`http://traces:10428/…` inside Docker), written by the
 * Infisical chat's `setStackTracing` in scripts/secrets/stack.mjs. Answers false until that exists.
 */
export async function stackAddress(root, on, load = (p) => import(pathToFileURL(p).href)) {
	const mod = await load(join(root, 'scripts/secrets/stack.mjs')).catch(() => null);
	if (typeof mod?.setStackTracing !== 'function') return false;
	await mod.setStackTracing(root, on);
	return true;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A docker command's own reason, from its error output, in one line. */
const reason = (error) =>
	String(error?.stderr || error?.message || error)
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.at(-1) ?? 'no reason given';

/**
 * Turns tracing on (`on`) or off for this Mac, one line per step on `say`. Throws on a step that
 * cannot go on; what was done before it stays done, so pressing the button again finishes the rest.
 */
export async function switchTracing(on, deps = {}) {
	const {
		root = ROOT,
		exec = run,
		get = fetch,
		say = (line) => console.log(line),
		load,
		pause = wait,
		firstTraces = 60_000,
	} = deps;
	const docker = await dockerRunning(exec);
	if (on && !docker)
		throw new Error('Docker is not running on this Mac. Start Docker Desktop, then press Turn tracing on again.');

	if (!on) {
		const files = writeAddress(root, false);
		say(
			files.length
				? `Address removed from ${files.join(' and ')} · an API started in a terminal stops sending at its next start`
				: 'No address was set on this Mac',
		);
	}

	if (on) {
		if (await storeAnswering(get)) say('Trace store already running · 127.0.0.1:10428');
		else {
			await exec('docker', [...STACK, '--profile', 'tracing', 'up', '-d', 'traces'], {
				cwd: root,
				timeout: 180_000,
			}).catch((error) => {
				throw new Error(`The trace store did not start: ${reason(error)}`);
			});
			let up = false;
			for (let i = 0; i < 20 && !up; i++) {
				up = await storeAnswering(get);
				if (!up) await pause(1500);
			}
			if (!up)
				throw new Error('The trace store started but does not answer on 127.0.0.1:10428 yet. Press again.');
			say('Trace store started · 127.0.0.1:10428 · keeps 7 days, at most 2 GiB');
		}
		const files = writeAddress(root, true);
		say(
			files.length
				? `API on this Mac: address set in ${files.join(' and ')} · an API started in a terminal sends from its next start`
				: 'API on this Mac: address already set',
		);
	}

	if (docker) {
		const running = await stackAppsRunning(root, exec);
		const set = await stackAddress(root, on, load);
		if (!set)
			say(
				'Local stack: its own address waits for the Infisical chat’s pnpm stack:env change; its apps are left as they are',
			);
		else if (!running.length)
			say(`Local stack: address ${on ? 'set' : 'removed'} · not running now, so it applies at its next start`);
		else {
			say(`Local stack: address ${on ? 'set' : 'removed'} · restarting ${running.join(', ')}…`);
			await exec('docker', [...STACK, 'up', '-d', '--no-deps', '--force-recreate', ...running], {
				cwd: root,
				timeout: 240_000,
			}).catch((error) => {
				throw new Error(`The local stack's ${running.join(', ')} did not restart: ${reason(error)}`);
			});
			say(`Local stack: ${running.join(', ')} running again`);
		}
	}

	if (!on) {
		if (docker && (await storeAnswering(get))) {
			await exec('docker', [...STACK, '--profile', 'tracing', 'stop', 'traces'], {
				cwd: root,
				timeout: 120_000,
			}).catch((error) => {
				throw new Error(`The trace store did not stop: ${reason(error)}`);
			});
			say('Trace store stopped · recorded traces stay until they are 7 days old');
		} else say('Trace store was not running');
		say('Tracing is off on this Mac');
		return;
	}

	const since = Date.now() - 5000;
	const deadline = Date.now() + firstTraces;
	let seen = [];
	while (Date.now() < deadline) {
		seen = await sendingSince(since, get);
		if (seen.length === Object.keys(SERVICE_WORDS).length) break;
		await pause(3000);
	}
	const marks = Object.entries(SERVICE_WORDS).map(([s, w]) => `${w} ${seen.includes(s) ? '✓' : '—'}`);
	say(
		seen.length
			? `First traces: ${marks.join(' · ')}`
			: 'No traces yet: the apps send once they handle a request. Open a shop page, then look at Watch › Traces.',
	);
	say('Tracing is on for this Mac');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const mode = process.argv[2];
	if (mode !== 'on' && mode !== 'off') {
		console.error('Say on or off.');
		process.exit(2);
	}
	// Each line starts with its time; the console's Output panel shows it in the first column.
	const stamp = () => new Date().toTimeString().slice(0, 8);
	switchTracing(mode === 'on', { say: (line) => console.log(`${stamp()} ${line}`) }).catch((error) => {
		console.log(`${stamp()} Failed: ${error.message}`);
		process.exit(1);
	});
}
