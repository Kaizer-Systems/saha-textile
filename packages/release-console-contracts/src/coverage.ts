/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23, approved 24 Nov 2026): the shapes the console reads
 * and the rules that turn a coverage run into what the screen shows. Everything here works from Istanbul's
 * coverage data (what Vitest, Jest and Karma write), the test report of `pnpm coverage` and the file text,
 * so it holds for any JavaScript or TypeScript code, not only this repository's.
 *
 * Counts travel as eight numbers: covered and total statements, branches, functions and lines.
 * Folder counts are sums of their files' counts, never averages of percentages.
 */
import { z } from 'zod';

/* ===== Istanbul's file coverage, read leniently (columns can be missing or null) ===== */

// A missing line reads as line 1, so every rule below can count on one.
const position = z.object({ line: z.number().int().default(1), column: z.number().int().nullable().optional() });
const range = z.object({ start: position, end: position });
export const istanbulFileSchema = z.object({
	path: z.string(),
	statementMap: z.record(z.string(), range),
	fnMap: z.record(z.string(), z.object({ name: z.string().default(''), decl: range, loc: range.optional() })),
	branchMap: z.record(z.string(), z.object({ type: z.string(), loc: range, locations: z.array(range).default([]) })),
	s: z.record(z.string(), z.number()),
	f: z.record(z.string(), z.number()),
	b: z.record(z.string(), z.array(z.number())),
});
export type IstanbulFile = z.infer<typeof istanbulFileSchema>;
type Range = z.infer<typeof range>;

