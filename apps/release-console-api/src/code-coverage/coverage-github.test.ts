import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	type CoverageHttp,
	changedOnGithub,
	ciReports,
	ciRuns,
	committedFiles,
	coverageHttp,
	fileAt,
} from './coverage-github.js';

const REPO = 'Kaizer-Systems/saha-textile';

/** A zip with stored entries, as small as a test needs. */
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

/** GitHub as a table of answers: the longest URL part that matches wins. */
function github(
	routes: Record<string, { status: number; body?: unknown }>,
	files: Record<string, { status: number; body: Buffer | string | null }> = {},
) {
	const pick = <T>(table: Record<string, T>, url: string) =>
		Object.keys(table)
			.filter((k) => url.includes(k))
			.sort((a, b) => b.length - a.length)[0];
	const http: CoverageHttp = {
		json: vi.fn(async (url: string) => {
			const k = pick(routes, url);
			return {
				status: k ? routes[k]!.status : 404,
				headers: new Headers(),
				body: k ? (routes[k]!.body ?? null) : null,
			};
		}),
		bytes: vi.fn(async (url: string) => {
			const k = pick(files, url);
			return { status: k ? files[k]!.status : 404, body: k ? (files[k]!.body as Buffer | null) : null };
		}),
		text: vi.fn(async (url: string) => {
			const k = pick(files, url);
			return { status: k ? files[k]!.status : 404, body: k ? (files[k]!.body as string | null) : null };
		}),
	};
	return http;
}

const run = (id: number, workflow: number, status: string, conclusion: string | null, title = `CI ${id}`) => ({
	id,
	workflow_id: workflow,
	head_sha: `sha${id}`,
	head_branch: 'feat/combined-after-pr6',
	display_title: title,
	name: 'CI',
	status,
	conclusion,
	updated_at: `2026-11-24T0${id}:00:00Z`,
	html_url: `https://github.com/${REPO}/actions/runs/${id}`,
});

describe('coverage runs on GitHub', () => {
	it('lists the runs of the workflows that keep reports, with each run’s state', async () => {
		const http = github({
			'/actions/artifacts?name=coverage': {
				status: 200,
				body: {
					artifacts: [
						{ id: 1, expired: false, workflow_run: { id: 1 } },
						{ id: 2, expired: false, workflow_run: { id: 2 } },
						{ id: 3, expired: true, workflow_run: { id: 3 } },
					],
				},
			},
			'/actions/runs?per_page=40': {
				status: 200,
				body: {
					workflow_runs: [
						run(5, 10, 'in_progress', null),
						run(1, 10, 'completed', 'success'),
						run(2, 10, 'completed', 'failure', ''),
						run(3, 10, 'completed', 'success'),
						{ ...run(6, 10, 'completed', 'success'), updated_at: '' },
						run(4, 20, 'completed', 'success'),
					],
				},
			},
		});
		const { ci, ciMessage } = await ciRuns(http, REPO, 'key');
		expect(ciMessage).toBeNull();
		expect(ci.map((r) => [r.id, r.state, r.finishedAt])).toEqual([
			['5', 'running', null],
			['1', 'passed', '2026-11-24T01:00:00Z'],
			['2', 'failed', '2026-11-24T02:00:00Z'],
			['3', 'no-reports', '2026-11-24T03:00:00Z'],
			['6', 'no-reports', null],
		]);
		expect(ci[2]?.title).toBe('CI');
		expect(ci[1]).toMatchObject({
			sha: 'sha1',
			ref: 'feat/combined-after-pr6',
			url: `https://github.com/${REPO}/actions/runs/1`,
		});
	});

	it('says when no run has kept reports yet, and when GitHub refuses', async () => {
		const none = github({
			'/actions/artifacts?name=coverage': { status: 200, body: { artifacts: [] } },
			'/actions/runs?per_page=40': { status: 200, body: { workflow_runs: [run(1, 10, 'completed', 'success')] } },
		});
		expect((await ciRuns(none, REPO, 'key')).ciMessage).toMatch(/No CI run has kept coverage reports yet/);
		await expect(ciRuns(github({ '/actions/artifacts': { status: 401 } }), REPO, 'key')).rejects.toThrow(
			'GitHub did not accept this repository’s key',
		);
		await expect(ciRuns(github({ '/actions/artifacts': { status: 403 } }), REPO, 'key')).rejects.toThrow(
			'GitHub would not show the coverage reports. The key needs Actions and Contents read access',
		);
		await expect(ciRuns(github({ '/actions/artifacts': { status: 500 } }), REPO, 'key')).rejects.toThrow(
			'GitHub could not show the coverage reports (status 500).',
		);
	});
});

