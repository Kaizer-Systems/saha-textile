import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'node:fs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPort = 3457;
const host = readArgument('--host') ?? '127.0.0.1';
const port = parsePort(readArgument('--port') ?? process.env.PORTAL_PORT ?? String(defaultPort));
const debounceMilliseconds = 450;

const portalPackage = '@saha-textile/developer-portal';
const storybookPackage = '@saha-textile/developer-portal-storybook';
const typedocPackage = '@saha-textile/developer-portal-typedoc';
const scalarPackage = '@saha-textile/developer-portal-scalar';
const apiPackage = '@saha-textile/api';
const temporaryBuildRoot = join(tmpdir(), 'saha-textile-developer-portal-');
const mountedChildRoots = new Set(['storybook', 'typedoc', 'api/reference', 'database/catalogue']);

const watchTargets = [
	'apps/developer-portal',
	'apps/developer-portal-storybook',
	'apps/developer-portal-typedoc',
	'apps/developer-portal-scalar',
	'apps/storefront/src/app',
	'apps/storefront/src/scss',
	'apps/admin/src/app',
	'apps/admin/public/assets/scss',
	'apps/api/src',
	'packages/contracts/src',
	'packages/core-domain/src',
	'packages/adapters-db-mongo/src',
	'packages/adapters-db-mongo/catalogue',
	'packages/adapters-db-mongo/scripts',
	'docs',
];

const ignoredPathSegments = new Set([
	'.angular',
	'.docusaurus',
	'.generated',
	'.git',
	'.turbo',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'storybook-static',
]);

const mimeTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.gif', 'image/gif'],
	['.html', 'text/html; charset=utf-8'],
	['.ico', 'image/x-icon'],
	['.jpeg', 'image/jpeg'],
	['.jpg', 'image/jpeg'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.map', 'application/json; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.png', 'image/png'],
	['.svg', 'image/svg+xml'],
	['.txt', 'text/plain; charset=utf-8'],
	['.webmanifest', 'application/manifest+json; charset=utf-8'],
	['.woff', 'font/woff'],
	['.woff2', 'font/woff2'],
]);

let activeSiteDirectory;
let activeBuildDirectory;
let buildInProgress = false;
let rebuildRequested = false;
let debounceTimer;
let shuttingDown = false;
let activeChild;
let buildSequence = 0;
const eventClients = new Set();
const watchers = [];

function readArgument(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePort(value) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
		throw new Error(`Invalid portal port: ${value}`);
	}
	return parsed;
}

function log(message) {
	const timestamp = new Date().toISOString();
	process.stdout.write(`[portal:persistent ${timestamp}] ${message}\n`);
}

function isIgnoredPath(filename) {
	if (!filename) {
		return false;
	}
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
		});
		activeChild = child;
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (activeChild === child) {
				activeChild = undefined;
			}
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

async function verifyGeneratedSurface(label, directory) {
	const indexPath = join(directory, 'index.html');
	if (!(await pathExists(indexPath))) {
		throw new Error(`${label} did not generate ${indexPath}`);
	}
	const details = await stat(indexPath);
	if (!details.isFile() || details.size === 0) {
		throw new Error(`${label} generated an empty index page`);
	}
}

