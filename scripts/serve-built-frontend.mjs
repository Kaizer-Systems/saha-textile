#!/usr/bin/env node
/**
 * Full dist rebuild + serve for storefront / admin.
 *
 * Unlike `pnpm dev` (Vite HMR), this always runs a production `build`, then serves the
 * output. On source changes it rebuilds from scratch and restarts the serve process.
 *
 *   node scripts/serve-built-frontend.mjs --app storefront
 *   node scripts/serve-built-frontend.mjs --app admin
 *
 * Storefront: Analog + Nitro SSR → `node dist/analog/server/index.mjs` (PORT 4200).
 * Admin: client SPA only (no SSR by design) → `vite preview` of `dist/` (PORT 4300).
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const debounceMilliseconds = 500;

const ignoredPathSegments = new Set(['.angular', '.git', '.nitro', '.turbo', 'coverage', 'dist', 'node_modules']);

/** @typedef {{ filter: string; cwd: string; port: number; watch: string[]; buildArgs: string[]; serve: { command: string; args: string[]; env?: Record<string, string> }; label: string }} AppSpec */

/** @type {Record<string, AppSpec>} */
const apps = {
	storefront: {
		filter: '@saha-textile/storefront',
		cwd: 'apps/storefront',
		port: 4200,
		label: 'storefront (SSR)',
		watch: [
			'apps/storefront/src',
			'apps/storefront/public',
			'apps/storefront/index.html',
			'apps/storefront/vite.config.ts',
			'apps/storefront/package.json',
		],
		buildArgs: ['--filter', '@saha-textile/storefront', 'build'],
		serve: {
			command: process.execPath,
			args: ['dist/analog/server/index.mjs'],
			env: {
				PORT: '4200',
				HOST: 'localhost',
				NITRO_PORT: '4200',
				NITRO_HOST: 'localhost',
			},
		},
	},
	admin: {
		filter: '@saha-textile/admin',
		cwd: 'apps/admin',
		port: 4300,
		label: 'admin (SPA dist)',
		watch: [
			'apps/admin/src',
			'apps/admin/public',
			'apps/admin/index.html',
			'apps/admin/vite.config.ts',
			'apps/admin/package.json',
		],
		buildArgs: ['--filter', '@saha-textile/admin', 'build'],
		serve: {
			command: 'pnpm',
			args: ['exec', 'vite', 'preview', '--host', 'localhost', '--port', '4300', '--strictPort'],
		},
	},
};

const appName = readArgument('--app');
const app = apps[appName ?? ''];
if (!app) {
	process.stderr.write(`Usage: node scripts/serve-built-frontend.mjs --app <${Object.keys(apps).join('|')}>\n`);
	process.exitCode = 1;
	process.exit();
}

const appCwd = resolve(repositoryRoot, app.cwd);
let buildInProgress = false;
let rebuildRequested = false;
let shuttingDown = false;
let debounceTimer;
/** @type {import('node:child_process').ChildProcess | undefined} */
let serverChild;
/** @type {import('node:fs').FSWatcher[]} */
const watchers = [];
let buildSequence = 0;

function readArgument(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function log(message) {
	process.stdout.write(`[${appName}:built ${new Date().toISOString()}] ${message}\n`);
}

function isIgnoredPath(filename) {
	if (!filename) return false;
	return filename
		.split(/[\\/]/u)
		.filter(Boolean)
		.some((segment) => ignoredPathSegments.has(segment));
}

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function run(command, arguments_, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		log(`run: ${command} ${arguments_.join(' ')}`);
		const child = spawn(command, arguments_, {
			cwd: options.cwd ?? repositoryRoot,
			env: { ...process.env, ...options.env },
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(
				new Error(
					`${command} ${arguments_.join(' ')} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`,
				),
			);
		});
	});
}

