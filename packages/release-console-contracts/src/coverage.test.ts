import { describe, expect, it } from 'vitest';

import {
	type CoverageLine,
	type IstanbulFile,
	type TestsReport,
	addCounts,
	branchNote,
	changedLines,
	codeOf,
	conditionalTest,
	coverageBand,
	coverageFileAnswerSchema,
	coverageGaps,
	coverageLines,
	coverageMetaSchema,
	coverageNodeSchema,
	coverageRunsSchema,
	coverageTree,
	coverageTreeAnswerSchema,
	coveredShare,
	failuresFor,
	fileCounts,
	ifCondition,
	istanbulFileSchema,
	metricShare,
	patchFile,
	repoPath,
	specsFor,
	testTotals,
	testsReportSchema,
} from './coverage';

const r = (sl: number, sc: number | null, el: number, ec: number | null) => ({
	start: { line: sl, column: sc },
	end: { line: el, column: ec },
});

/** A small file: lines 1–8 of a component, as Istanbul would record it. */
const TEXT = [
	'export function pick(order, buyer) {', // 1
	"\tif (order.status !== 'open' || !buyer) return null;", // 2
	'\tconst size = order.size ?? 30;', // 3
	'\treturn size > 10 ? size : 10;', // 4
	'}', // 5
	'export function never() {', // 6
	'\treturn 1;', // 7
	'}', // 8
];
const FILE: IstanbulFile = istanbulFileSchema.parse({
	path: '/repo/apps/admin/src/pick.ts',
	statementMap: {
		'0': r(2, 1, 2, 52),
		'1': r(2, 41, 2, 53),
		'2': r(3, 1, 3, 31),
		'3': r(4, 1, 4, 30),
		'4': r(7, 1, 7, 10),
	},
	fnMap: {
		'0': { name: 'pick', decl: r(1, 16, 1, 20), loc: r(1, 0, 5, 1) },
		'1': { name: 'never', decl: r(6, 16, 6, 21) },
	},
	branchMap: {
		'0': { type: 'if', loc: r(2, 1, 2, 52), locations: [r(2, 41, 2, 53), r(2, 1, 2, 52)] },
		'1': { type: 'binary-expr', loc: r(3, 14, 3, 30), locations: [r(3, 14, 3, 24), r(3, 28, 3, 30)] },
		'2': { type: 'cond-expr', loc: r(4, 8, 4, 29), locations: [r(4, 20, 4, 24), r(4, 27, 4, 29)] },
		'3': { type: 'binary-expr', loc: r(7, 1, 7, 9), locations: [r(7, 1, 7, 4), r(7, 5, 7, 9)] },
	},
	s: { '0': 4, '1': 0, '2': 4, '3': 4, '4': 0 },
	f: { '0': 4, '1': 0 },
	b: { '0': [0, 4], '1': [4, 0], '2': [4, 0], '3': [0, 0] },
});

