/**
 * `pnpm console:up` — the Release Console as one container on this Mac:
 * writes the key file from Infisical (your login), starts the Mac helper, builds and starts the
 * container on 127.0.0.1:4400, and waits until it answers. `pnpm console:down` stops both; the
 * console's database volume is kept.
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONSOLE_ENV_FILE, writeConsoleEnv } from './env.mjs';
import { RUNNER_PORT, ensureToken, isWorktree } from './runner.mjs';
import { ROOT } from '../secrets/inventory.mjs';

const COMPOSE = ['compose', '-f', 'docker/release-console/compose.yaml'];
const PORT = Number(process.env.CONSOLE_PORT ?? 4400);
const ENV_DIR = join(ROOT, 'docker/release-console/env');
const PID_FILE = join(ENV_DIR, 'runner.pid');
const LOG_FILE = join(ROOT, 'docker/release-console/runner.log');

const say = (line) => console.log(line);

async function answers(url, headers = {}) {
	try {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
		return res.ok;
	} catch {
		return false;
	}
}

function portOwner(port) {
	const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '';
	return out.split('\n')[1]?.split(/\s+/)[0] ?? null;
}

async function startHelper(token) {
	if (await answers(`http://127.0.0.1:${RUNNER_PORT}/health`, { authorization: `Bearer ${token}` })) {
		say(`Mac helper: already answering on 127.0.0.1:${RUNNER_PORT}.`);
		return;
	}
	const log = openSync(LOG_FILE, 'a');
	const child = spawn(process.execPath, [join(ROOT, 'scripts/release-console/runner.mjs')], {
		cwd: ROOT,
		detached: true,
		stdio: ['ignore', log, log],
		env: process.env,
	});
	child.unref();
	closeSync(log);
	writeFileSync(PID_FILE, String(child.pid), { mode: 0o600 });
	for (let i = 0; i < 20; i++) {
		if (await answers(`http://127.0.0.1:${RUNNER_PORT}/health`, { authorization: `Bearer ${token}` })) {
			say(`Mac helper: started on 127.0.0.1:${RUNNER_PORT} (log: docker/release-console/runner.log).`);
			return;
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error('The Mac helper did not start; see docker/release-console/runner.log.');
}

export async function up() {
	if (isWorktree() && process.env.CONSOLE_RUNNER_ALLOW_WORKTREE !== '1')
		throw new Error(
			'Run pnpm console:up from the main folder, not a worktree: the Mac helper drives the stack in its own checkout.',
		);
	mkdirSync(ENV_DIR, { recursive: true, mode: 0o700 });
	const keys = writeConsoleEnv();
	for (const line of keys.lines) say(line);
	if (!existsSync(join(ROOT, CONSOLE_ENV_FILE))) {
		writeFileSync(join(ROOT, CONSOLE_ENV_FILE), '# No keys yet: vendor screens say Not connected.\n', {
			mode: 0o600,
		});
		say('Started with no keys; DigitalOcean, Cloudflare and GitHub screens will say Not connected.');
	}
	const token = ensureToken();
	await startHelper(token);
	const running = spawnSync(
		'docker',
		['ps', '--filter', 'name=^saha-textile-release-console$', '--format', '{{.Names}}'],
		{ encoding: 'utf8' },
	).stdout.trim();
	const owner = portOwner(PORT);
	if (owner && !running)
		throw new Error(`Port ${PORT} is in use (${owner}): stop pnpm console first, or set CONSOLE_PORT.`);
	say('Building and starting the console container…');
	const r = spawnSync('docker', [...COMPOSE, 'up', '-d', '--build', '--wait'], {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, CONSOLE_PORT: String(PORT) },
	});
	if (r.status !== 0) throw new Error('docker compose could not start the console; its output is above.');
	for (let i = 0; i < 60; i++) {
		if (await answers(`http://127.0.0.1:${PORT}/api/health`)) {
			say(`Release Console: http://localhost:${PORT}`);
			return;
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error('The console container started but does not answer; see pnpm console:logs.');
}

/** The helper's process: from its pid file, or the process listening on its port if that is this checkout's runner. */
function helperPid() {
	const fromFile = existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, 'utf8')) : 0;
	const listening = Number(
		(spawnSync('lsof', ['-nP', '-t', `-iTCP:${RUNNER_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '')
			.trim()
			.split('\n')[0],
	);
	for (const pid of [fromFile, listening]) {
		if (!pid) continue;
		const cmd = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '';
		if (cmd.includes(join(ROOT, 'scripts/release-console/runner.mjs'))) return pid;
	}
	return 0;
}

export function down() {
	spawnSync('docker', [...COMPOSE, 'down'], { cwd: ROOT, stdio: 'inherit' });
	const pid = helperPid();
	if (pid) {
		try {
			process.kill(pid, 'SIGTERM');
			say('Mac helper: stopped.');
		} catch (error) {
			say(`Mac helper: could not be stopped (${error.code}); stop process ${pid} by hand.`);
		}
	} else say('Mac helper: was not running.');
	rmSync(PID_FILE, { force: true });
	say('Release Console stopped; its database volume is kept.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const action = process.argv[2] ?? 'up';
	try {
		if (action === 'down') down();
		else await up();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
