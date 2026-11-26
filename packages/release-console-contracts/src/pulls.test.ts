import { describe, expect, it } from 'vitest';

import {
	pullBasePreviewAnswerSchema,
	pullBasePreviewQuerySchema,
	pullCommitPageAnswerSchema,
	pullDiffQuerySchema,
	pullListQuerySchema,
	pullCommitsQuerySchema,
	pullPageSchema,
	pullRowSchema,
} from './index.js';

const counts = { total: 12, running: 10, passed: 2, failed: 0 };

describe('the pull request page shapes', () => {
	it('read a list row and the page as the console API sends them', () => {
		const row = {
			number: 7,
			title: 'feat: everything since PR #6',
			author: 'kaizer03',
			branch: 'feat/combined-after-pr6',
			base: 'dev',
			draft: false,
			state: 'open',
			updatedAt: '2026-11-24T07:52:00Z',
			url: 'https://github.com/o/r/pull/7',
			commits: 1339,
			additions: 623963,
			deletions: 41288,
			checks: counts,
			review: 'required',
		};
		expect(pullRowSchema.parse(row)).toEqual(row);
		const page = pullPageSchema.parse({
			...row,
			head: row.branch,
			baseSha: 'a'.repeat(40),
			headSha: 'b'.repeat(40),
			createdAt: row.updatedAt,
			mergedAt: null,
			mergedBy: '',
			closedAt: null,
			bodyHtml: '<h2>Headline features</h2>',
			bodyLength: 37071,
			changedFiles: 4105,
			mergeable: null,
			mergeableState: 'blocked',
			autoMerge: false,
			canAutoMerge: true,
			checkList: [],
			reviewers: [{ login: 'kaizer03', state: 'requested' }],
			labels: [],
			events: [
				{
					kind: 'commented',
					who: 'kaizer03',
					at: row.updatedAt,
					text: 'commented',
					html: '<p>Looks good</p>',
					tone: null,
					sha: '',
					checkId: null,
					url: '',
				},
			],
		});
		expect(page.events[0]?.kind).toBe('commented');
	});

	it('take the list, page and file queries with their defaults, and refuse a bad commit id', () => {
		expect(pullListQuerySchema.parse({})).toEqual({ state: 'open' });
		expect(pullCommitsQuerySchema.parse({ page: '3' })).toEqual({ page: 3 });
		expect(pullDiffQuerySchema.parse({ path: 'a.ts' })).toEqual({ path: 'a.ts', whole: '0' });
		expect(pullDiffQuerySchema.safeParse({ path: 'a.ts', commit: 'nothex!' }).success).toBe(false);
		const commit = pullCommitPageAnswerSchema.parse({
			state: 'ok',
			readAt: '2026-11-24T08:00:00.000Z',
			data: {
				sha: 'c'.repeat(40),
				message: 'fix: a thing\n\nWhy',
				author: 'Owner',
				date: '2026-11-24T08:00:00Z',
				checks: counts,
				files: { total: 0, source: 'github', note: '', files: [] },
			},
		});
		expect(commit.state).toBe('ok');
	});

	it('read a base preview, and take only a branch name as the base', () => {
		expect(pullBasePreviewQuerySchema.parse({ base: 'feat/combined-after-pr6' })).toEqual({
			base: 'feat/combined-after-pr6',
		});
		expect(pullBasePreviewQuerySchema.safeParse({ base: 'dev..main' }).success).toBe(false);
		const preview = pullBasePreviewAnswerSchema.parse({
			state: 'ok',
			readAt: '2026-11-24T08:00:00.000Z',
			data: { base: 'staging', commits: 1383, files: 4196 },
		});
		expect(preview.state === 'ok' && preview.data.files).toBe(4196);
	});
});
