import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import CoverageTestsReporter, { errorRecord, relativeTo, testRecords } from './tests-reporter.mjs';

const ROOT = '/work/saha-textile';

/** A test file as Vitest's reporter API hands it over. */
function moduleOf(file, tests, { state = 'passed', duration = 12.4, errors = [] } = {}) {
	return {
		moduleId: `${ROOT}/${file}`,
		state: () => state,
		diagnostic: () => ({ duration }),
		errors: () => errors,
		children: {
			*allTests() {
				for (const t of tests)
					yield {
						fullName: t.name,
						result: () => t.result,
						diagnostic: () => (t.ms === undefined ? undefined : { duration: t.ms }),
					};
			},
		},
	};
}

describe('the coverage tests reporter', () => {
	afterEach(() => {
		delete process.env.COVERAGE_TESTS_FILE;
		delete process.env.COVERAGE_ROOT;
	});

	it('writes paths relative to the repository and keeps others as they are', () => {
		assert.equal(relativeTo(ROOT, `${ROOT}/apps/admin/a.ts`), 'apps/admin/a.ts');
		assert.equal(relativeTo(`${ROOT}/`, `${ROOT}/b.ts`), 'b.ts');
		assert.equal(relativeTo(ROOT, '/elsewhere/c.ts'), '/elsewhere/c.ts');
		assert.equal(relativeTo(ROOT, undefined), '');
	});

	it('keeps expected and received apart, and only the frames in our own code', () => {
		const e = errorRecord(
			{
				name: 'AssertionError',
				message: "expected 50 to be '50'",
				expected: '"50"',
				actual: 50,
				diff: '- "50"\n+ 50',
				stacks: [
					{ file: `${ROOT}/apps/admin/src/table.spec.ts`, line: 164, column: 38 },
					{ file: `${ROOT}/node_modules/vitest/dist/index.js`, line: 1, column: 1 },
					{ file: `${ROOT}/apps/admin/src/table.ts` },
					{ line: 3 },
					null,
				],
			},
			ROOT,
		);
		assert.deepEqual(e, {
			name: 'AssertionError',
			message: "expected 50 to be '50'",
			expected: '"50"',
			actual: '50',
			diff: '- "50"\n+ 50',
			frames: [
				{ file: 'apps/admin/src/table.spec.ts', line: 164, column: 38 },
				{ file: 'apps/admin/src/table.ts', line: 0, column: 0 },
			],
		});
	});

	it('copes with a thrown value that is not an error object', () => {
		assert.deepEqual(errorRecord('boom', ROOT), {
			name: 'Error',
			message: 'boom',
			expected: undefined,
			actual: undefined,
			diff: undefined,
			frames: [],
		});
		assert.equal(errorRecord({ stacks: 'not a list' }, ROOT).message, '');
	});

	it('lists every test file with its tests, outcomes, times and errors', () => {
		const records = testRecords(
			[
				moduleOf('apps/admin/src/table.spec.ts', [
					{ name: 'Table > keeps the page', result: { state: 'passed' }, ms: 3.6 },
					{
						name: 'Table > changes the size',
						result: { state: 'failed', errors: [{ message: 'no' }] },
						ms: Number.NaN,
					},
					{ name: 'Table > later', result: { state: 'skipped' } },
				]),
				moduleOf('apps/admin/src/broken.spec.ts', [], {
					state: 'failed',
					duration: null,
					errors: [{ message: 'cannot import' }],
				}),
			],
			ROOT,
		);
		assert.equal(records.files.length, 2);
		assert.deepEqual(
			records.files[0].tests.map((t) => [t.name, t.state, t.ms, t.errors.length]),
			[
				['Table > keeps the page', 'passed', 4, 0],
				['Table > changes the size', 'failed', 0, 1],
				['Table > later', 'skipped', 0, 0],
			],
		);
		assert.deepEqual(
			{ ...records.files[1], errors: records.files[1].errors.map((e) => e.message) },
			{ file: 'apps/admin/src/broken.spec.ts', state: 'failed', ms: 0, errors: ['cannot import'], tests: [] },
		);
		assert.equal(records.files[0].ms, 12);
	});

	it('leaves out the temporary spec that makes Angular apps count every file', () => {
		const modules = [
			moduleOf('apps/admin/src/zz-denominator.spec.ts', []),
			moduleOf('apps/admin/src/a.spec.ts', []),
		];
		assert.deepEqual(
			testRecords(modules, ROOT, 'src/zz-denominator.spec.ts').files.map((f) => f.file),
			['apps/admin/src/a.spec.ts'],
		);
		assert.equal(testRecords(modules, ROOT, '').files.length, 2);
	});

	it('writes the report where the run asks, and nothing when it does not', () => {
		const reporter = new CoverageTestsReporter();
		reporter.onTestRunEnd([moduleOf('a.spec.ts', [])]);
		const dir = mkdtempSync(join(tmpdir(), 'coverage-tests-'));
		try {
			process.env.COVERAGE_TESTS_FILE = join(dir, 'admin', 'tests.json');
			process.env.COVERAGE_ROOT = ROOT;
			reporter.onTestRunEnd([moduleOf('apps/a.spec.ts', [])]);
			assert.equal(
				JSON.parse(readFileSync(join(dir, 'admin', 'tests.json'), 'utf8')).files[0].file,
				'apps/a.spec.ts',
			);
			delete process.env.COVERAGE_ROOT;
			const cwd = process.cwd();
			reporter.onTestRunEnd([{ ...moduleOf('x.spec.ts', []), moduleId: `${cwd}/x.spec.ts` }]);
			assert.equal(JSON.parse(readFileSync(join(dir, 'admin', 'tests.json'), 'utf8')).files[0].file, 'x.spec.ts');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
