import { describe, expect, it } from 'vitest';

import {
	FOLD_AT,
	byDay,
	changeStarts,
	checkIcon,
	checksSaid,
	diffRows,
	eventIcon,
	fileRows,
	filesInOrder,
	headingsIn,
	mergeStatus,
	pullNumberOf,
	reviewSaid,
	tookSaid,
} from './pull-view';

import type { PullCheck, PullFile, PullPage } from '@saha-textile/release-console-contracts';

const page = (over: Partial<PullPage> = {}): PullPage => ({
	number: 7,
	title: 'feat: everything since PR #6',
	state: 'open',
	draft: false,
	author: 'kaizer03',
	base: 'dev',
	head: 'feat/combined-after-pr6',
	baseSha: 'base',
	headSha: 'head',
	url: 'https://github.com/o/r/pull/7',
	createdAt: '2026-11-23T13:34:00Z',
	updatedAt: '2026-11-24T07:52:00Z',
	mergedAt: null,
	mergedBy: '',
	closedAt: null,
	bodyHtml: '',
	bodyLength: 0,
	commits: 1339,
	additions: 1,
	deletions: 1,
	changedFiles: 4105,
	mergeable: true,
	mergeableState: 'clean',
	autoMerge: false,
	canAutoMerge: true,
	checks: { total: 2, running: 0, passed: 2, failed: 0 },
	checkList: [],
	review: 'none',
	reviewers: [],
	labels: [],
	events: [],
	...over,
});

describe('the list’s words', () => {
	it('say what the checks and the review stand at', () => {
		expect(checksSaid(null)).toEqual({ tone: 'muted', text: 'no checks' });
		expect(checksSaid({ total: 0, running: 0, passed: 0, failed: 0 }).text).toBe('no checks');
		expect(checksSaid({ total: 12, running: 10, passed: 2, failed: 0 })).toEqual({
			tone: 'amber',
			text: '10 running',
		});
		expect(checksSaid({ total: 12, running: 0, passed: 11, failed: 1 })).toEqual({ tone: 'red', text: '1 failed' });
		expect(checksSaid({ total: 1200, running: 0, passed: 1200, failed: 0 })).toEqual({
			tone: 'ok',
			text: '1,200 passed',
		});
		expect(['approved', 'changes', 'required', 'none'].map((r) => reviewSaid(r as never).text)).toEqual([
			'approved',
			'changes asked for',
			'needs review',
			'—',
		]);
	});
});

describe('the merge status', () => {
	it('lets a clean, approved pull request merge', () => {
		const m = mergeStatus(page({ review: 'approved' }));
		expect(m).toMatchObject({ tone: 'ok', canMerge: true, why: '', offerAuto: false });
		expect(m.items.map((i) => i.text)).toEqual(['✓ 2 passed', '0 failed', '✓ Approved', '✓ No conflicts with dev']);
	});

	it('says every reason Merge is off, and offers Merge when ready', () => {
		const m = mergeStatus(
			page({
				draft: true,
				checks: { total: 12, running: 10, passed: 1, failed: 1 },
				review: 'changes',
				mergeable: false,
				mergeableState: 'behind',
			}),
		);
		expect(m.tone).toBe('red');
		expect(m.canMerge).toBe(false);
		expect(m.offerAuto).toBe(false);
		expect(m.why).toBe(
			'Merge is off: it is a draft, checks are running, 1 check failed, changes were asked for, it conflicts with dev, it is behind dev.',
		);
		const waiting = mergeStatus(
			page({
				checks: { total: 12, running: 10, passed: 0, failed: 2 },
				review: 'required',
				mergeable: null,
				mergeableState: 'blocked',
			}),
		);
		expect(waiting.items.map((i) => i.text)).toEqual([
			'◔ 10 of 12 checks running',
			'✓ 0 passed',
			'✕ 2 failed',
			'● Review required',
			'Checking for conflicts…',
		]);
		expect(waiting.offerAuto).toBe(true);
		const blocked = mergeStatus(
			page({
				mergeableState: 'blocked',
				checks: { total: 0, running: 0, passed: 0, failed: 0 },
				autoMerge: true,
			}),
		);
		expect(blocked).toMatchObject({
			tone: 'amber',
			why: 'Merge is off: GitHub does not allow it yet.',
			offerAuto: false,
		});
		expect(blocked.items.map((i) => i.text)).toEqual(['✓ No conflicts with dev', '⟳ Merges itself when ready']);
	});

	it('says who merged it, or that it was closed', () => {
		expect(
			mergeStatus(page({ state: 'merged', mergedBy: 'kaizer03', mergedAt: '2026-11-25T06:00:00Z' })).items[0]
				?.text,
		).toBe('Merged by kaizer03 on 25 Nov 2026');
		expect(mergeStatus(page({ state: 'closed', closedAt: '2026-11-25T06:00:00Z' }))).toMatchObject({
			tone: 'muted',
			why: 'It is closed.',
			items: [{ text: 'Closed without merging on 25 Nov 2026' }],
		});
	});
});