function stopServer() {
	if (!serverChild || serverChild.killed) {
		serverChild = undefined;
		return Promise.resolve();
	}

	const child = serverChild;
	serverChild = undefined;
	log('stopping serve process');

	return new Promise((resolvePromise) => {
		const forceTimer = setTimeout(() => {
			if (!child.killed) {
				child.kill('SIGKILL');
			}
		}, 4_000);

		child.once('exit', () => {
			clearTimeout(forceTimer);
			resolvePromise();
		});

		if (child.pid && process.platform !== 'win32') {
			try {
				process.kill(-child.pid, 'SIGTERM');
				return;
			} catch {
				// Fall through to direct kill when the child is not in its own group.
			}
		}
		child.kill('SIGTERM');
	});
}

function startServer() {
	log(`serving ${app.label} on http://localhost:${app.port}/`);
	serverChild = spawn(app.serve.command, app.serve.args, {
		cwd: appCwd,
		env: { ...process.env, ...app.serve.env },
		stdio: 'inherit',
		shell: process.platform === 'win32',
		detached: process.platform !== 'win32',
	});
	serverChild.once('error', (error) => {
		log(`serve process error: ${error.message}`);
	});
	serverChild.once('exit', (code, signal) => {
		if (shuttingDown || serverChild !== undefined) return;
		if (signal) {
			log(`serve process exited via ${signal}`);
			return;
		}
		if (code && code !== 0) {
			log(`serve process exited with code ${code}`);
		}
	});
}

async function buildOnce() {
	const sequence = ++buildSequence;
	log(`build ${sequence}: production dist for ${app.label}`);
	await run('pnpm', app.buildArgs);

	if (appName === 'storefront') {
		const serverEntry = join(appCwd, 'dist/analog/server/index.mjs');
		if (!(await pathExists(serverEntry))) {
			throw new Error(`Storefront SSR build did not emit ${serverEntry}`);
		}
	} else {
		const indexHtml = join(appCwd, 'dist/index.html');
		if (!(await pathExists(indexHtml))) {
			throw new Error(`Admin build did not emit ${indexHtml}`);
		}
	}

	log(`build ${sequence}: ok`);
}

async function rebuild(reason) {
	if (buildInProgress) {
		rebuildRequested = true;
		log(`change queued while a build is active: ${reason}`);
		return;
	}

	buildInProgress = true;
	log(`rebuild requested: ${reason}`);
	try {
		await stopServer();
		await buildOnce();
		if (!shuttingDown) startServer();
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		log(`build failed; serve process left stopped until the next successful build\n${message}`);
	} finally {
		buildInProgress = false;
		if (rebuildRequested && !shuttingDown) {
			rebuildRequested = false;
			void rebuild('queued changes');
		}
	}
}

function scheduleRebuild(reason) {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		void rebuild(reason);
	}, debounceMilliseconds);
}

async function startWatchers() {
	for (const target of app.watch) {
		const absoluteTarget = resolve(repositoryRoot, target);
		if (!(await pathExists(absoluteTarget))) {
			log(`watch skip (missing): ${target}`);
			continue;
		}
		const targetDetails = await stat(absoluteTarget);
		const watcher = watch(absoluteTarget, { recursive: targetDetails.isDirectory() }, (eventType, filename) => {
			const normalizedFilename = filename?.toString() ?? target;
			if (isIgnoredPath(normalizedFilename)) return;
			scheduleRebuild(`${eventType}: ${join(target, normalizedFilename)}`);
		});
		watcher.on('error', (error) => {
			log(`watch error for ${target}: ${error.message}`);
		});
		watchers.push(watcher);
	}
	log(`watching ${watchers.length} path(s) for full rebuilds`);
}

async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	log(`shutting down (${signal})`);
	clearTimeout(debounceTimer);
	for (const watcher of watchers) watcher.close();
	await stopServer();
	process.exit(0);
}

process.on('SIGINT', () => {
	void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
	void shutdown('SIGTERM');
});

try {
	await buildOnce();
	startServer();
	await startWatchers();
	log('ready — edit sources to trigger a full dist rebuild + restart');
} catch (error) {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	await stopServer();
	process.exitCode = 1;
}