async function buildCandidate() {
	const sequence = ++buildSequence;
	const candidateRoot = await mkdtemp(temporaryBuildRoot);
	const siteDirectory = join(candidateRoot, 'site');
	const storybookDirectory = join(candidateRoot, 'storybook');
	const typedocDirectory = join(candidateRoot, 'typedoc');
	const scalarDirectory = join(candidateRoot, 'scalar');
	const mongodbCatalogueDirectory = join(candidateRoot, 'mongodb-catalogue');
	const openApiPath = join(candidateRoot, 'openapi.json');

	try {
		log(`build ${sequence}: validating sources`);
		await run(process.execPath, ['scripts/validate-developer-portal.mjs']);

		log(`build ${sequence}: composing shared TypeDoc theme`);
		await run(process.execPath, ['apps/developer-portal-typedoc/scripts/compose-theme.mjs']);

		log(`build ${sequence}: composing isolated application styles for Storybook`);
		await run(process.execPath, ['apps/developer-portal-storybook/scripts/compose-application-styles.mjs']);

		log(`build ${sequence}: building the Angular Storybook child`);
		await run(
			'corepack',
			[
				'pnpm',
				'--filter',
				storybookPackage,
				'exec',
				'ng',
				'run',
				'developer-portal-storybook:build-storybook',
				'--output-dir',
				storybookDirectory,
			],
			{
				env: {
					STORYBOOK_DISABLE_TELEMETRY: '1',
				},
			},
		);

		log(`build ${sequence}: building the TypeDoc child`);
		await run('corepack', [
			'pnpm',
			'--filter',
			typedocPackage,
			'exec',
			'typedoc',
			'--options',
			'typedoc.json',
			'--out',
			typedocDirectory,
		]);

		log(`build ${sequence}: generating the source-only OpenAPI artifact`);
		await run('corepack', ['pnpm', '--filter', apiPackage, 'exec', 'nest', 'build']);
		await run(process.execPath, [
			'apps/api/dist/generate-openapi.js',
			'--output',
			openApiPath,
			'--server',
			'http://127.0.0.1:4000',
		]);

		log(`build ${sequence}: building the Scalar child with Test Request available`);
		await run('corepack', [
			'pnpm',
			'--filter',
			scalarPackage,
			'exec',
			'vite',
			'build',
			'--outDir',
			scalarDirectory,
		]);

		log(`build ${sequence}: generating the source-only MongoDB catalogue`);
		await run(
			process.execPath,
			['--import', 'tsx', 'scripts/generate-catalogue.ts', '--output', mongodbCatalogueDirectory],
			{
				cwd: join(repositoryRoot, 'packages/adapters-db-mongo'),
			},
		);

		log(`build ${sequence}: building Docusaurus`);
		await run('corepack', [
			'pnpm',
			'--filter',
			portalPackage,
			'exec',
			'docusaurus',
			'build',
			'--out-dir',
			siteDirectory,
		]);

		await Promise.all([
			verifyGeneratedSurface('Docusaurus', siteDirectory),
			verifyGeneratedSurface('Storybook', storybookDirectory),
			verifyGeneratedSurface('TypeDoc', typedocDirectory),
			verifyGeneratedSurface('Scalar', scalarDirectory),
			verifyGeneratedSurface('MongoDB catalogue', mongodbCatalogueDirectory),
		]);

		await Promise.all([
			cp(storybookDirectory, join(siteDirectory, 'storybook'), { recursive: true }),
			cp(typedocDirectory, join(siteDirectory, 'typedoc'), { recursive: true }),
			cp(scalarDirectory, join(siteDirectory, 'api', 'reference'), { recursive: true }),
			cp(openApiPath, join(siteDirectory, 'api', 'openapi.json')),
			cp(mongodbCatalogueDirectory, join(siteDirectory, 'database', 'catalogue'), {
				recursive: true,
			}),
		]);

		await writeFile(
			join(siteDirectory, 'portal-build.json'),
			`${JSON.stringify(
				{
					buildSequence: sequence,
					builtAt: new Date().toISOString(),
					children: {
						docusaurus: '/',
						storybook: '/storybook/',
						typedoc: '/typedoc/',
						scalar: {
							route: '/api/reference/',
							openapi: '/api/openapi.json',
							status: 'scaffolded',
							testRequest: true,
						},
						mongodbCatalogue: {
							route: '/database/catalogue/',
							status: 'scaffolded-current-evidence',
						},
					},
				},
				null,
				2,
			)}\n`,
			'utf8',
		);

		log(`build ${sequence}: composite verification passed`);
		return { candidateRoot, sequence, siteDirectory };
	} catch (error) {
		await rm(candidateRoot, { force: true, recursive: true });
		throw error;
	}
}

function broadcastReload(sequence) {
	for (const response of eventClients) {
		response.write(`event: reload\ndata: ${JSON.stringify({ sequence })}\n\n`);
	}
}

async function promoteBuild(candidate) {
	const previousBuildDirectory = activeBuildDirectory;
	activeBuildDirectory = candidate.candidateRoot;
	activeSiteDirectory = candidate.siteDirectory;
	log(`build ${candidate.sequence}: promoted; refreshing connected portal tabs`);
	broadcastReload(candidate.sequence);

	if (previousBuildDirectory && previousBuildDirectory !== activeBuildDirectory) {
		await rm(previousBuildDirectory, { force: true, recursive: true });
	}
}

async function rebuild(reason) {
	if (buildInProgress) {
		rebuildRequested = true;
		log(`change queued while a build is active: ${reason}`);
		return;
	}

	buildInProgress = true;
	log(`rebuild requested: ${reason}`);
	let candidate;
	try {
		candidate = await buildCandidate();
		await promoteBuild(candidate);
	} catch (error) {
		if (candidate?.candidateRoot) {
			await rm(candidate.candidateRoot, { force: true, recursive: true });
		}
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		log(`build failed; keeping the last known good portal\n${message}`);
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
	for (const target of watchTargets) {
		const absoluteTarget = resolve(repositoryRoot, target);
		const targetDetails = await stat(absoluteTarget);
		const watcher = watch(absoluteTarget, { recursive: targetDetails.isDirectory() }, (eventType, filename) => {
			const normalizedFilename = filename?.toString() ?? target;
			if (isIgnoredPath(normalizedFilename)) {
				return;
			}
			scheduleRebuild(`${eventType}: ${join(target, normalizedFilename)}`);
		});
		watcher.on('error', (error) => {
			log(`watch error for ${target}: ${error.message}`);
		});
		watchers.push(watcher);
	}
	log(`watching ${watchTargets.length} declared portal input scopes`);
}

function safeRequestPath(requestUrl) {
	const url = new URL(requestUrl ?? '/', `http://${host}:${port}`);
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		return undefined;
	}
	const relativePath = decodedPath.replace(/^\/+/u, '');
	if (relativePath.split('/').includes('..')) {
		return undefined;
	}
	return relativePath;
}

