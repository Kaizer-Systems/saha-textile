import { type VendorAnswer } from '@saha-textile/release-console-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectsService } from '../projects/projects.service.js';
import type { VendorReadsService } from '../projects/vendor-reads.service.js';
import { HelperError } from '../runner/runner-client.js';
import type { CoverageHttp } from './coverage-github.js';
import { CoverageService, assemble } from './coverage.service.js';

const REPO = 'Kaizer-Systems/saha-textile';
const ROOT = '/home/runner/work/saha-textile/saha-textile';

/** A zip with stored entries. */
function storedZip(entries: Record<string, string>): Buffer {
	const parts: Buffer[] = [];
	const dir: Buffer[] = [];
	let at = 0;
	for (const [n, d] of Object.entries(entries)) {
		const name = Buffer.from(n);
		const data = Buffer.from(d);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(name.length, 26);
		parts.push(local, name, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(at, 42);
		dir.push(central, name);
		at += 30 + name.length + data.length;
	}
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(at, 16);
	return Buffer.concat([...parts, ...dir, end]);
}

const r = (sl: number, el: number) => ({ start: { line: sl, column: 0 }, end: { line: el, column: 10 } });
/** pick.ts: line 1 ran, line 2 never ran. */
const pickCoverage = (root: string) => ({
	[`${root}/apps/admin/src/pick.ts`]: {
		path: `${root}/apps/admin/src/pick.ts`,
		statementMap: { '0': r(1, 1), '1': r(2, 2) },
		fnMap: {},
		branchMap: {},
		s: { '0': 3, '1': 0 },
		f: {},
		b: {},
	},
	broken: { path: 1 },
});
const PICK = 'const a = 1;\nreturn none;\n';
const meta = (root: string, extra: Record<string, unknown> = {}) => ({
	root,
	sha: 'abcdef1234',
	ref: 'feat/combined-after-pr6',
	runId: '7',
	uncommitted: false,
	finishedAt: '2026-11-24T02:00:00Z',
	floor: 10,
	workspaces: {
		admin: { dir: 'apps/admin', passed: false, ok: true, full: false, measuredAt: '2026-11-24T01:59:00Z' },
		api: { dir: 'apps/api' },
	},
	...extra,
});
const tests = {
	files: [
		{
			file: 'apps/admin/src/pick.spec.ts',
			state: 'failed',
			ms: 20,
			tests: [{ name: 'pick > sizes', state: 'failed', ms: 4, errors: [{ message: 'no', frames: [] }] }],
		},
	],
};

function stand(
	opts: {
		reads?: 'ok' | 'not-connected';
		zip?: Buffer;
		text?: Record<string, string | null>;
		mac?: unknown;
		macRepo?: string | null;
	} = {},
) {
	const zip =
		opts.zip ??
		storedZip({
			'meta.json': JSON.stringify(meta(ROOT)),
			'admin/coverage-final.json': JSON.stringify(pickCoverage(ROOT)),
			'admin/tests.json': JSON.stringify(tests),
			'api/tests.json': '{"wrong":true}',
		});
	const http: CoverageHttp = {
		json: vi.fn(async (url: string) => {
			const body: unknown = url.includes('/actions/artifacts?name=coverage')
				? { artifacts: [{ id: 3, workflow_run: { id: 7 } }] }
				: url.includes('/actions/runs?per_page')
					? {
							workflow_runs: [
								{
									id: 7,
									workflow_id: 1,
									status: 'completed',
									conclusion: 'success',
									head_sha: 'abcdef1234',
								},
							],
						}
					: /\/runs\/\d+\/artifacts/.test(url)
						? { artifacts: [{ id: 3 }] }
						: url.includes('/git/trees/')
							? {
									tree: [
										{ type: 'blob', path: 'apps/admin/src/pick.ts' },
										{ type: 'blob', path: 'apps/admin/src/pick.html' },
										{ type: 'blob', path: 'README.md' },
									],
								}
							: url.includes('/commits/')
								? {
										files: [
											{
												filename: 'apps/admin/src/pick.ts',
												patch: '@@ -0,0 +1,3 @@\n+a\n+b\n+c',
											},
											{ filename: 'README.md', patch: '@@ -1 +1 @@\n+x' },
										],
									}
								: url.includes('/compare/')
									? { files: [] }
									: null;
			return { status: body ? 200 : 404, headers: new Headers(), body };
		}),
		bytes: vi.fn(async () => ({ status: 200, body: zip })),
		text: vi.fn(async (url: string) => {
			const path = decodeURIComponent(url.split('/contents/')[1]!.split('?')[0]!);
			const t = (opts.text ?? { 'apps/admin/src/pick.ts': PICK })[path];
			return t === undefined || t === null ? { status: 404, body: null } : { status: 200, body: t };
		}),
	};
	const reads = {
		sourceCode: vi.fn(
			async <T>(
				_p: string,
				_r: string,
				read: (repo: string, key: string) => Promise<T>,
			): Promise<VendorAnswer<T>> =>
				opts.reads === 'not-connected'
					? { state: 'not-connected', message: 'GitHub is not connected for this repository.' }
					: { state: 'ok', readAt: 'now', data: await read(REPO, 'key') },
		),
	};
	const projects = {
		repository: () => ({ project: {}, repo: { name: 'saha-textile', sourceCode: { repository: REPO } } }),
	};
	const service = new CoverageService(reads as unknown as VendorReadsService, projects as unknown as ProjectsService);
	service.http = http;
	const macRoot = '/Users/me/saha-textile';
	const call = vi.fn(async (_m: string, path: string): Promise<unknown> => {
		if (path === '/coverage/meta')
			return opts.mac === 'off'
				? { off: true, message: 'This copy has no coverage reports yet.' }
				: opts.mac === 'empty'
					? { off: true }
					: {
							data: {
								repository: opts.macRepo === undefined ? REPO : opts.macRepo,
								meta: opts.mac ?? meta(macRoot, { uncommitted: true, runId: null }),
								workspaces: [
									{ name: 'admin', measuredAt: '2026-11-24T01:00:00Z' },
									{ name: 'api', measuredAt: '2026-11-24T01:30:00Z' },
								],
							},
						};
		if (path === '/health') return { root: macRoot };
		if (path.startsWith('/coverage/report?ws=admin&part=final')) return { data: pickCoverage(macRoot) };
		if (path.startsWith('/coverage/report?ws=admin&part=tests')) return { data: tests };
		if (path.startsWith('/coverage/report')) return { data: null };
		if (path === '/coverage/files') return { data: ['apps/admin/src/pick.ts'] };
		if (path.startsWith('/coverage/text')) return { data: path.includes('pick.ts') ? PICK : null };
		if (path.startsWith('/coverage/diff?base=commit')) return { data: { 'apps/admin/src/pick.ts': [2] } };
		if (path.startsWith('/coverage/diff')) return {};
		throw new Error(`unexpected ${path}`);
	});
	service.helper = { call: call as never };
	return { service, http, reads, call };
}

describe('the coverage runs', () => {
	it('lists the CI runs with reports and this Mac’s latest run', async () => {
		const { service } = stand();
		const runs = await service.list('p', 'r');
		expect(runs.ci.map((x) => [x.id, x.state])).toEqual([['7', 'passed']]);
		expect(runs.mac).toEqual({
			sha: 'abcdef1234',
			ref: 'feat/combined-after-pr6',
			finishedAt: '2026-11-24T02:00:00Z',
			uncommitted: true,
		});
		expect(runs.macMessage).toBeNull();
	});

	it('says why GitHub or this Mac has nothing to show', async () => {
		const runs = await stand({ reads: 'not-connected', mac: 'off' }).service.list('p', 'r');
		expect(runs).toEqual({
			ci: [],
			ciMessage: 'GitHub is not connected for this repository.',
			mac: null,
			macMessage: 'This copy has no coverage reports yet.',
		});
		expect((await stand({ mac: 'empty' }).service.list('p', 'r')).macMessage).toBe(
			'This copy has no coverage reports yet.',
		);
		expect((await stand({ macRepo: 'someone/else' }).service.list('p', 'r')).macMessage).toBe(
			'The Mac helper runs in a copy of someone/else, not of this repository.',
		);
	});

	it('shows a run from before meta.json by its newest workspace, as uncommitted', async () => {
		expect((await stand({ mac: { old: true }, macRepo: null }).service.list('p', 'r')).mac).toEqual({
			sha: '',
			ref: '',
			finishedAt: '2026-11-24T01:30:00Z',
			uncommitted: true,
		});
		const { service, call } = stand({ mac: { old: true } });
		call.mockImplementation(async (_m: string, path: string) =>
			path === '/coverage/meta' ? { data: { repository: REPO, meta: null, workspaces: [] } } : null,
		);
		expect((await service.list('p', 'r')).mac?.finishedAt).toBe('');
		call.mockImplementation(async (_m: string, path: string) =>
			path === '/coverage/meta'
				? {
						data: {
							repository: REPO,
							meta: null,
							workspaces: [
								{ name: 'b', measuredAt: '2026-11-24T01:30:00Z' },
								{ name: 'a', measuredAt: '2026-11-24T01:00:00Z' },
							],
						},
					}
				: null,
		);
		expect((await service.list('p', 'r')).mac?.finishedAt).toBe('2026-11-24T01:30:00Z');
	});
});

describe('one run as a tree', () => {
	it('adds up a CI run over the commit’s files, with workspaces, tests and the commit’s changed lines', async () => {
		const { service } = stand();
		const a = await service.tree('p', 'r', 'ci', '7', 'commit');
		expect(a.state).toBe('ok');
		if (a.state !== 'ok') return;
		expect(a.data.tree).toMatchObject({ n: 'saha-textile', c: [1, 2, 0, 0, 0, 0, 1, 2] });
		expect(a.data.tree.k?.map((k) => k.n)).toEqual(['apps', 'README.md']);
		expect(a.data.workspaces).toEqual([
			{ name: 'admin', dir: 'apps/admin', passed: false, failed: 1, measuredAt: '2026-11-24T01:59:00Z' },
			{ name: 'api', dir: 'apps/api', passed: true, failed: 0, measuredAt: null },
		]);
		expect(a.data.tests).toMatchObject({ passed: 0, failed: 1 });
		expect(a.data.changed).toEqual({
			label: 'commit abcdef12',
			files: [{ path: 'apps/admin/src/pick.ts', run: [1], missed: [2] }],
		});
		const since = await service.tree('p', 'r', 'ci', '7', 'dev');
		expect(since.state === 'ok' && since.data.changed).toEqual({ label: 'since dev', files: [] });
		const plain = await service.tree('p', 'r', 'ci', '7');
		expect(plain.state === 'ok' && plain.data.changed).toBeNull();
	});

	it('reads this Mac’s run through the helper, with or without its description', async () => {
		const { service } = stand();
		const a = await service.tree('p', 'r', 'mac', 'mac', 'commit');
		expect(a.state === 'ok' && [a.data.uncommitted, a.data.tree.c, a.data.changed?.files]).toEqual([
			true,
			[1, 2, 0, 0, 0, 0, 1, 2],
			[{ path: 'apps/admin/src/pick.ts', run: [], missed: [2] }],
		]);
		const old = await stand({ mac: { old: true } }).service.tree('p', 'r', 'mac', 'mac', 'dev');
		expect(
			old.state === 'ok' && [
				old.data.sha,
				old.data.finishedAt,
				old.data.workspaces.map((w) => w.name),
				old.data.changed?.files,
			],
		).toEqual(['', '2026-11-24T01:30:00Z', ['admin', 'api'], []]);
	});

	it('reads a run once, again after a failure, and keeps only the last three', async () => {
		const { service, http } = stand();
		await service.tree('p', 'r', 'ci', '7');
		await service.tree('p', 'r', 'ci', '7');
		expect(http.bytes).toHaveBeenCalledTimes(1);
		for (const run of ['8', '9', '10']) await service.tree('p', 'r', 'ci', run);
		await service.tree('p', 'r', 'ci', '7');
		expect(http.bytes).toHaveBeenCalledTimes(5);
		vi.mocked(http.bytes).mockResolvedValueOnce({ status: 500, body: null });
		expect(await service.tree('p', 'r', 'ci', '11')).toEqual({
			state: 'error',
			message: 'GitHub could not show this run’s reports (status 500).',
		});
		expect((await service.tree('p', 'r', 'ci', '11')).state).toBe('ok');
	});

	it('says why a run cannot be read', async () => {
		expect(await stand({ reads: 'not-connected' }).service.tree('p', 'r', 'ci', '7')).toEqual({
			state: 'error',
			message: 'GitHub is not connected for this repository.',
		});
		expect(await stand({ mac: 'off' }).service.tree('p', 'r', 'mac', 'mac')).toEqual({
			state: 'error',
			message: 'This copy has no coverage reports yet.',
		});
		expect(
			await stand({ zip: storedZip({ 'admin/coverage-final.json': '{}' }) }).service.tree('p', 'r', 'ci', '7'),
		).toEqual({
			state: 'error',
			message: 'This run’s reports have no description (meta.json), so the console cannot place them.',
		});
		const empty = stand();
		empty.call.mockImplementation(async (m: string, path: string) =>
			path === '/coverage/files' ? {} : stand().service.helper.call(m as 'GET', path),
		);
		const noFiles = await empty.service.tree('p', 'r', 'mac', 'mac');
		expect(noFiles.state === 'ok' && noFiles.data.tree.k).toEqual([]);
		expect(
			await stand({ zip: Buffer.from('not a zip, long enough to be searched for an end') }).service.tree(
				'p',
				'r',
				'ci',
				'7',
			),
		).toEqual({
			state: 'error',
			message: 'The coverage reports could not be read: The coverage reports are not a zip archive.',
		});
	});
});

describe('one file', () => {
	it('gives a measured file’s lines, gaps, tests, failures and changed lines', async () => {
		const { service } = stand();
		const a = await service.file('p', 'r', 'ci', '7', 'apps/admin/src/pick.ts', 'commit');
		expect(a.state).toBe('ok');
		if (a.state !== 'ok') return;
		expect(a.data.lines.map((l) => l.c)).toEqual(['run', 'miss']);
		expect(a.data.gaps).toEqual([{ kind: 'miss', from: 2, to: 2, say: 'never ran', code: 'return none;' }]);
		expect(a.data.specs.map((s) => s.file)).toEqual(['apps/admin/src/pick.spec.ts']);
		expect(a.data.failures.map((f) => f.name)).toEqual(['pick > sizes']);
		expect(a.data.changed).toEqual([1, 2, 3]);
		expect(a.data.counts).toEqual([1, 2, 0, 0, 0, 0, 1, 2]);
		expect(a.data.note).toBeNull();
		const other = await service.file('p', 'r', 'ci', '7', 'README.md', 'dev');
		expect(other.state === 'ok' && other.data.changed).toEqual([]);
	});

	it('says when a file is not measured, missing, changed since the run or from a copy with changes', async () => {
		const { service } = stand({
			text: { 'apps/admin/src/pick.ts': 'const a = 1;', 'README.md': '# Saha Textile\n' },
		});
		const note = async (source: 'ci' | 'mac', path: string) => {
			const a = await service.file('p', 'r', source, source === 'ci' ? '7' : 'mac', path);
			return a.state === 'ok' ? a.data.note : a.message;
		};
		expect(await note('ci', 'README.md')).toMatch(/^Not measured/);
		expect(await note('ci', 'gone.ts')).toBe('This file is not in the measured copy.');
		expect(await note('ci', 'apps/admin/src/pick.ts')).toMatch(/^This file changed after the run/);
		expect(await note('mac', 'apps/admin/src/pick.ts')).toBe(
			'This copy had uncommitted changes when it was measured.',
		);
		expect(await note('mac', 'gone.ts')).toBe('This file is not in the measured copy.');
		const readme = await service.file('p', 'r', 'ci', '7', 'README.md');
		expect(readme.state === 'ok' && readme.data.lines).toEqual([{ h: null, c: 'none', notes: [] }]);
	});

	it('says why a file or its changes cannot be read', async () => {
		const { service, reads } = stand();
		await service.tree('p', 'r', 'ci', '7');
		reads.sourceCode.mockResolvedValueOnce({ state: 'error', message: 'GitHub said no.' });
		expect(await service.file('p', 'r', 'ci', '7', 'apps/admin/src/pick.ts')).toEqual({
			state: 'error',
			message: 'GitHub said no.',
		});
		reads.sourceCode.mockImplementationOnce(
			async (_p: string, _r: string, read: (a: string, b: string) => Promise<unknown>) => ({
				state: 'ok',
				readAt: '',
				data: await read(REPO, 'key'),
			}),
		);
		reads.sourceCode.mockResolvedValueOnce({ state: 'not-connected', message: 'No key.' });
		expect(await service.file('p', 'r', 'ci', '7', 'apps/admin/src/pick.ts', 'commit')).toEqual({
			state: 'error',
			message: 'No key.',
		});
		const mac = stand();
		mac.call.mockImplementation(async () => {
			throw new HelperError('The Mac helper is not answering.', 503);
		});
		expect(await mac.service.file('p', 'r', 'mac', 'mac', 'a.ts')).toEqual({
			state: 'error',
			message: 'The Mac helper is not answering.',
		});
	});
});

describe('assembling reports', () => {
	it('skips reports and entries it cannot read', () => {
		const run = assemble(
			meta(ROOT) as never,
			[null, 'text', pickCoverage(ROOT)],
			[
				['admin', tests],
				['api', { files: 'no' }],
			],
			[],
			false,
		);
		expect([...run.files.keys()]).toEqual(['apps/admin/src/pick.ts']);
		expect([...run.failedByWorkspace]).toEqual([['admin', 1]]);
	});
});
