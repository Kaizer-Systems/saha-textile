import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Executable proof of gate G-CORE-CONTRACTS (owner lock 2026-07-25, Option C).
 *
 * ESLint forbids value imports of `@saha-textile/contracts` and any import of Zod in
 * `core-domain` sources. This test proves the same rule where it actually matters —
 * in the COMPILED JavaScript. If someone converts an `import type` into a value
 * import, TypeScript stops erasing it and the emitted module gains a real runtime
 * dependency on contracts (and therefore Zod). Linting alone would catch today's
 * spelling of that mistake; this catches the consequence.
 *
 * It compiles the package into a throwaway directory so it never depends on, or
 * disturbs, a previous `pnpm build` output.
 */

/**
 * Vitest runs with the package directory as cwd (`pnpm --filter`, Turbo, and a bare
 * `vitest` all do). `import.meta.url` is not usable here because the base tsconfig emits
 * CommonJS, so the cwd is resolved instead — and then VERIFIED, since a test that
 * silently compiles the wrong package would report a purity it never checked.
 */
const packageRoot = resolve(process.cwd());
const packageName = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name?: string }).name;
if (packageName !== '@saha-textile/core-domain') {
	throw new Error(`runtime-purity must run from the core-domain package; cwd resolved to "${packageName}"`);
}

const outDir = mkdtempSync(join(tmpdir(), 'saha-textile-core-purity-'));

/** Packages whose presence in emitted JS would break core's runtime purity. */
const FORBIDDEN_RUNTIME_SPECIFIERS = [
	'@saha-textile/contracts',
	'zod',
	'mongoose',
	'@nestjs/',
	'fastify',
	'@aws-sdk/',
	'bullmq',
	'meilisearch',
];

const collectJsFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		return statSync(full).isDirectory() ? collectJsFiles(full) : full.endsWith('.js') ? [full] : [];
	});

const tsc = join(packageRoot, 'node_modules', '.bin', 'tsc');
/**
 * `--removeComments` is load-bearing, not tidiness.
 *
 * The scanners below match emitted text for `from '<specifier>'`, and TypeScript preserves
 * comments by default. A doc comment containing an ordinary English phrase in quotes — say,
 * distinguishing "already granted" from "the write failed" — therefore reads as an import and
 * fails the suite, while a comment mentioning `zod` reads as a runtime reference to Zod.
 *
 * Stripping comments before scanning cannot hide a real violation: a runtime import is code,
 * and code is never a comment. Matching them was the bug.
 */
execFileSync(tsc, ['-p', join(packageRoot, 'tsconfig.json'), '--outDir', outDir, '--removeComments'], {
	cwd: packageRoot,
	stdio: 'pipe',
});

const emitted = collectJsFiles(outDir).map((file) => ({
	file: file.slice(outDir.length + 1),
	source: readFileSync(file, 'utf8'),
}));

afterAll(() => {
	rmSync(outDir, { recursive: true, force: true });
});

describe('core-domain runtime purity (G-CORE-CONTRACTS)', () => {
	it('emits JavaScript', () => {
		expect(emitted.length).toBeGreaterThan(0);
	});

	it.each(FORBIDDEN_RUNTIME_SPECIFIERS)('has zero runtime references to %s', (specifier) => {
		const offenders = emitted
			.filter(({ source }) => source.includes(specifier))
			.map(({ file }) => `${file} references ${specifier}`);

		expect(offenders).toEqual([]);
	});

	it('emits no require()/import of any workspace or third-party package', () => {
		// Core may only import its own relative modules. Anything else is a dependency.
		const externalImport = /(?:require\(|from\s*)['"]([^.'"][^'"]*)['"]/g;
		const offenders = emitted.flatMap(({ file, source }) =>
			[...source.matchAll(externalImport)]
				.map((match) => match[1])
				.filter((specifier): specifier is string => specifier !== undefined && !specifier.startsWith('node:'))
				.map((specifier) => `${file} imports ${specifier}`),
		);

		expect(offenders).toEqual([]);
	});
});
