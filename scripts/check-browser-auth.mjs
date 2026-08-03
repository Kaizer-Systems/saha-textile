#!/usr/bin/env node
/**
 * Browser authentication policy guard.
 *
 * The locked model is API-set `httpOnly` cookie sessions: the browser holds no credential,
 * so there is nothing for the client to store, read or forward. Both Angular applications
 * previously violated that — the storefront seeded a hard-coded `FAKE_ACCESS_TOKEN`, and
 * the admin persisted one to `localStorage` — and both forwarded it as a bearer header.
 *
 * This runs in `pnpm lint` alongside the naming-law guard because it protects the same kind
 * of rule: one that must hold mechanically for every tool, agent and copied snippet, not
 * because a reviewer remembered it. A unit test could not host it — the checks need Node's
 * filesystem APIs, and neither browser application has (or should have) Node types.
 *
 * Each rule below names the failure it prevents. Add `browser-auth:allow` to a line to
 * exempt it deliberately; the marker is greppable, so exemptions stay visible.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const ALLOW_MARKER = 'browser-auth:allow';

const APPS = [
	{ name: 'storefront', root: 'apps/storefront/src/app', foreignAudience: '/auth/admin' },
	{ name: 'admin', root: 'apps/admin/src/app', foreignAudience: '/auth/storefront' },
];

/** Every `.ts`/`.html` file under a directory, recursively. */
function sourceFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
		else if (path.endsWith('.ts') || path.endsWith('.html')) found.push(path);
	}
	return found;
}

/**
 * Blanks out comment bodies while preserving line numbers and count.
 *
 * Without this the guard flags its own documentation: the auth store's header comment
 * explains that a `FAKE_ACCESS_TOKEN` used to live there, and the interceptor's explains
 * that the `Authorization: Bearer` branch was removed. Those sentences are the reason the
 * rules are understandable, and a checker that forbids describing the rule it enforces is
 * a checker people delete.
 */
function stripComments(text) {
	const blankExceptNewlines = (match) => match.replace(/[^\n]/g, ' ');
	return text
		.replace(/\/\*[\s\S]*?\*\//g, blankExceptNewlines)
		.replace(/<!--[\s\S]*?-->/g, blankExceptNewlines)
		.replace(/(^|[^:])\/\/.*$/gm, (_match, prefix) => prefix);
}

/** Lines matching `pattern`, minus comments and any line carrying the opt-out marker. */
function offendingLines(text, pattern) {
	const original = text.split('\n');
	return stripComments(text)
		.split('\n')
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line, number }) => pattern.test(line) && !original[number - 1].includes(ALLOW_MARKER))
		.map(({ number }) => ({ line: original[number - 1], number }));
}

const RULES = [
	{
		id: 'no-fake-token',
		why: 'a demo or fake session token teaches the wrong shape and can survive into a build',
		pattern: /laravel_sanctum|FAKE_ACCESS_TOKEN|FAKE_TOKEN/,
		applies: () => true,
	},
	{
		id: 'no-bearer-header',
		why: 'the browser holds no credential to forward; the session is an httpOnly cookie',
		pattern: /Authorization\s*:\s*[`'"]?Bearer/,
		applies: () => true,
	},
	{
		id: 'no-session-in-browser-storage',
		why: 'anything auth-shaped in localStorage/sessionStorage/IndexedDB is readable by any script on the page',
		pattern: /localStorage|sessionStorage|indexedDB/,
		// Scoped to the auth boundary: cart, locale and currency preferences may persist.
		applies: (path) => /core\/auth\/|core\/state\/auth\.store\.ts$/.test(path),
	},
	{
		id: 'auth-paths-live-in-one-gateway',
		why: 'one HTTP adapter entry point per audience, so a contract change is edited once',
		pattern: /['"`]\/auth\/(storefront|admin|csrf)/,
		applies: (path) => !path.endsWith('core/auth/http-auth.gateway.ts'),
	},
];

let failures = 0;
for (const app of APPS) {
	const root = resolve(repositoryRoot, app.root);
	const files = sourceFiles(root);
	if (files.length < 20) {
		console.error(`check-browser-auth: only ${files.length} files found under ${app.root} — wrong path?`);
		failures += 1;
		continue;
	}

	const rules = [
		...RULES,
		{
			id: 'no-cross-audience-route',
			why: `${app.name} code must not be able to reach a ${app.foreignAudience} credential path`,
			pattern: new RegExp(app.foreignAudience.replace('/', '\\/')),
			applies: () => true,
		},
	];

	for (const file of files) {
		const relativePath = relative(repositoryRoot, file).split(sep).join('/');
		const text = readFileSync(file, 'utf8');
		for (const rule of rules) {
			if (!rule.applies(relativePath)) continue;
			for (const hit of offendingLines(text, rule.pattern)) {
				console.error(`check-browser-auth: [${rule.id}] ${relativePath}:${hit.number} — ${rule.why}`);
				console.error(`  ${hit.line.trim()}`);
				failures += 1;
			}
		}
	}
}

if (failures > 0) {
	console.error(`\ncheck-browser-auth: ${failures} violation(s). See docs/backend/security-and-identity.md.`);
	process.exit(1);
}
console.log('check-browser-auth: OK (no browser-held auth tokens, one auth gateway per audience)');