async function resolveStaticFile(siteDirectory, requestPath) {
	const candidates =
		requestPath === ''
			? [join(siteDirectory, 'index.html')]
			: [
					join(siteDirectory, requestPath),
					join(siteDirectory, requestPath, 'index.html'),
					join(siteDirectory, `${requestPath}.html`),
				];

	for (const candidate of candidates) {
		const relativeCandidate = relative(siteDirectory, candidate);
		if (relativeCandidate === '..' || relativeCandidate.startsWith(`..${sep}`) || isAbsolute(relativeCandidate)) {
			continue;
		}
		try {
			const details = await stat(candidate);
			if (details.isFile()) {
				return candidate;
			}
		} catch {
			// Try the next canonical static-file shape.
		}
	}
	return undefined;
}

function injectReloadClient(html) {
	const client = `<script data-portal-persistent-reload>
(() => {
	const events = new EventSource('/__portal/events');
	events.addEventListener('reload', () => window.location.reload());
})();
</script>`;
	return html.includes('</body>') ? html.replace('</body>', `${client}</body>`) : `${html}${client}`;
}

function sendSecurityHeaders(response) {
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Referrer-Policy', 'no-referrer');
	response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

async function handleRequest(request, response) {
	sendSecurityHeaders(response);
	if (request.url?.startsWith('/__portal/events')) {
		response.writeHead(200, {
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'Content-Type': 'text/event-stream',
		});
		response.write('event: ready\ndata: {}\n\n');
		eventClients.add(response);
		request.on('close', () => eventClients.delete(response));
		return;
	}

	if (!activeSiteDirectory) {
		response.writeHead(503, {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
			'Retry-After': '2',
		});
		response.end(
			injectReloadClient(
				'<!doctype html><title>Developer portal building</title><body><h1>Developer portal build in progress</h1><p>This page will refresh after the first verified build completes.</p></body>',
			),
		);
		return;
	}

	const requestPath = safeRequestPath(request.url);
	if (requestPath === undefined) {
		response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
		response.end('Bad request');
		return;
	}

	if (mountedChildRoots.has(requestPath)) {
		const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`);
		response.writeHead(308, {
			'Cache-Control': 'no-store',
			Location: `/${requestPath}/${requestUrl.search}`,
		});
		response.end();
		return;
	}

	const filePath = await resolveStaticFile(activeSiteDirectory, requestPath);
	if (!filePath) {
		response.writeHead(404, {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/plain; charset=utf-8',
		});
		response.end('Not found');
		return;
	}

	const extension = extname(filePath).toLowerCase();
	const contentType = mimeTypes.get(extension) ?? 'application/octet-stream';
	response.setHeader('Content-Type', contentType);
	response.setHeader('Cache-Control', extension === '.html' ? 'no-cache' : 'public, max-age=0, must-revalidate');

	if (extension === '.html') {
		const html = await readFile(filePath, 'utf8');
		response.writeHead(200);
		response.end(injectReloadClient(html));
		return;
	}

	response.writeHead(200);
	createReadStream(filePath).pipe(response);
}

async function shutdown(signal) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	log(`received ${signal}; shutting down`);
	clearTimeout(debounceTimer);
	for (const watcher of watchers) {
		watcher.close();
	}
	for (const response of eventClients) {
		response.end();
	}
	activeChild?.kill('SIGTERM');
	await new Promise((resolvePromise) => server.close(resolvePromise));
	if (activeBuildDirectory) {
		await rm(activeBuildDirectory, { force: true, recursive: true });
	}
}

const server = createServer((request, response) => {
	void handleRequest(request, response).catch((error) => {
		log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
		if (!response.headersSent) {
			response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
		}
		response.end('Internal server error');
	});
});

server.on('error', (error) => {
	log(`server failed: ${error.message}`);
	process.exitCode = 1;
});

server.listen(port, host, () => {
	log(`server listening at http://${host}:${port}`);
	void startWatchers()
		.then(() => rebuild('initial composite build'))
		.catch((error) => {
			log(`watch setup failed: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = 1;
			server.close();
		});
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
