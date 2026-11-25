import { describe, expect, it } from 'vitest';

import {
	CODE_TABS,
	CODE_TAB_LABELS,
	SHOWN_TABS,
	activityWords,
	base64Of,
	blameLines,
	branchSections,
	checkMark,
	cloneWays,
	codeLinkOf,
	crumbsOf,
	fileLines,
	findFiles,
	fuzzy,
	linesFragment,
	linesOf,
	markWords,
	marked,
	parentOf,
	patchBranch,
	ruleWords,
	sizeSaid,
	textBase64,
} from './code-view';

import type { BranchRow } from '@saha-textile/release-console-contracts';

describe('the Code page’s words and places', () => {
	it('lists GitHub’s tabs, Search kept off the strip', () => {
		expect(SHOWN_TABS.map((t) => CODE_TAB_LABELS[t])).toEqual([
			'Files',
			'Commits',
			'Branches',
			'Tags',
			'Releases',
			'Compare',
			'Activity',
		]);
		expect(CODE_TABS).toContain('search');
	});

	it('names each folder on a path, and a path’s folder', () => {
		expect(crumbsOf('apps/api/main.ts')).toEqual([
			{ name: 'apps', path: 'apps' },
			{ name: 'api', path: 'apps/api' },
			{ name: 'main.ts', path: 'apps/api/main.ts' },
		]);
		expect(crumbsOf('')).toEqual([]);
		expect(parentOf('apps/api/main.ts')).toBe('apps/api');
		expect(parentOf('README.md')).toBe('');
	});

	it('colours a whole file’s lines with their numbers', () => {
		const rows = fileLines('const a = 1;\nlet b = 2;\n', 'a.ts');
		expect(rows.map((r) => r.new)).toEqual([1, 2]);
		expect(rows[0]?.html).toContain('hljs-keyword');
	});

	it('reads and writes the marked lines of the address', () => {
		expect(linesOf('L35')).toEqual({ start: 35, end: 35 });
		expect(linesOf('L40-L35')).toEqual({ start: 35, end: 40 });
		expect(linesOf('top')).toBeNull();
		expect(linesOf(null)).toBeNull();
		expect(linesFragment(3, 3)).toBe('L3');
		expect(linesFragment(3, 9)).toBe('L3-L9');
	});
});

describe('Go to file', () => {
	const paths = [
		'scripts/coverage.mjs',
		'apps/release-console/src/app/screens/coverage-file.ts',
		'covmjs.txt',
		'README.md',
	];

	it('matches letters in order, the file’s own name first, and marks them', () => {
		expect(fuzzy('README.md', '')).toEqual({ score: 0, at: [] });
		expect(fuzzy('README.md', 'zz')).toBeNull();
		expect(fuzzy('scripts/coverage.mjs', 'cov')?.score).toBe(2);
		expect(fuzzy('scripts/coverage.mjs', 'scov')?.score).toBeGreaterThan(100);
		expect(findFiles(paths, 'covmjs').map((h) => h.path)).toEqual(['covmjs.txt', 'scripts/coverage.mjs']);
		expect(findFiles(paths, '', 2)).toHaveLength(2);
		expect(findFiles(['b/x.ts', 'a/x.ts'], 'x').map((h) => h.path)).toEqual(['a/x.ts', 'b/x.ts']);
		expect(marked('abc', [0, 1])).toEqual([
			{ text: 'ab', on: true },
			{ text: 'c', on: false },
		]);
	});
});

describe('Search', () => {
	it('marks the words in a coloured line’s text, any case, across its colours, never inside a tag', () => {
		expect(markWords('<span class="hljs-keyword">const</span> port = 1;', 'PORT')).toBe(
			'<span class="hljs-keyword">const</span> <mark>port</mark> = 1;',
		);
		expect(markWords('<b>po</b>rt and port', 'port')).toBe(
			'<b><mark>po</mark></b><mark>rt</mark> and <mark>port</mark>',
		);
		expect(markWords('a &lt; b &amp;&amp; c &#39;d&#39;', '< b')).toBe(
			'a <mark>&lt; b</mark> &amp;&amp; c &#x27;d&#x27;',
		);
		expect(markWords('<i class="x">span</i>', 'class')).toBe('<i class="x">span</i>');
		expect(markWords('no match', 'zz')).toBe('no match');
		expect(markWords('<b>x</b>', '')).toBe('<b>x</b>');
	});
});

