import { Inject, Injectable } from '@nestjs/common';
import {
	type CoverageFileAnswer,
	type CoverageLine,
	type CoverageMeta,
	type CoverageRuns,
	type CoverageSource,
	type CoverageTreeAnswer,
	type Counts,
	type IstanbulFile,
	type TestsReport,
	type VendorAnswer,
	coverageGaps,
	coverageLines,
	coverageMetaSchema,
	coverageTree,
	failuresFor,
	fileCounts,
	istanbulFileSchema,
	patchFile,
	repoPath,
	specsFor,
	testTotals,
	testsReportSchema,
} from '@saha-textile/release-console-contracts';

import { ProjectsService } from '../projects/projects.service.js';
import { VendorReadsService } from '../projects/vendor-reads.service.js';
import { HelperError, RunnerClient } from '../runner/runner-client.js';
import { VendorError } from '../vendors/http.js';
import { type CoverageHttp, changedOnGithub, ciReports, ciRuns, committedFiles, coverageHttp, fileAt } from './coverage-github.js';

/** One run, read and added up once; what the screen asks of it after that is answered from memory. */
interface LoadedRun {
	meta: CoverageMeta;
	files: Map<string, IstanbulFile>;
	counts: Map<string, Counts>;
	tests: TestsReport;
	failedByWorkspace: Map<string, number>;
	paths: string[];
	truncated: boolean;
}
type HelperAnswer<T> = { off?: boolean; message?: string; data?: T };
interface MacMeta {
	repository: string | null;
	meta: unknown;
	workspaces: { name: string; measuredAt: string }[];
}

/** How many runs stay read at once (a run is about 25 MB of reports). */
const KEEP = 3;
const ok = <T>(data: T): VendorAnswer<T> => ({ state: 'ok', readAt: new Date().toISOString(), data });
const failed = (err: unknown): VendorAnswer<never> => ({
	state: 'error',
	message:
		err instanceof VendorError || err instanceof HelperError
			? err.message
			: `The coverage reports could not be read: ${(err as Error).message}`,
});

/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23, approved 24 Nov 2026): a CI run's reports, or
 * this Mac's latest `pnpm coverage`, as the committed tree with every folder's sums, and one file at a time
 * with its lines, gaps, tests and failures.
 */
@Injectable()
export class CoverageService {
	/** GitHub and the Mac helper; tests put stand-ins here. */
	http: CoverageHttp = coverageHttp;
	helper: Pick<RunnerClient, 'call'> = new RunnerClient();
	private readonly runs = new Map<string, Promise<LoadedRun>>();

	// Injected by token with narrow types: only what Coverage uses.
	constructor(
		@Inject(VendorReadsService) private readonly reads: Pick<VendorReadsService, 'sourceCode'>,
		@Inject(ProjectsService) private readonly projects: Pick<ProjectsService, 'repository'>,
	) {}

	/** The CI runs with reports, and this Mac's latest run when it belongs to this repository. */
	async list(p: string, r: string): Promise<CoverageRuns> {
		const { repo } = this.projects.repository(p, r);
		const ci = await this.reads.sourceCode(p, r, (repository, key) => ciRuns(this.http, repository, key));
		const mac = await this.macMeta()
			.then((m) => {
				if (m.repository && repo.sourceCode.repository && m.repository !== repo.sourceCode.repository)
					return { mac: null, macMessage: `The Mac helper runs in a copy of ${m.repository}, not of this repository.` };
				const meta = coverageMetaSchema.safeParse(m.meta);
				return meta.success
					? { mac: { sha: meta.data.sha, ref: meta.data.ref, finishedAt: meta.data.finishedAt, uncommitted: meta.data.uncommitted }, macMessage: null }
					: { mac: { sha: '', ref: '', finishedAt: newest(m.workspaces), uncommitted: true }, macMessage: null };
			})
			.catch((err: unknown) => ({ mac: null, macMessage: (err as Error).message }));
		return ci.state === 'ok'
			? { ...ci.data, ...mac }
			: { ci: [], ciMessage: ci.message, ...mac };
	}