/** Covered and total: statements, branches, functions, lines. */
export const countsSchema = z.tuple([
	z.number(),
	z.number(),
	z.number(),
	z.number(),
	z.number(),
	z.number(),
	z.number(),
	z.number(),
]);
export type Counts = z.infer<typeof countsSchema>;
export const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'] as const;
export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** A file's counts, the way Istanbul's summary counts them (a line is a statement's first line). */
export function fileCounts(file: IstanbulFile): Counts {
	const s = Object.values(file.s);
	const b = Object.values(file.b).flat();
	const f = Object.values(file.f);
	const lines = new Map<number, number>();
	for (const [id, loc] of Object.entries(file.statementMap)) {
		const line = loc.start.line;
		lines.set(line, Math.max(lines.get(line) ?? 0, file.s[id] ?? 0));
	}
	const ran = (n: number) => n > 0;
	const l = [...lines.values()];
	return [
		s.filter(ran).length,
		s.length,
		b.filter(ran).length,
		b.length,
		f.filter(ran).length,
		f.length,
		l.filter(ran).length,
		l.length,
	];
}

/** The share covered, rounded down to one decimal so 99.96 never reads as 100; nothing to cover counts as 100. */
export function coveredShare(covered: number, total: number): number {
	return total === 0 ? 100 : Math.floor((covered / total) * 1000) / 10;
}
/** One metric's share from eight counts. */
export function metricShare(counts: Counts, metric: CoverageMetric): number {
	const i = COVERAGE_METRICS.indexOf(metric) * 2;
	return coveredShare(counts[i] as number, counts[i + 1] as number);
}
/** Colour bands (owner's Q2 A): green only at 100%, amber from 80%, red below. */
export type CoverageBand = 'ok' | 'amber' | 'red';
export function coverageBand(share: number): CoverageBand {
	return share >= 100 ? 'ok' : share >= 80 ? 'amber' : 'red';
}
export function addCounts(a: Counts, b: Counts): Counts {
	return a.map((v, i) => v + (b[i] as number)) as Counts;
}

/** A path relative to the repository: the run's root taken off, separators made `/`. */
export function repoPath(path: string, root: string): string {
	const p = path.replace(/\\/g, '/');
	const r = root.replace(/\\/g, '/').replace(/\/$/, '');
	return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

/* ===== The tree ===== */

/** A folder (with `k`, its children) or a file; `c` is null for a file with no code the tests can run. */
export interface CoverageNode {
	/** Name. */
	n: string;
	/** Counts, summed for a folder; null when nothing under it is measured. */
	c: Counts | null;
	/** Children, folders first, then by name. */
	k?: CoverageNode[];
}
export const coverageNodeSchema: z.ZodType<CoverageNode> = z.lazy(() =>
	z.object({ n: z.string(), c: countsSchema.nullable(), k: z.array(coverageNodeSchema).optional() }),
);

/**
 * The committed file list as a tree, each file with its counts, each folder with the sums of everything
 * under it, up to the root (the whole codebase).
 */
export function coverageTree(
	paths: readonly string[],
	counts: ReadonlyMap<string, Counts>,
	rootName = '',
): CoverageNode {
	interface Draft {
		n: string;
		k: Map<string, Draft> | null;
		path: string;
	}
	const root: Draft = { n: rootName, k: new Map(), path: '' };
	for (const path of paths) {
		const parts = path.split('/').filter(Boolean);
		let at = root;
		parts.forEach((part, i) => {
			const last = i === parts.length - 1;
			const kids = at.k as Map<string, Draft>;
			let next = kids.get(part);
			if (!next) {
				next = { n: part, k: last ? null : new Map(), path: parts.slice(0, i + 1).join('/') };
				kids.set(part, next);
			}
			at = next;
		});
	}
	const finish = (d: Draft): CoverageNode => {
		if (!d.k) return { n: d.n, c: counts.get(d.path) ?? null };
		const k = [...d.k.values()].sort((a, b) => Number(!!b.k) - Number(!!a.k) || a.n.localeCompare(b.n)).map(finish);
		const measured = k.filter((x): x is CoverageNode & { c: Counts } => x.c !== null);
		return { n: d.n, c: measured.length ? measured.map((x) => x.c).reduce(addCounts) : null, k };
	};
	return finish(root);
}

/* ===== One file, line by line ===== */

export type LineClass = 'run' | 'part' | 'miss' | 'none';
/** A gap in plain words: what never happened, and the code it is about. */
export interface GapNote {
	kind: 'branch' | 'function' | 'statement';
	say: string;
	code: string | null;
}
export const gapNoteSchema = z.object({
	kind: z.enum(['branch', 'function', 'statement']),
	say: z.string(),
	code: z.string().nullable(),
});
export interface CoverageLine {
	/** How many times the tests ran the statements that start here; null when none starts here. */
	h: number | null;
	c: LineClass;
	notes: GapNote[];
}
export const coverageLineSchema = z.object({
	h: z.number().nullable(),
	c: z.enum(['run', 'part', 'miss', 'none']),
	notes: z.array(gapNoteSchema),
});

const lineAt = (text: readonly string[], line: number) => text[line - 1] ?? '';
const tidy = (code: string, max = 120) => {
	const one = code.replace(/\s+/g, ' ').trim();
	return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
/** The code a range covers (columns may be missing: the whole line). */
export function codeOf(text: readonly string[], r: Range): string {
	const from = r.start.line;
	const to = Math.max(r.end.line, from);
	const parts: string[] = [];
	for (let line = from; line <= to; line++) {
		const t = lineAt(text, line);
		const a = line === from ? (r.start.column ?? 0) : 0;
		// The end column belongs to the end line only (an end before the start reads to the line's end).
		const b = line === r.end.line && typeof r.end.column === 'number' ? r.end.column : t.length;
		parts.push(t.slice(a, b));
	}
	return tidy(parts.join(' '));
}
/** Text from a point onwards, a few lines at most, joined with spaces. */
function textFrom(text: readonly string[], from: number, column: number | null | undefined, lines = 6) {
	const parts = [lineAt(text, from).slice(column ?? 0)];
	for (let l = from + 1; l < from + lines && l <= text.length; l++) parts.push(lineAt(text, l));
	return parts.join(' ');
}
/** A part of a condition, without the operator or comma some reports run its end into. */
const operandOf = (text: readonly string[], r: Range) => codeOf(text, r).replace(/\s*(\?\?|\|\||&&|[,;])$/, '');
/** The raw text between two points, across lines: where the operator between two parts of a condition sits. */
function textBetween(text: readonly string[], from: Range['end'], to: Range['start']): string {
	if (from.line === to.line) return lineAt(text, to.line).slice(from.column ?? 0, to.column ?? 0);
	const parts = [lineAt(text, from.line).slice(from.column ?? 0)];
	for (let line = from.line + 1; line < to.line; line++) parts.push(lineAt(text, line));
	parts.push(lineAt(text, to.line).slice(0, to.column ?? 0));
	return parts.join('\n');
}
const OPEN = '([{';
const CLOSE = ')]}';
/** The condition in `if (…)` starting at a point; null when it cannot be read there. */
export function ifCondition(source: string): string | null {
	const m = /\bif\s*\(/.exec(source);
	if (!m) return null;
	let depth = 0;
	for (let i = m.index + m[0].length - 1; i < source.length; i++) {
		const ch = source[i] as string;
		if (OPEN.includes(ch)) depth++;
		else if (CLOSE.includes(ch) && --depth === 0) return tidy(source.slice(m.index + m[0].length, i));
	}
	return null;
}
/** The test of `test ? a : b` from its start: the text before the top-level `?` (not `?.` or `??`). */
export function conditionalTest(source: string): string | null {
	let depth = 0;
	let quote: string | null = null;
	for (let i = 0; i < source.length; i++) {
		const ch = source[i] as string;
		if (quote) {
			if (ch === quote && source[i - 1] !== '\\') quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch;
		else if (OPEN.includes(ch)) depth++;
		else if (CLOSE.includes(ch)) depth--;
		else if (ch === '?' && depth === 0 && source[i + 1] !== '.' && source[i + 1] !== '?' && source[i - 1] !== '?')
			return tidy(source.slice(0, i)) || null;
	}
	return null;
}

/** What a branch path that never ran means, in words, with the code quoted where it can be read. */
export function branchNote(
	text: readonly string[],
	branch: { type: string; loc: Range; locations: Range[] },
	path: number,
): GapNote {
	const at = branch.locations[path] ?? branch.loc;
	const note = (say: string, code: string | null): GapNote => ({ kind: 'branch', say, code });
	if (branch.type === 'if') {
		const cond = ifCondition(textFrom(text, branch.loc.start.line, branch.loc.start.column));
		return note(path === 0 ? 'never true' : 'never false', cond);
	}
	if (branch.type === 'cond-expr') {
		const test = conditionalTest(textFrom(text, branch.loc.start.line, branch.loc.start.column));
		return note(path === 0 ? 'never true' : 'never false', test);
	}
	if (branch.type === 'binary-expr' && path > 0) {
		// Reports can list fewer places than paths; then the operator cannot be read. Some reports end a part
		// a few characters late, so the operator is the last one between the two parts' starts.
		const before = branch.locations[path - 1];
		const lead = before ? textBetween(text, before.start, at.start) : '';
		const between = (['??', '||', '&&'] as const)
			.map((op) => ({ op, at: lead.lastIndexOf(op) }))
			.reduce((a, b) => (b.at > a.at ? b : a), { op: '', at: -1 }).op;
		const operand = operandOf(text, at);
		if (between === '??') return note('never needed: the value before ?? was never empty', operand);
		if (between === '||') return note('never reached: the part before || was always true', operand);
		if (between === '&&') return note('never reached: the part before && was always false', operand);
		return note('never reached', operand);
	}
	if (branch.type === 'binary-expr') return note('never ran: the first part of this condition', operandOf(text, at));
	if (branch.type === 'default-arg') return note('never used: this default value', codeOf(text, at));
	if (branch.type === 'switch') return note('never reached: this case', tidy(lineAt(text, at.start.line)));
	return note('one way through here never ran', codeOf(text, at));
}

/** Every line of a file: run count, class and gap notes. `text` is the file's lines. */
export function coverageLines(file: IstanbulFile, text: readonly string[]): CoverageLine[] {
	const starts = new Map<number, number[]>();
	const inner = new Map<number, { span: number; count: number }>();
	for (const [id, loc] of Object.entries(file.statementMap)) {
		const count = file.s[id] ?? 0;
		const from = loc.start.line;
		const to = Math.max(loc.end.line, from);
		starts.set(from, [...(starts.get(from) ?? []), count]);
		const span = (to - from) * 100_000 + ((loc.end.column ?? 99_999) - (loc.start.column ?? 0));
		for (let line = from; line <= to; line++) {
			const was = inner.get(line);
			if (!was || span < was.span) inner.set(line, { span, count });
		}
	}
	const notes = new Map<number, GapNote[]>();
	const add = (line: number, n: GapNote) => notes.set(line, [...(notes.get(line) ?? []), n]);
	for (const [id, fn] of Object.entries(file.fnMap)) {
		if ((file.f[id] ?? 0) > 0) continue;
		const named = fn.name && !/^\(anonymous/.test(fn.name);
		add(fn.decl.start.line, {
			kind: 'function',
			say: named ? 'never called' : 'never ran: a function written here',
			code: named ? `${fn.name}()` : null,
		});
	}
	for (const [id, branch] of Object.entries(file.branchMap)) {
		const counts = file.b[id] ?? [];
		// A branch whose every way is unrun sits in code that never ran: the red lines already say so.
		if (!counts.some((c) => c > 0)) continue;
		counts.forEach((c, path) => {
			if (c > 0) return;
			const at = branch.locations[path] ?? branch.loc;
			add(
				branch.type === 'if' || branch.type === 'cond-expr' ? branch.loc.start.line : at.start.line,
				branchNote(text, branch, path),
			);
		});
	}
	return text.map((_, i) => {
		const line = i + 1;
		const s = starts.get(line) ?? [];
		const here = notes.get(line) ?? [];
		const covering = inner.get(line);
		const mixed = s.some((c) => c > 0) && s.some((c) => c === 0);
		const c: LineClass = mixed
			? 'part'
			: covering?.count === 0
				? 'miss'
				: here.length
					? 'part'
					: covering
						? 'run'
						: 'none';
		if (mixed) here.push({ kind: 'statement', say: 'never ran: part of this line', code: null });
		return { h: s.length ? Math.max(...s) : null, c, notes: here };
	});
}

/** One gap of a file: a block that never ran, or one line that ran but not every way. */
export interface CoverageGap {
	kind: 'miss' | 'part' | 'function';
	from: number;
	to: number;
	say: string;
	code: string | null;
}
export const coverageGapSchema = z.object({
	kind: z.enum(['miss', 'part', 'function']),
	from: z.number().int(),
	to: z.number().int(),
	say: z.string(),
	code: z.string().nullable(),
});
/** Every gap in reading order; a run of unrun lines is one gap. */
export function coverageGaps(lines: readonly CoverageLine[], text: readonly string[]): CoverageGap[] {
	const gaps: CoverageGap[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as CoverageLine;
		if (line.c === 'miss') {
			let j = i;
			while (j + 1 < lines.length && (lines[j + 1] as CoverageLine).c === 'miss') j++;
			gaps.push({ kind: 'miss', from: i + 1, to: j + 1, say: 'never ran', code: tidy(text[i] ?? '') || null });
			i = j;
			continue;
		}
		for (const n of line.notes)
			gaps.push({
				kind: n.kind === 'function' ? 'function' : 'part',
				from: i + 1,
				to: i + 1,
				say: n.say,
				code: n.code,
			});
	}
	return gaps;
}

/* ===== Changed lines (a pull request or a commit) ===== */

export interface PatchFile {
	path: string;
	/** Changed lines the tests ran. */
	run: number[];
	/** Changed lines that never ran. */
	missed: number[];
}
export const patchFileSchema = z.object({ path: z.string(), run: z.array(z.number()), missed: z.array(z.number()) });
/** Which changed lines ran: a line with code that ran (fully or partly) counts as run; lines with no code are left out. */
export function patchFile(path: string, changed: readonly number[], lines: readonly CoverageLine[]): PatchFile {
	const run: number[] = [];
	const missed: number[] = [];
	for (const n of changed) {
		const l = lines[n - 1];
		if (!l || l.c === 'none') continue;
		(l.c === 'miss' ? missed : run).push(n);
	}
	return { path, run, missed };
}
/** The new-side line numbers a unified diff adds or changes, per file (`git diff -U0` or GitHub's patch text). */
export function changedLines(patch: string): number[] {
	const out: number[] = [];
	let line = 0;
	for (const row of patch.split('\n')) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
		if (hunk) {
			line = Number(hunk[1]);
			continue;
		}
		if (row.startsWith('+') && !row.startsWith('+++')) out.push(line++);
		else if (row.startsWith(' ') && line) line++;
	}
	return out;
}

/* ===== The test report and the run description written by `pnpm coverage` ===== */

const testErrorSchema = z.object({
	name: z.string().default('Error'),
	message: z.string().default(''),
	expected: z.string().optional(),
	actual: z.string().optional(),
	diff: z.string().optional(),
	frames: z.array(z.object({ file: z.string(), line: z.number(), column: z.number() })).default([]),
});
export type TestError = z.infer<typeof testErrorSchema>;
export const testsReportSchema = z.object({
	files: z.array(
		z.object({
			file: z.string(),
			state: z.string(),
			ms: z.number().default(0),
			errors: z.array(testErrorSchema).default([]),
			tests: z.array(
				z.object({
					name: z.string(),
					state: z.string(),
					ms: z.number().default(0),
					errors: z.array(testErrorSchema).default([]),
				}),
			),
		}),
	),
});
export type TestsReport = z.infer<typeof testsReportSchema>;
export const coverageMetaSchema = z.object({
	root: z.string(),
	sha: z.string(),
	ref: z.string(),
	runId: z.string().nullable(),
	uncommitted: z.boolean(),
	finishedAt: z.string(),
	floor: z.number(),
	workspaces: z.record(
		z.string(),
		z.object({
			dir: z.string(),
			passed: z.boolean().optional(),
			ok: z.boolean().optional(),
			full: z.boolean().optional(),
			measuredAt: z.string().optional(),
		}),
	),
});
export type CoverageMeta = z.infer<typeof coverageMetaSchema>;

/** A failed test, with where it went: the screen links each frame to that file and line. */
export const testFailureSchema = z.object({ file: z.string(), name: z.string(), error: testErrorSchema });
export type TestFailure = z.infer<typeof testFailureSchema>;
export const specResultSchema = z.object({
	file: z.string(),
	tests: z.array(z.object({ name: z.string(), state: z.string(), ms: z.number() })),
});
export type SpecResult = z.infer<typeof specResultSchema>;

/** The test files that sit beside a source file: `x.spec.ts` / `x.test.ts` there, or in its package's `test/`. */
export function specsFor(path: string, report: TestsReport): SpecResult[] {
	const base = path.replace(/\.[cm]?[jt]sx?$/, '');
	const name = base.split('/').pop() as string;
	const pkg = /^((?:apps|packages)\/[^/]+)\//.exec(path)?.[1];
	return report.files
		.filter((f) => {
			const b = f.file.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '');
			return b === base || (!!pkg && f.file.startsWith(`${pkg}/test/`) && b.split('/').pop() === name);
		})
		.map((f) => ({ file: f.file, tests: f.tests.map((t) => ({ name: t.name, state: t.state, ms: t.ms })) }));
}
/** Failed tests that went through a file, or live in one of its test files. */
export function failuresFor(
	path: string,
	report: TestsReport,
	specs: readonly SpecResult[] = specsFor(path, report),
): TestFailure[] {
	const own = new Set(specs.map((s) => s.file));
	const out: TestFailure[] = [];
	for (const f of report.files) {
		for (const e of f.errors)
			if (own.has(f.file) || e.frames.some((x) => x.file === path))
				out.push({ file: f.file, name: '(the whole file)', error: e });
		for (const t of f.tests)
			for (const e of t.errors)
				if (own.has(f.file) || e.frames.some((x) => x.file === path))
					out.push({ file: f.file, name: t.name, error: e });
	}
	return out;
}
/** A run's test totals and its slowest test files. */
export function testTotals(report: TestsReport, slowest = 10) {
	const tests = report.files.flatMap((f) => f.tests);
	return {
		passed: tests.filter((t) => t.state === 'passed').length,
		failed: tests.filter((t) => t.state === 'failed').length + report.files.filter((f) => f.errors.length).length,
		skipped: tests.filter((t) => t.state === 'skipped' || t.state === 'pending').length,
		slowest: [...report.files]
			.sort((a, b) => b.ms - a.ms)
			.slice(0, slowest)
			.map((f) => ({ file: f.file, ms: f.ms })),
	};
}

/* ===== What the API answers ===== */

export const coverageSourceSchema = z.enum(['ci', 'mac']);
export type CoverageSource = z.infer<typeof coverageSourceSchema>;
/** The runs the screen can open: CI runs of a branch that kept their reports, and this Mac's latest. */
export const coverageRunsSchema = z.object({
	ci: z.array(
		z.object({
			id: z.string(),
			sha: z.string(),
			ref: z.string(),
			title: z.string(),
			finishedAt: z.string().nullable(),
			state: z.enum(['passed', 'failed', 'running', 'no-reports']),
			url: z.string(),
		}),
	),
	ciMessage: z.string().nullable(),
	mac: z.object({ sha: z.string(), ref: z.string(), finishedAt: z.string(), uncommitted: z.boolean() }).nullable(),
	macMessage: z.string().nullable(),
});
export type CoverageRuns = z.infer<typeof coverageRunsSchema>;
const totalsSchema = z.object({
	passed: z.number(),
	failed: z.number(),
	skipped: z.number(),
	slowest: z.array(z.object({ file: z.string(), ms: z.number() })),
});
/** One run's whole tree with every folder's sums, its workspaces and tests, and the changed lines if asked. */
export const coverageTreeAnswerSchema = z.object({
	source: coverageSourceSchema,
	run: z.string(),
	sha: z.string(),
	ref: z.string(),
	finishedAt: z.string(),
	uncommitted: z.boolean(),
	tree: coverageNodeSchema,
	workspaces: z.array(
		z.object({
			name: z.string(),
			dir: z.string(),
			passed: z.boolean(),
			failed: z.number(),
			measuredAt: z.string().nullable(),
		}),
	),
	tests: totalsSchema,
	changed: z.object({ label: z.string(), files: z.array(patchFileSchema) }).nullable(),
});
export type CoverageTreeAnswer = z.infer<typeof coverageTreeAnswerSchema>;
/** One file: its text and lines, its gaps, its tests and failures, and its changed lines if asked. */
export const coverageFileAnswerSchema = z.object({
	path: z.string(),
	sha: z.string(),
	counts: countsSchema.nullable(),
	text: z.array(z.string()),
	lines: z.array(coverageLineSchema),
	gaps: z.array(coverageGapSchema),
	specs: z.array(specResultSchema),
	failures: z.array(testFailureSchema),
	changed: z.array(z.number()),
	note: z.string().nullable(),
});
export type CoverageFileAnswer = z.infer<typeof coverageFileAnswerSchema>;