describe('branches', () => {
	const now = Date.parse('2026-11-24T00:00:00Z');
	const row = (name: string, date: string, over: Partial<BranchRow> = {}): BranchRow => ({
		name,
		isDefault: false,
		rule: false,
		sha: 'a',
		date,
		author: 'kaizer03',
		login: 'kaizer03',
		behind: 0,
		ahead: 1,
		pull: null,
		checks: 'none',
		...over,
	});
	const rows = [
		row('main', '2026-06-25T00:00:00Z', { isDefault: true }),
		row('feat/new', '2026-11-24T00:00:00Z'),
		row('docs/old', '2026-07-25T00:00:00Z'),
		row('theirs', '2026-11-20T00:00:00Z', { login: 'someone' }),
	];

	it('splits them into GitHub’s views, newest first, and finds by name', () => {
		const titles = (v: Parameters<typeof branchSections>[1]) =>
			branchSections(rows, v, 'kaizer03', '', now).map((s) => [s.title, s.rows.map((r) => r.name)]);
		expect(titles('overview')).toEqual([
			['Default', ['main']],
			['Your branches', ['feat/new', 'docs/old']],
			['Active branches', ['feat/new', 'theirs']],
		]);
		expect(titles('yours')).toEqual([['Your branches', ['feat/new', 'docs/old']]]);
		expect(titles('active')).toEqual([['Active branches', ['feat/new', 'theirs']]]);
		expect(titles('stale')).toEqual([['Stale branches', ['docs/old']]]);
		expect(titles('all')).toEqual([['All branches', ['feat/new', 'theirs', 'docs/old', 'main']]]);
		expect(branchSections(rows, 'overview', 'nobody', 'zzz', now)).toEqual([]);
		expect(branchSections(rows, 'stale', 'kaizer03', 'feat', now)).toEqual([{ title: 'Stale branches', rows: [] }]);
		expect(branchSections(rows, 'all', 'x', '')[0]?.rows).toHaveLength(4);
	});
});

describe('words', () => {
	it('name rules, sizes, activity, clone addresses and checks as GitHub does', () => {
		expect(ruleWords('pull_request')).toBe('Require a pull request before merging');
		expect(ruleWords('new_kind_of_rule')).toBe('new kind of rule');
		expect([1, 512, 10_721, 3 * 1024 * 1024].map(sizeSaid)).toEqual(['1 Byte', '512 Bytes', '10.5 KB', '3.0 MB']);
		expect(activityWords('force_push')).toBe('Force pushed');
		expect(activityWords('odd_kind')).toBe('odd kind');
		expect(cloneWays('o', 'r').map((w) => w.text)).toEqual([
			'https://github.com/o/r.git',
			'git@github.com:o/r.git',
			'gh repo clone o/r',
		]);
		expect(['passed', 'failed', 'running', 'none'].map((c) => checkMark(c as never).text)).toEqual([
			'✓',
			'✕',
			'◔',
			'',
		]);
	});

	it('puts a commit on the first line of each blame run', () => {
		const run = { start: 1, end: 2, sha: 's', headline: 'h', author: 'a', date: 'd', previous: null };
		const rows = blameLines(['one', 'two', 'three'], [run], 'a.txt');
		expect(rows.map((r) => [r.first, r.run?.sha ?? null])).toEqual([
			[true, 's'],
			[false, 's'],
			[false, null],
		]);
	});

	it('suggests a free patch branch name', () => {
		expect(patchBranch('kaizer03', ['kaizer03-patch-1'])).toBe('kaizer03-patch-2');
		expect(patchBranch('', [])).toBe('console-patch-1');
	});

	it('reads files and text as base64', async () => {
		expect(await textBase64('# Shop')).toBe('IyBTaG9w');
		expect(await base64Of(new Blob([new Uint8Array([0, 255])]))).toBe('AP8=');
	});

	it('knows links into this repository’s files, a ref with slashes too', () => {
		const url = 'https://github.com/o/r';
		expect(codeLinkOf(`${url}/blob/feat/x/docs/a.md#intro`, url, 'feat/x')).toEqual({
			ref: 'feat/x',
			path: 'docs/a.md',
			type: 'blob',
			fragment: 'intro',
		});
		expect(codeLinkOf(`${url}/tree/main/apps`, url, 'feat/x')).toEqual({
			ref: 'main',
			path: 'apps',
			type: 'tree',
			fragment: null,
		});
		expect(codeLinkOf(`${url}/blob/dev`, url, 'dev')).toMatchObject({ ref: 'dev', path: '' });
		expect(codeLinkOf('https://example.com/', url, 'dev')).toBeNull();
	});
});