describe('one run’s reports', () => {
	const zipped = storedZip({
		'meta.json': '{"sha":"abc"}',
		'admin/coverage-final.json': '{}',
		'admin/coverage-summary.json': '{}',
		'admin/tests.json': '{"files":[]}',
	});

	it('downloads the run’s artifact and keeps the description, line data and test results', async () => {
		const http = github(
			{
				'/actions/runs/7/artifacts': {
					status: 200,
					body: {
						artifacts: [
							{ id: 9, expired: true },
							{ id: 11, expired: false },
						],
					},
				},
			},
			{ '/actions/artifacts/11/zip': { status: 200, body: zipped } },
		);
		const files = await ciReports(http, REPO, 'key', '7');
		expect([...files.keys()]).toEqual(['meta.json', 'admin/coverage-final.json', 'admin/tests.json']);
	});

	it('says when the reports expired, were never kept, or could not be downloaded', async () => {
		const expired = github({
			'/actions/runs/7/artifacts': { status: 200, body: { artifacts: [{ id: 9, expired: true }] } },
		});
		await expect(ciReports(expired, REPO, 'key', '7')).rejects.toThrow('have expired (GitHub keeps them 90 days)');
		const never = github({ '/actions/runs/7/artifacts': { status: 200, body: { artifacts: [] } } });
		await expect(ciReports(never, REPO, 'key', '7')).rejects.toThrow('This run kept no coverage reports.');
		const gone = github(
			{ '/actions/runs/7/artifacts': { status: 200, body: { artifacts: [{ id: 11 }] } } },
			{ '/actions/artifacts/11/zip': { status: 410, body: null } },
		);
		await expect(ciReports(gone, REPO, 'key', '7')).rejects.toThrow(
			'GitHub could not show this run’s reports (status 410).',
		);
	});
});

describe('the commit’s files and text', () => {
	it('lists the commit’s files and says when GitHub cut the list short', async () => {
		const http = github({
			'/git/trees/abc?recursive=1': {
				status: 200,
				body: {
					truncated: true,
					tree: [
						{ type: 'tree', path: 'apps' },
						{ type: 'blob', path: 'apps/a.ts' },
						{ type: 'blob', path: 'README.md' },
					],
				},
			},
		});
		expect(await committedFiles(http, REPO, 'key', 'abc')).toEqual({
			files: ['apps/a.ts', 'README.md'],
			truncated: true,
		});
		const plain = github({ '/git/trees/abc': { status: 200, body: { tree: [] } } });
		expect(await committedFiles(plain, REPO, 'key', 'abc')).toEqual({ files: [], truncated: false });
	});

	it('reads a file at the commit, with each part of its path escaped', async () => {
		const http = github(
			{},
			{
				'/contents/apps/admin/a%20b.ts?ref=abc': { status: 200, body: 'export {};' },
				'/contents/gone.ts': { status: 404, body: null },
				'/contents/locked.ts': { status: 403, body: null },
			},
		);
		expect(await fileAt(http, REPO, 'key', 'abc', 'apps/admin/a b.ts')).toBe('export {};');
		expect(await fileAt(http, REPO, 'key', 'abc', 'gone.ts')).toBeNull();
		await expect(fileAt(http, REPO, 'key', 'abc', 'locked.ts')).rejects.toThrow('GitHub would not show this file.');
	});
});

describe('changed lines on GitHub', () => {
	it('reads a commit’s own changes, or the changes against a branch, leaving out files without a patch', async () => {
		const http = github({
			'/commits/abc': {
				status: 200,
				body: { files: [{ filename: 'a.ts', patch: '@@ -1 +1,2 @@\n-x\n+y\n+z' }, { filename: 'logo.png' }] },
			},
			'/compare/dev...abc': { status: 200, body: { files: [{ filename: 'b.ts', patch: '@@ -0,0 +5 @@\n+w' }] } },
		});
		expect([...(await changedOnGithub(http, REPO, 'key', 'abc', 'commit'))]).toEqual([['a.ts', [1, 2]]]);
		expect([...(await changedOnGithub(http, REPO, 'key', 'abc', 'dev'))]).toEqual([['b.ts', [5]]]);
	});
});

describe('the default GitHub client', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends the key, follows GitHub’s redirect for downloads and reads raw text', async () => {
		const fetch = vi.fn(async (url: string, init: RequestInit) => {
			const headers = init.headers as Record<string, string>;
			expect(headers['authorization']).toBe('Bearer key');
			if (url.endsWith('/zip')) {
				expect(init.redirect).toBe('follow');
				return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
			}
			if (url.endsWith('/missing')) return new Response('nope', { status: 404 });
			if (url.includes('/contents/')) {
				expect(headers['accept']).toBe('application/vnd.github.raw+json');
				return new Response('text', { status: 200 });
			}
			return new Response('{"ok":true}', { status: 200 });
		});
		vi.stubGlobal('fetch', fetch);
		expect((await coverageHttp.json('https://api.github.com/x', 'key')).body).toEqual({ ok: true });
		expect(await coverageHttp.bytes('https://api.github.com/a/zip', 'key')).toEqual({
			status: 200,
			body: Buffer.from([1, 2, 3]),
		});
		expect(await coverageHttp.bytes('https://api.github.com/missing', 'key')).toEqual({ status: 404, body: null });
		expect(await coverageHttp.text('https://api.github.com/contents/a', 'key')).toEqual({
			status: 200,
			body: 'text',
		});
		expect(await coverageHttp.text('https://api.github.com/missing', 'key')).toEqual({ status: 404, body: null });
	});
});