describe('coverage counts', () => {
	it('counts a file the way Istanbul’s summary does: a line is a statement’s first line', () => {
		// statements 3/5; branch paths 3/8; functions 1/2; lines: 2 (max 4), 3, 4 run, 7 not → 3/4
		expect(fileCounts(FILE)).toEqual([3, 5, 3, 8, 1, 2, 3, 4]);
		const odd = istanbulFileSchema.parse({
			path: 'x',
			statementMap: { a: { start: {}, end: {} } },
			fnMap: {},
			branchMap: {},
			s: {},
			f: {},
			b: {},
		});
		expect(fileCounts(odd)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
		expect(odd.statementMap['a']?.start.line).toBe(1);
	});

	it('rounds shares down, calls nothing to cover 100, and bands them green only at 100', () => {
		expect(coveredShare(9996, 10000)).toBe(99.9);
		expect(coveredShare(0, 0)).toBe(100);
		expect(metricShare([3, 5, 4, 8, 1, 2, 3, 4], 'functions')).toBe(50);
		expect([coverageBand(100), coverageBand(80), coverageBand(79.9)]).toEqual(['ok', 'amber', 'red']);
		expect(addCounts([1, 2, 3, 4, 5, 6, 7, 8], [1, 1, 1, 1, 1, 1, 1, 1])).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('makes paths relative to the run’s repository', () => {
		expect(repoPath('/home/runner/work/x/x/apps/a.ts', '/home/runner/work/x/x')).toBe('apps/a.ts');
		expect(repoPath('C:\\w\\x\\apps\\a.ts', 'C:\\w\\x\\')).toBe('apps/a.ts');
		expect(repoPath('/elsewhere/a.ts', '/repo')).toBe('/elsewhere/a.ts');
	});
});

describe('the tree', () => {
	it('puts every committed file in its folder and sums every folder up to the whole codebase', () => {
		const counts = new Map(
			[
				['apps/admin/src/a.ts', [1, 2, 1, 2, 1, 1, 1, 2] as const],
				['apps/admin/src/b.ts', [2, 2, 0, 0, 1, 1, 2, 2] as const],
				['packages/core/x.ts', [0, 4, 0, 0, 0, 1, 0, 4] as const],
			].map(([k, v]) => [k, [...v] as [number, number, number, number, number, number, number, number]]),
		);
		const tree = coverageTree(
			[
				'README.md',
				'apps/admin/src/b.ts',
				'apps/admin/src/a.ts',
				'apps/admin/src/a.html',
				'packages/core/x.ts',
				'docs//intro.md',
			],
			counts,
			'repo',
		);
		expect(tree.n).toBe('repo');
		expect(tree.k?.map((k) => k.n)).toEqual(['apps', 'docs', 'packages', 'README.md']);
		expect(tree.c).toEqual([3, 8, 1, 2, 2, 3, 3, 8]);
		const src = tree.k?.[0]?.k?.[0]?.k?.[0];
		expect(src?.k?.map((k) => [k.n, k.c])).toEqual([
			['a.html', null],
			['a.ts', [1, 2, 1, 2, 1, 1, 1, 2]],
			['b.ts', [2, 2, 0, 0, 1, 1, 2, 2]],
		]);
		expect(tree.k?.[1]).toEqual({ n: 'docs', c: null, k: [{ n: 'intro.md', c: null }] });
		expect(coverageTree([], new Map())).toEqual({ n: '', c: null, k: [] });
		expect(coverageNodeSchema.parse(tree)).toEqual(tree);
	});
});

describe('reading code back', () => {
	it('quotes the code of a range, a whole line when columns are missing, and shortens long code', () => {
		expect(codeOf(TEXT, r(3, 14, 3, 24))).toBe('order.size');
		expect(codeOf(TEXT, r(1, 0, 2, 5))).toBe('export function pick(order, buyer) { if (');
		expect(codeOf(TEXT, r(1, 0, 1, null))).toBe('export function pick(order, buyer) {');
		expect(codeOf(TEXT, r(3, 14, 2, 0))).toBe('order.size ?? 30;');
		expect(codeOf(['x'.repeat(200)], r(1, 0, 1, null))).toHaveLength(120);
		expect(codeOf([], r(9, 0, 9, null))).toBe('');
	});

	it('finds the condition of an if, across lines and nested brackets', () => {
		expect(ifCondition('if (a(b) && (c || d)) return;')).toBe('a(b) && (c || d)');
		expect(ifCondition('} else if (x) {')).toBe('x');
		expect(ifCondition('if (a && (b')).toBeNull();
		expect(ifCondition('return a;')).toBeNull();
	});

	it('finds the test of a conditional, past strings, ?. and ??', () => {
		expect(conditionalTest("view && this.ok('?') ? a : b")).toBe("view && this.ok('?')");
		expect(conditionalTest('a?.b ?? c ? d : e')).toBe('a?.b ?? c');
		expect(conditionalTest('f(x ? 1 : 2) ? y : z')).toBe('f(x ? 1 : 2)');
		expect(conditionalTest('"it\\"s ?" ? 1 : 2')).toBe('"it\\"s ?"');
		expect(conditionalTest(' ? x : y')).toBeNull();
		expect(conditionalTest('plain(value)')).toBeNull();
	});
});

describe('gaps in plain words', () => {
	it('says which way an if, a conditional or a condition never went, quoting the code', () => {
		const b = FILE.branchMap;
		expect(branchNote(TEXT, b['0'], 0)).toEqual({
			kind: 'branch',
			say: 'never true',
			code: "order.status !== 'open' || !buyer",
		});
		expect(branchNote(TEXT, b['0'], 1).say).toBe('never false');
		expect(branchNote(TEXT, b['2'], 1)).toEqual({ kind: 'branch', say: 'never false', code: 'size > 10' });
		expect(branchNote(TEXT, b['2'], 0).say).toBe('never true');
		expect(branchNote(TEXT, b['1'], 1)).toEqual({
			kind: 'branch',
			say: 'never needed: the value before ?? was never empty',
			code: '30',
		});
		expect(branchNote(TEXT, b['1'], 0)).toEqual({
			kind: 'branch',
			say: 'never ran: the first part of this condition',
			code: 'order.size',
		});
	});

	it('names || and && sides, and other branch kinds', () => {
		const text = ['a || b', 'a && b', 'a | b', 'f(x = 3)', "\tcase 'open':", 'a ||', 'b'];
		const bin = (line: number) => ({
			type: 'binary-expr',
			loc: r(line, 0, line, 6),
			locations: [r(line, 0, line, 1), r(line, 5, line, 6)],
		});
		expect(branchNote(text, bin(1), 1).say).toBe('never reached: the part before || was always true');
		expect(branchNote(text, bin(2), 1).say).toBe('never reached: the part before && was always false');
		expect(branchNote(text, bin(3), 1).say).toBe('never reached');
		// the operator can end the line before: `a ||` then `b`, or sit on a line of its own
		const split = { type: 'binary-expr', loc: r(6, 0, 7, 1), locations: [r(6, 0, 6, 1), r(7, 0, 7, 1)] };
		expect(branchNote(text, split, 1)).toEqual({
			kind: 'branch',
			say: 'never reached: the part before || was always true',
			code: 'b',
		});
		// some reports end each part late, running into the next operator or comma
		const late = {
			type: 'binary-expr',
			loc: r(1, 0, 1, 13),
			locations: [r(1, 0, 1, 4), r(1, 5, 1, 9), r(1, 10, 1, 13)],
		};
		expect(branchNote(["x ?? y ?? '',"], late, 2)).toEqual({
			kind: 'branch',
			say: 'never needed: the value before ?? was never empty',
			code: "''",
		});
		expect(branchNote(["x ?? y ?? '',"], late, 1).code).toBe('y');
		expect(branchNote(["x ?? y ?? '',"], late, 0).code).toBe('x');
		const apart = { type: 'binary-expr', loc: r(1, 0, 3, 1), locations: [r(1, 0, 1, 1), r(3, 0, 3, 1)] };
		expect(branchNote(['a', '&&', 'b'], apart, 1).say).toBe('never reached: the part before && was always false');
		const noColumns = {
			type: 'binary-expr',
			loc: r(1, null, 2, null),
			locations: [r(1, null, 1, null), r(2, null, 2, null)],
		};
		expect(branchNote(['a &&', 'b'], noColumns, 1)).toEqual({
			kind: 'branch',
			say: 'never reached: the part before && was always false',
			code: 'b',
		});
		expect(branchNote(text, { type: 'default-arg', loc: r(4, 6, 4, 7), locations: [r(4, 6, 4, 7)] }, 0)).toEqual({
			kind: 'branch',
			say: 'never used: this default value',
			code: '3',
		});
		expect(branchNote(text, { type: 'switch', loc: r(5, 0, 5, 12), locations: [r(5, 1, 5, 12)] }, 0)).toEqual({
			kind: 'branch',
			say: 'never reached: this case',
			code: "case 'open':",
		});
		expect(branchNote(text, { type: 'other', loc: r(1, 0, 1, 6), locations: [] }, 0)).toEqual({
			kind: 'branch',
			say: 'one way through here never ran',
			code: 'a || b',
		});
		expect(branchNote(['x = 1;'], { type: 'if', loc: r(1, 0, 1, 6), locations: [] }, 0)).toEqual({
			kind: 'branch',
			say: 'never true',
			code: null,
		});
		// columns can be null in v8's data: the whole line is read
		expect(branchNote(['if (ok) go();'], { type: 'if', loc: r(1, null, 1, null), locations: [] }, 1).code).toBe(
			'ok',
		);
		const nulls = {
			type: 'binary-expr',
			loc: r(1, null, 1, null),
			locations: [r(1, null, 1, null), r(1, null, 1, null)],
		};
		expect(branchNote(['a || b'], nulls, 1)).toEqual({ kind: 'branch', say: 'never reached', code: 'a || b' });
	});
});

describe('a file line by line', () => {
	const lines = coverageLines(FILE, TEXT);

	it('colours each line: ran, ran but not every way, never ran, or not code', () => {
		// line 1 declares a function that ran: no statement starts there, so it is not coloured
		expect(lines.map((l) => l.c)).toEqual(['none', 'part', 'part', 'part', 'none', 'part', 'miss', 'none']);
		expect(lines.map((l) => l.h)).toEqual([null, 4, 4, 4, null, null, 0, null]);
	});

	it('puts each gap’s words on its line', () => {
		expect(lines[0]?.notes).toEqual([]);
		expect(lines[1]?.notes.map((n) => n.say)).toEqual(['never true', 'never ran: part of this line']);
		expect(lines[2]?.notes.map((n) => n.say)).toEqual(['never needed: the value before ?? was never empty']);
		expect(lines[3]?.notes.map((n) => n.code)).toEqual(['size > 10']);
		expect(lines[5]?.notes).toEqual([{ kind: 'function', say: 'never called', code: 'never()' }]);
		// branch 3 never went any way: it sits in code that never ran, so the red line says it
		expect(lines[6]?.notes).toEqual([]);
	});

	it('lets the innermost statement decide a line, and names functions that never ran', () => {
		const outer = istanbulFileSchema.parse({
			path: 'x',
			statementMap: { '0': r(1, 0, 3, 2), '1': r(2, 2, 2, 12), '2': r(3, 0, 3, 2) },
			fnMap: { '0': { name: '(anonymous_3)', decl: r(1, 10, 1, 11) }, '1': { decl: r(4, 0, 4, 1) } },
			branchMap: {},
			s: { '0': 2, '1': 0 },
			f: { '0': 0 },
			b: {},
		});
		const l = coverageLines(outer, ['const x = computed(() => {', '\tdoThing();', '});', 'f']);
		expect(l.map((x) => x.c)).toEqual(['part', 'miss', 'miss', 'part']);
		// the same statements listed inner first: the innermost still decides
		const reversed = istanbulFileSchema.parse({
			...outer,
			statementMap: { '0': r(2, 2, 2, 12), '1': r(1, 0, 3, 2) },
			s: { '0': 0, '1': 2 },
		});
		expect(coverageLines(reversed, ['const x = computed(() => {', '\tdoThing();', '});'])[1]?.c).toBe('miss');
		expect(l[0]?.notes).toEqual([{ kind: 'function', say: 'never ran: a function written here', code: null }]);
		expect(l[3]?.notes).toEqual([{ kind: 'function', say: 'never ran: a function written here', code: null }]);
		const ran = istanbulFileSchema.parse({
			path: 'y',
			statementMap: { '0': { start: { line: 1 }, end: {} } },
			fnMap: {},
			branchMap: { '0': { type: 'if', loc: r(1, 0, 1, 5) } },
			s: { '0': 1 },
			f: {},
			b: {},
		});
		expect(coverageLines(ran, ['ok();']).map((x) => [x.c, x.h])).toEqual([['run', 1]]);
		const short = istanbulFileSchema.parse({
			path: 'z',
			statementMap: { '0': r(1, 0, 1, 9) },
			fnMap: {},
			branchMap: { '0': { type: 'binary-expr', loc: r(1, 0, 1, 9) } },
			s: { '0': 1 },
			f: {},
			b: { '0': [1, 0] },
		});
		expect(coverageLines(short, ['a ?? b;'])[0]?.notes).toEqual([
			{ kind: 'branch', say: 'never reached', code: 'a ?? b' },
		]);
	});

	it('lists the gaps in reading order, a block that never ran as one gap', () => {
		const text = ['a();', 'if (x) {', '\tb();', '', '\tc();', '}'];
		const fake: CoverageLine[] = [
			{ h: 1, c: 'run', notes: [] },
			{ h: 1, c: 'part', notes: [{ kind: 'branch', say: 'never true', code: 'x' }] },
			{ h: 0, c: 'miss', notes: [] },
			{ h: null, c: 'miss', notes: [] },
			{ h: 0, c: 'miss', notes: [] },
			{ h: null, c: 'none', notes: [{ kind: 'function', say: 'never called', code: 'f()' }] },
		];
		expect(coverageGaps(fake, text)).toEqual([
			{ kind: 'part', from: 2, to: 2, say: 'never true', code: 'x' },
			{ kind: 'miss', from: 3, to: 5, say: 'never ran', code: 'b();' },
			{ kind: 'function', from: 6, to: 6, say: 'never called', code: 'f()' },
		]);
		expect(coverageGaps([{ h: 0, c: 'miss', notes: [] }], [''])).toEqual([
			{ kind: 'miss', from: 1, to: 1, say: 'never ran', code: null },
		]);
		expect(coverageGaps([{ h: 0, c: 'miss', notes: [] }], [])).toEqual([
			{ kind: 'miss', from: 1, to: 1, say: 'never ran', code: null },
		]);
	});
});

describe('changed lines', () => {
	it('reads the new-side lines a diff adds, past context, removals and the no-newline mark', () => {
		const patch = [
			'diff --git a/x.ts b/x.ts',
			'--- a/x.ts',
			'+++ b/x.ts',
			'@@ -1,3 +1,4 @@',
			' keep',
			'-old',
			'+new one',
			'+new two',
			' keep',
			'@@ -20 +21,0 @@',
			'-gone',
			'@@ -30,0 +31 @@',
			'+last',
			'\\ No newline at end of file',
		].join('\n');
		expect(changedLines(patch)).toEqual([2, 3, 31]);
	});

	it('counts a changed line with code as run or missed, and leaves out lines with none', () => {
		const lines = coverageLines(FILE, TEXT);
		expect(patchFile('a.ts', [1, 2, 7, 8, 40], lines)).toEqual({ path: 'a.ts', run: [2], missed: [7] });
	});
});

describe('tests beside the code', () => {
	const report: TestsReport = testsReportSchema.parse({
		files: [
			{
				file: 'apps/admin/src/pick.spec.ts',
				state: 'failed',
				ms: 40,
				tests: [
					{ name: 'pick > keeps', state: 'passed', ms: 3 },
					{
						name: 'pick > sizes',
						state: 'failed',
						ms: 5,
						errors: [
							{
								message: "expected 50 to be '50'",
								expected: '"50"',
								actual: '50',
								frames: [{ file: 'apps/admin/src/pick.spec.ts', line: 9, column: 3 }],
							},
						],
					},
				],
			},
			{
				file: 'apps/admin/src/other.spec.ts',
				state: 'failed',
				ms: 90,
				tests: [
					{
						name: 'other > uses pick',
						state: 'failed',
						errors: [{ message: 'boom', frames: [{ file: 'apps/admin/src/pick.ts', line: 3, column: 1 }] }],
					},
					{ name: 'other > waits', state: 'skipped' },
					{ name: 'other > later', state: 'pending' },
				],
			},
			{
				file: 'apps/admin/src/broken.spec.ts',
				state: 'failed',
				ms: 1,
				errors: [
					{ message: 'cannot import pick', frames: [{ file: 'apps/admin/src/pick.ts', line: 1, column: 0 }] },
				],
				tests: [],
			},
			{
				file: 'packages/core-domain/test/rules.test.ts',
				state: 'passed',
				ms: 7,
				errors: [{ message: 'module note' }],
				tests: [{ name: 'rules > adds', state: 'passed' }],
			},
			{ file: 'rules.test.ts', state: 'passed', tests: [] },
		],
	});

	it('finds the test files beside a file, or in its package’s test folder', () => {
		expect(specsFor('apps/admin/src/pick.ts', report).map((s) => s.file)).toEqual(['apps/admin/src/pick.spec.ts']);
		expect(specsFor('packages/core-domain/src/rules.ts', report)).toEqual([
			{
				file: 'packages/core-domain/test/rules.test.ts',
				tests: [{ name: 'rules > adds', state: 'passed', ms: 0 }],
			},
		]);
		expect(specsFor('rules.ts', report).map((s) => s.file)).toEqual(['rules.test.ts']);
	});

	it('lists the failures in its own tests and in tests that went through it', () => {
		const f = failuresFor('apps/admin/src/pick.ts', report);
		expect(f.map((x) => [x.file, x.name, x.error.message])).toEqual([
			['apps/admin/src/pick.spec.ts', 'pick > sizes', "expected 50 to be '50'"],
			['apps/admin/src/other.spec.ts', 'other > uses pick', 'boom'],
			['apps/admin/src/broken.spec.ts', '(the whole file)', 'cannot import pick'],
		]);
		expect(f[0]?.error).toMatchObject({ name: 'Error', expected: '"50"', actual: '50' });
		expect(failuresFor('packages/core-domain/src/rules.ts', report).map((x) => x.name)).toEqual([
			'(the whole file)',
		]);
		expect(failuresFor('apps/admin/src/none.ts', report)).toEqual([]);
	});

	it('totals a run’s tests and names its slowest test files', () => {
		expect(testTotals(report, 2)).toEqual({
			passed: 2,
			failed: 4,
			skipped: 2,
			slowest: [
				{ file: 'apps/admin/src/other.spec.ts', ms: 90 },
				{ file: 'apps/admin/src/pick.spec.ts', ms: 40 },
			],
		});
		expect(testTotals(report).slowest).toHaveLength(5);
	});
});

describe('the answers', () => {
	it('parse what the API sends', () => {
		const meta = {
			root: '/r',
			sha: 's',
			ref: 'b',
			runId: null,
			uncommitted: false,
			finishedAt: 't',
			floor: 10,
			workspaces: { admin: { dir: 'apps/admin' } },
		};
		expect(coverageMetaSchema.parse(meta)).toEqual(meta);
		expect(
			coverageRunsSchema.parse({
				ci: [{ id: '1', sha: 's', ref: 'b', title: 't', finishedAt: null, state: 'running', url: 'u' }],
				ciMessage: null,
				mac: null,
				macMessage: 'Run pnpm coverage first.',
			}).ci[0]?.state,
		).toBe('running');
		const tree = {
			source: 'mac',
			run: 'mac',
			sha: 's',
			ref: 'b',
			finishedAt: 't',
			uncommitted: true,
			tree: { n: '', c: null, k: [] },
			workspaces: [{ name: 'admin', dir: 'apps/admin', passed: true, failed: 0, measuredAt: null }],
			tests: { passed: 1, failed: 0, skipped: 0, slowest: [] },
			changed: { label: 'commit 03ae04a6', files: [{ path: 'a.ts', run: [1], missed: [] }] },
		};
		expect(coverageTreeAnswerSchema.parse(tree)).toEqual(tree);
		const file = {
			path: 'a.ts',
			sha: 's',
			counts: null,
			text: [],
			lines: [],
			gaps: [],
			specs: [],
			failures: [],
			changed: [],
			note: 'Not measured.',
		};
		expect(coverageFileAnswerSchema.parse(file)).toEqual(file);
	});
});