	/** The whole tree of one run; `base` adds the lines a change touched ('commit', or a branch). */
	async tree(p: string, r: string, source: CoverageSource, run: string, base?: string): Promise<VendorAnswer<CoverageTreeAnswer>> {
		try {
			const loaded = await this.load(p, r, source, run);
			const { repo } = this.projects.repository(p, r);
			const tests = testTotals(loaded.tests);
			const changed = base ? await this.changed(p, r, source, loaded, base) : null;
			return ok({
				source,
				run,
				sha: loaded.meta.sha,
				ref: loaded.meta.ref,
				finishedAt: loaded.meta.finishedAt,
				uncommitted: loaded.meta.uncommitted,
				tree: coverageTree(loaded.paths, loaded.counts, repo.name),
				workspaces: Object.entries(loaded.meta.workspaces).map(([name, w]) => ({
					name,
					dir: w.dir,
					passed: w.passed ?? true,
					failed: loaded.failedByWorkspace.get(name) ?? 0,
					measuredAt: w.measuredAt ?? null,
				})),
				tests,
				changed: changed && {
					label: base === 'commit' ? `commit ${loaded.meta.sha.slice(0, 8)}` : `since ${base}`,
					files: [...changed]
						.filter(([path]) => loaded.files.has(path))
						.map(([path, lines]) => {
							const file = loaded.files.get(path) as IstanbulFile;
							return patchFile(path, lines, coverageLines(file, blankLines(file, lines)));
						}),
				},
			});
		} catch (err) {
			return failed(err);
		}
	}

	/** One file of a run: text, lines, gaps, tests beside it and failures through it. */
	async file(p: string, r: string, source: CoverageSource, run: string, path: string, base?: string): Promise<VendorAnswer<CoverageFileAnswer>> {
		try {
			const loaded = await this.load(p, r, source, run);
			const raw = await this.text(p, r, source, loaded.meta.sha, path);
			const text = raw === null ? [] : raw.replace(/\n$/, '').split('\n');
			const file = loaded.files.get(path);
			const lines: CoverageLine[] = file ? coverageLines(file, text) : text.map(() => ({ h: null, c: 'none', notes: [] }));
			const specs = specsFor(path, loaded.tests);
			const changed = base ? ((await this.changed(p, r, source, loaded, base)).get(path) ?? []) : [];
			const last = file ? Math.max(0, ...Object.values(file.statementMap).map((s) => s.end.line)) : 0;
			return ok({
				path,
				sha: loaded.meta.sha,
				counts: loaded.counts.get(path) ?? null,
				text,
				lines,
				gaps: coverageGaps(lines, text),
				specs,
				failures: failuresFor(path, loaded.tests, specs),
				changed,
				note:
					raw === null
						? 'This file is not in the measured copy.'
						: last > text.length
							? 'This file changed after the run, so its lines may have moved. Run its tests again to see them where they are now.'
							: source === 'mac' && loaded.meta.uncommitted
								? 'This copy had uncommitted changes when it was measured.'
								: !file
									? 'Not measured: this file has no code the tests run (styles, templates, data, docs or settings).'
									: null,
			});
		} catch (err) {
			return failed(err);
		}
	}

	/* ===== reading a run ===== */

	private load(p: string, r: string, source: CoverageSource, run: string): Promise<LoadedRun> {
		const key = `${p}/${r}/${source}/${run}`;
		const hit = this.runs.get(key);
		if (hit) return hit;
		const loading = (source === 'ci' ? this.loadCi(p, r, run) : this.loadMac()).catch((err: unknown) => {
			this.runs.delete(key);
			throw err;
		});
		this.runs.set(key, loading);
		while (this.runs.size > KEEP) this.runs.delete(this.runs.keys().next().value as string);
		return loading;
	}

	private async loadCi(p: string, r: string, run: string): Promise<LoadedRun> {
		const answer = await this.reads.sourceCode(p, r, async (repository, key) => {
			const files = await ciReports(this.http, repository, key, run);
			const described = files.get('meta.json');
			if (!described)
				throw new VendorError('This run’s reports have no description (meta.json), so the console cannot place them.', 400);
			const meta = coverageMetaSchema.parse(JSON.parse(String(described)));
			const listed = await committedFiles(this.http, repository, key, meta.sha);
			const json = (name: string) => JSON.parse(String(files.get(name))) as unknown;
			const names = [...files.keys()];
			return assemble(
				meta,
				names.filter((n) => n.endsWith('/coverage-final.json')).map((n) => json(n)),
				names.filter((n) => n.endsWith('/tests.json')).map((n) => [n.split('/')[0] as string, json(n)] as const),
				listed.files,
				listed.truncated,
			);
		});
		if (answer.state !== 'ok') throw new VendorError(answer.message, 400);
		return answer.data;
	}

