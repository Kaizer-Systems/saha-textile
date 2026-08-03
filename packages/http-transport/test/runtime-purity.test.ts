import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Executable proof that this package is dependency-free in its COMPILED output.
 *
 * The claim that makes a shared transport primitive safe to bundle into two Angular apps is
 * that importing it drags nothing else in — no Zod through contracts, no Angular, no RxJS,
 * no Node builtins that a browser bundler would have to polyfill or shim under SSR. Type
 * imports (`@saha-textile/contracts` in `test/contract-alignment.test.ts`) are erased, but
 * that erasure is a property of how they are written: converting one `import type` into a
 * value import quietly turns it into a real runtime edge. Lint would catch today's spelling
 * of that mistake; this catches the consequence.
 *
 * Modeled on `packages/core-domain/test/runtime-purity.test.ts`, with one difference: core is
 * allowed `node:*` builtins, and this package is not. It runs in a browser.
 */

/**
 * Vitest runs with the package directory as cwd. The path is resolved and then VERIFIED —
 * a test that silently compiled the wrong package would report a purity it never checked.
 */
const packageRoot = resolve(process.cwd());
const packageName = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name?: string }).name;
if (packageName !== '@saha-textile/http-transport') {
	throw new Error(`runtime-purity must run from the http-transport package; cwd resolved to "${packageName}"`);
}

const outDir = mkdtempSync(join(tmpdir(), 'saha-textile-transport-purity-'));

/** Specifiers whose presence in emitted JS would break the package's stated guarantees. */
const FORBIDDEN_RUNTIME_SPECIFIERS = ['@saha-textile/contracts', 'zod', '@angular/', 'rxjs', '@nestjs/', '@analogjs/'];

/**
 * Removes comments before scanning, matching the convention `scripts/check-browser-auth.mjs`
 * established: a checker that forbids DOCUMENTING the rule it enforces is a checker someone
 * eventually deletes. The emitted JS keeps the source doc comments, several of which name
 * `@saha-textile/contracts` and `document.cookie` precisely to explain why they are absent
 * from the code.
 *
 * Quote-aware so a `//` or `*` inside a string literal is not mistaken for a comment; a
 * regex literal is left alone because a `/` opening one is never followed by `/` or `*` in
 * this package's output.
 */
function stripComments(source: string): string {
	let out = '';
	let quote: string | null = null;
	let index = 0;

	while (index < source.length) {
		const char = source[index] as string;
		const next = source[index + 1];

		if (quote) {
			out += char;
			if (char === '\\') {
				out += source[index + 1] ?? '';
				index += 2;
				continue;
			}
			if (char === quote) quote = null;
			index += 1;
			continue;
		}

		if (char === "'" || char === '"' || char === '`') {
			quote = char;
			out += char;
			index += 1;
			continue;
		}

		if (char === '/' && next === '/') {
			while (index < source.length && source[index] !== '\n') index += 1;
			continue;
		}

		if (char === '/' && next === '*') {
			index += 2;
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
			index += 2;
			continue;
		}

		out += char;
		index += 1;
	}

	return out;
}

const collectJsFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		return statSync(full).isDirectory() ? collectJsFiles(full) : full.endsWith('.js') ? [full] : [];
	});

const tsc = join(packageRoot, 'node_modules', '.bin', 'tsc');
execFileSync(tsc, ['-p', join(packageRoot, 'tsconfig.json'), '--outDir', outDir], {
	cwd: packageRoot,
	stdio: 'pipe',
});

const emitted = collectJsFiles(outDir).map((file) => ({
	file: file.slice(outDir.length + 1),
	source: stripComments(readFileSync(file, 'utf8')),
}));

afterAll(() => {
	rmSync(outDir, { recursive: true, force: true });
});

describe('http-transport runtime purity', () => {
	it('emits JavaScript', () => {
		expect(emitted.length).toBeGreaterThan(0);
	});

	it.each(FORBIDDEN_RUNTIME_SPECIFIERS)('has zero runtime references to %s', (specifier) => {
		const offenders = emitted
			.filter(({ source }) => source.includes(specifier))
			.map(({ file }) => `${file} references ${specifier}`);

		expect(offenders).toEqual([]);
	});

	it('imports nothing outside its own relative modules — not even a Node builtin', () => {
		const externalImport = /(?:require\(|from\s*)['"]([^.'"][^'"]*)['"]/g;
		const offenders = emitted.flatMap(({ file, source }) =>
			[...source.matchAll(externalImport)]
				.map((match) => match[1])
				.filter((specifier): specifier is string => specifier !== undefined)
				.map((specifier) => `${file} imports ${specifier}`),
		);

		expect(offenders).toEqual([]);
	});

	// A DOM lib would let `document` be referenced directly, which is what makes a module
	// throw under SSR instead of returning null. The guarded `globalThis` access is the
	// contract; this asserts nothing bypassed it.
	it('never references document or window outside a guarded globalThis lookup', () => {
		const offenders = emitted.flatMap(({ file, source }) =>
			[...source.matchAll(/\b(document|window)\b/g)]
				.filter((match) => {
					const start = Math.max(0, (match.index ?? 0) - 40);
					return !source.slice(start, match.index).includes('globalThis');
				})
				.map((match) => `${file} references bare ${match[1]}`),
		);

		expect(offenders).toEqual([]);
	});
});
