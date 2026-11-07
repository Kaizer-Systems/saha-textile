#!/usr/bin/env node
/**
 * Nitro registers every file under the storefront's `server/middleware` and `server/routes` as a
 * request handler. A spec in there passes `pnpm test`, then breaks the production build:
 * `"default" is not exported`. Only a build shows it, so this catches it at lint time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['apps/storefront/src/server/middleware', 'apps/storefront/src/server/routes'];

function filesIn(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? filesIn(path) : [path];
	});
}

const problems = SCANNED.flatMap((dir) => filesIn(join(ROOT, dir)))
	.filter((file) => /\.[cm]?[jt]s$/.test(file))
	.filter((file) => /\.(spec|test)\.[cm]?[jt]s$/.test(file) || !/export default/.test(readFileSync(file, 'utf8')))
	.map((file) => relative(ROOT, file));

if (problems.length) {
	console.error('Nitro treats these as request handlers, but they are not:');
	for (const file of problems) console.error(`  ${file}`);
	console.error('Keep specs and helpers in apps/storefront/src/server/, outside those folders.');
	process.exit(1);
}
console.log('check-nitro-handlers: OK');