	private async loadMac(): Promise<LoadedRun> {
		const m = await this.macMeta();
		const health = await this.helper.call<{ root: string }>('GET', '/health');
		const parsed = coverageMetaSchema.safeParse(m.meta);
		const meta: CoverageMeta = parsed.success
			? parsed.data
			: {
					root: health.root,
					sha: '',
					ref: '',
					runId: null,
					uncommitted: true,
					finishedAt: newest(m.workspaces),
					floor: 0,
					workspaces: Object.fromEntries(m.workspaces.map((w) => [w.name, { dir: '', measuredAt: w.measuredAt }])),
				};
		const report = async (ws: string, part: 'final' | 'tests') =>
			(await this.helper.call<HelperAnswer<unknown>>('GET', `/coverage/report?ws=${encodeURIComponent(ws)}&part=${part}`, undefined, 60_000)).data;
		const finals = await Promise.all(m.workspaces.map((w) => report(w.name, 'final')));
		const tests = await Promise.all(m.workspaces.map(async (w) => [w.name, await report(w.name, 'tests')] as const));
		const files = (await this.helper.call<HelperAnswer<string[]>>('GET', '/coverage/files')).data ?? [];
		return assemble({ ...meta, root: health.root }, finals, tests, files, false);
	}

	private async macMeta(): Promise<MacMeta> {
		const a = await this.helper.call<HelperAnswer<MacMeta>>('GET', '/coverage/meta');
		if (a.off || !a.data) throw new HelperError(a.message ?? 'This copy has no coverage reports yet.', 404);
		return a.data;
	}

	private async text(p: string, r: string, source: CoverageSource, sha: string, path: string): Promise<string | null> {
		if (source === 'mac')
			return (await this.helper.call<HelperAnswer<string | null>>('GET', `/coverage/text?path=${encodeURIComponent(path)}`)).data ?? null;
		const a = await this.reads.sourceCode(p, r, (repository, key) => fileAt(this.http, repository, key, sha, path));
		if (a.state !== 'ok') throw new VendorError(a.message, 400);
		return a.data;
	}

	private async changed(p: string, r: string, source: CoverageSource, loaded: LoadedRun, base: string): Promise<Map<string, number[]>> {
		if (source === 'mac') {
			const a = await this.helper.call<HelperAnswer<Record<string, number[]>>>('GET', `/coverage/diff?base=${encodeURIComponent(base)}`);
			return new Map(Object.entries(a.data ?? {}));
		}
		const a = await this.reads.sourceCode(p, r, (repository, key) => changedOnGithub(this.http, repository, key, loaded.meta.sha, base));
		if (a.state !== 'ok') throw new VendorError(a.message, 400);
		return a.data;
	}
}

/** When the newest workspace of this Mac's run was measured ('' when none was). */
function newest(workspaces: { measuredAt: string }[]): string {
	return workspaces.reduce((a, w) => (w.measuredAt > a ? w.measuredAt : a), '');
}

/** A file's lines as empty text, long enough for its statements and the changed lines (classes need no text). */
function blankLines(file: IstanbulFile, changed: readonly number[]): string[] {
	const last = Math.max(0, ...changed, ...Object.values(file.statementMap).map((s) => s.end.line));
	return new Array<string>(last).fill('');
}

/** Reports to one run: line data by repository path with its counts, and all test files together. */
export function assemble(
	meta: CoverageMeta,
	finals: unknown[],
	tests: (readonly [string, unknown])[],
	paths: string[],
	truncated: boolean,
): LoadedRun {
	const files = new Map<string, IstanbulFile>();
	const counts = new Map<string, Counts>();
	for (const report of finals) {
		if (!report || typeof report !== 'object') continue;
		for (const entry of Object.values(report)) {
			const f = istanbulFileSchema.safeParse(entry);
			if (!f.success) continue;
			const path = repoPath(f.data.path, meta.root);
			files.set(path, f.data);
			counts.set(path, fileCounts(f.data));
		}
	}
	const merged: TestsReport = { files: [] };
	const failedByWorkspace = new Map<string, number>();
	for (const [ws, report] of tests) {
		const t = testsReportSchema.safeParse(report);
		if (!t.success) continue;
		merged.files.push(...t.data.files);
		failedByWorkspace.set(ws, testTotals(t.data).failed);
	}
	return { meta, files, counts, tests: merged, failedByWorkspace, paths, truncated };
}