describe('commits and files', () => {
	it('group commits by day, newest first', () => {
		const c = (sha: string, date: string) => ({ sha, headline: sha, author: 'a', date, checks: 'none' as const });
		expect(
			byDay([c('a', '2026-11-24T10:00:00Z'), c('b', '2026-11-24T01:00:00Z'), c('c', '2026-11-23T10:00:00Z')]).map(
				(d) => [d.day, d.commits.length],
			),
		).toEqual([
			['24 Nov 2026', 2],
			['23 Nov 2026', 1],
		]);
	});

	const f = (path: string, additions = 1, deletions = 0): PullFile => ({
		path,
		previous: null,
		status: 'modified',
		additions,
		deletions,
		binary: false,
	});
	const files = [f('apps/api/b.ts', 2, 1), f('apps/api/a.ts', 3), f('README.md', 1, 1), f('apps/admin/x.ts')];

	it('draw the tree with each folder’s totals, only open folders’ rows, and matching files when searching', () => {
		expect(fileRows(files, new Set(), '').map((r) => [r.path, r.folder, r.additions, r.deletions])).toEqual([
			['apps', true, 6, 1],
			['README.md', false, 1, 1],
		]);
		const open = fileRows(files, new Set(['apps', 'apps/api']), '');
		expect(open.map((r) => `${'  '.repeat(r.depth)}${r.name}${r.folder ? (r.open ? '/' : '/…') : ''}`)).toEqual([
			'apps/',
			'  admin/…',
			'  api/',
			'    a.ts',
			'    b.ts',
			'README.md',
		]);
		expect(fileRows(files, new Set(), 'B.TS').map((r) => r.path)).toEqual(['apps', 'apps/api', 'apps/api/b.ts']);
		expect(filesInOrder(files).map((x) => x.path)).toEqual([
			'apps/admin/x.ts',
			'apps/api/a.ts',
			'apps/api/b.ts',
			'README.md',
		]);
	});
});

describe('the description’s outline', () => {
	it('names three or more headings for the outline, and leaves it out with fewer', () => {
		const root = document.createElement('div');
		root.innerHTML = '<h2>Headline features</h2><p>x</p><h3>Shop</h3><h3> Home </h3>';
		expect(headingsIn(root)).toEqual([
			{ id: 'pr-h-1', level: 2, text: 'Headline features' },
			{ id: 'pr-h-2', level: 3, text: 'Shop' },
			{ id: 'pr-h-3', level: 3, text: 'Home' },
		]);
		expect(root.querySelector('h3')?.id).toBe('pr-h-2');
		const short = document.createElement('div');
		short.innerHTML = '<h2>One</h2><h1></h1>';
		expect(headingsIn(short)).toEqual([]);
	});

	it('knows a link to another pull request of the same repository', () => {
		const url = 'https://github.com/o/r/pull/7';
		expect(pullNumberOf('https://github.com/o/r/pull/6', url)).toBe(6);
		expect(pullNumberOf('https://github.com/o/r/pull/6/files#diff', url)).toBe(6);
		expect(pullNumberOf('https://github.com/other/r/pull/6', url)).toBeNull();
		expect(pullNumberOf('https://example.com/', url)).toBeNull();
	});
});

describe('changed lines', () => {
	const lines = [
		{ kind: 'hunk' as const, old: null, new: null, text: '@@ -1,3 +1,3 @@' },
		{ kind: 'ctx' as const, old: 1, new: 1, text: 'const a = 1;' },
		{ kind: 'del' as const, old: 2, new: null, text: 'const b = 2;' },
		{ kind: 'add' as const, old: null, new: 2, text: 'const b = 3;' },
		{ kind: 'ctx' as const, old: 3, new: 3, text: '' },
		{ kind: 'add' as const, old: null, new: 4, text: '// more' },
	];

	it('keep section heads plain and colour the code', () => {
		const rows = diffRows(lines, 'a.ts');
		expect(rows[0]?.html).toBe('');
		expect(rows[1]?.html).toContain('hljs-keyword');
		expect(diffRows(lines, 'notes.txt')[2]?.html).toBe('const b = 2;');
	});

	it('find where each change starts, for n and p', () => {
		expect(changeStarts(lines)).toEqual([2, 5]);
		expect(changeStarts([])).toEqual([]);
		expect(FOLD_AT).toBe(400);
	});
});

describe('checks and events', () => {
	const check = (over: Partial<PullCheck>): PullCheck => ({
		id: 1,
		name: 'Lint',
		app: 'GitHub Actions',
		status: 'passed',
		startedAt: '2026-11-24T08:00:00Z',
		completedAt: '2026-11-24T08:03:27Z',
		url: 'u',
		actionsJob: true,
		...over,
	});

	it('say how long a check took, or how long it has been running', () => {
		expect(tookSaid(check({}))).toBe('3 m 27 s');
		expect(tookSaid(check({ completedAt: '2026-11-24T08:00:09Z' }))).toBe('9 s');
		expect(tookSaid(check({ status: 'running', completedAt: null }), Date.parse('2026-11-24T08:06:00Z'))).toBe(
			'running 6 m 0 s',
		);
		expect(tookSaid(check({ status: 'queued', startedAt: null, completedAt: null }))).toBe('queued');
		expect(tookSaid(check({ status: 'skipped', startedAt: null }))).toBe('—');
	});

	it('give each check and event its icon', () => {
		expect(checkIcon('failed')).toEqual({ tone: 'red', text: '✕' });
		expect(checkIcon('running').tone).toBe('amber');
		expect(eventIcon('merged')).toBe('⇥');
		expect(eventIcon('check-failed')).toBe('✕');
	});
});
