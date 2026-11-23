/**
 * A Vitest reporter for the Release Console's Coverage screen (brief CRmpBdP3ce62g1JoCAhh23, approved
 * 24 Nov 2026). `pnpm coverage` adds it to every workspace's run. It writes, to the file named by
 * COVERAGE_TESTS_FILE, each test file with its tests: name, outcome, time and, for a failure, the error
 * with expected and received kept apart and the lines it went through. Vitest's own JSON report keeps
 * only the error text, so the screen could not show expected against received from it.
 *
 * Paths are written relative to COVERAGE_ROOT (the repository), so a report made on CI reads the same
 * as one made on this Mac.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The repository-relative form of a path; one outside the repository is kept as it is. */
export function relativeTo(root, file) {
	const prefix = root.endsWith('/') ? root : `${root}/`;
	return typeof file === 'string' && file.startsWith(prefix) ? file.slice(prefix.length) : String(file ?? '');
}

const text = (value) => (typeof value === 'string' ? value : value === undefined ? undefined : String(value));
const round = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms) : 0);

/** One thrown error, kept to what the screen shows: never a value from the environment, only the test's own. */
export function errorRecord(error, root) {
	const e = error && typeof error === 'object' ? error : { message: String(error) };
	const frames = (Array.isArray(e.stacks) ? e.stacks : [])
		.filter((frame) => frame && typeof frame.file === 'string')
		.map((frame) => ({ file: relativeTo(root, frame.file), line: frame.line ?? 0, column: frame.column ?? 0 }))
		.filter((frame) => !frame.file.includes('node_modules/'));
	return {
		name: text(e.name) ?? 'Error',
		message: text(e.message) ?? '',
		expected: text(e.expected),
		actual: text(e.actual),
		diff: text(e.diff),
		frames,
	};
}

/**
 * Every test file of a run with its tests, in the order Vitest reports them. `skip` names a file left out:
 * the temporary spec `pnpm coverage` writes so Angular apps count every source file.
 */
export function testRecords(modules, root, skip = '') {
	return {
		files: [...modules]
			.filter((module) => !skip || !module.moduleId.endsWith(skip))
			.map((module) => ({
				file: relativeTo(root, module.moduleId),
				state: module.state(),
				ms: round(module.diagnostic()?.duration),
				errors: module.errors().map((error) => errorRecord(error, root)),
				tests: [...module.children.allTests()].map((test) => {
					const result = test.result();
					return {
						name: test.fullName,
						state: result.state,
						ms: round(test.diagnostic()?.duration),
						errors: (result.errors ?? []).map((error) => errorRecord(error, root)),
					};
				}),
			})),
	};
}

export default class CoverageTestsReporter {
	onTestRunEnd(modules) {
		const file = process.env.COVERAGE_TESTS_FILE;
		if (!file) return;
		mkdirSync(dirname(file), { recursive: true });
		const root = process.env.COVERAGE_ROOT ?? process.cwd();
		writeFileSync(file, JSON.stringify(testRecords(modules, root, process.env.COVERAGE_TESTS_SKIP)));
	}
}
