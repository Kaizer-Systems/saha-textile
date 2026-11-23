import { describe, expect, it } from 'vitest';

import {
	type RowFilters,
	countsByPath,
	deltaOf,
	foldersAbove,
	foldersWithGaps,
	highlightedLines,
	languageOf,
	nodeAt,
	shareOf,
	shareText,
	squarify,
	visibleRows,
} from './coverage-view';

import type { CoverageNode, Counts } from '@saha-textile/release-console-contracts';

const done: Counts = [4, 4, 2, 2, 1, 1, 4, 4];
const half: Counts = [2, 4, 1, 2, 1, 1, 2, 4];
const low: Counts = [1, 10, 0, 2, 0, 1, 1, 10];
const TREE: CoverageNode = {
	n: 'saha-textile',
	c: [7, 18, 3, 6, 2, 3, 7, 18],
	k: [
		{
			n: 'apps',
			c: [7, 18, 3, 6, 2, 3, 7, 18],
			k: [
				{
					n: 'admin',
					c: [6, 14, 3, 4, 2, 2, 6, 14],
					k: [
						{ n: 'a.ts', c: done },
						{ n: 'b.ts', c: [2, 10, 1, 2, 1, 1, 2, 10] },
						{ n: 'a.html', c: null },
					],
				},
				{ n: 'shop', c: low, k: [{ n: 'c.ts', c: low }] },
			],
		},
		{ n: 'docs', c: null, k: [{ n: 'intro.md', c: null }] },
		{ n: 'README.md', c: null },
	],
};
const filters = (f: Partial<RowFilters> = {}): RowFilters => ({
	expanded: new Set(['']),
	below: false,
	measured: false,
	low: false,
	query: '',
	only: null,
	...f,
});
const shown = (f: Partial<RowFilters>) =>
	visibleRows(TREE, filters(f)).map((r) => `${'  '.repeat(r.depth)}${r.name}${r.folder ? (r.open ? '/' : '+') : ''}`);

describe('the tree’s rows', () => {
	it('shows the whole codebase, then each open folder’s children', () => {
		expect(shown({})).toEqual(['saha-textile/', '  apps+', '  docs+', '  README.md']);
		expect(shown({ expanded: new Set(['', 'apps', 'apps/admin']) })).toEqual([
			'saha-textile/',
			'  apps/',
			'    admin/',
			'      a.ts',
			'      b.ts',
			'      a.html',
			'    shop+',
			'  docs+',
			'  README.md',
		]);
		expect(shown({ expanded: new Set() })).toEqual(['saha-textile+']);
		expect(visibleRows(TREE, filters())[1]).toEqual({
			path: 'apps',
			name: 'apps',
			depth: 1,
			folder: true,
			open: false,
			counts: TREE.k?.[0]?.c,
		});
	});

	it('hides what is at 100% or not measured, and puts the lowest first', () => {
		const open = new Set(['', 'apps', 'apps/admin']);
		expect(shown({ expanded: open, below: true })).toEqual([
			'saha-textile/',
			'  apps/',
			'    admin/',
			'      b.ts',
			'      a.html',
			'    shop+',
			'  docs+',
			'  README.md',
		]);
		expect(shown({ expanded: open, measured: true })).toEqual([
			'saha-textile/',
			'  apps/',
			'    admin/',
			'      a.ts',
			'      b.ts',
			'    shop+',
		]);
		expect(shown({ expanded: open, low: true })).toEqual([
			'saha-textile/',
			'  apps/',
			'    shop+',
			'    admin/',
			'      b.ts',
			'      a.ts',
			'      a.html',
			'  docs+',
			'  README.md',
		]);
	});

	it('finds files by name, or keeps only a change’s files, opening the folders above them', () => {
		expect(shown({ query: ' C.TS ' })).toEqual(['saha-textile/', '  apps/', '    shop/', '      c.ts']);
		expect(shown({ only: new Set(['apps/admin/b.ts', 'gone.ts']) })).toEqual([
			'saha-textile/',
			'  apps/',
			'    admin/',
			'      b.ts',
		]);
		expect(shown({ query: 'a', only: new Set(['apps/admin/b.ts', 'apps/admin/a.ts']) })).toEqual([
			'saha-textile/',
			'  apps/',
			'    admin/',
			'      a.ts',
		]);
		expect(shown({ query: 'nothing' })).toEqual(['saha-textile/']);
	});

	it('finds a node by path, the folders above a file, and every folder with a gap', () => {
		expect(nodeAt(TREE, '')?.n).toBe('saha-textile');
		expect(nodeAt(TREE, 'apps/shop/c.ts')?.c).toEqual(low);
		expect(nodeAt(TREE, 'apps/nope/x.ts')).toBeNull();
		expect(foldersAbove('apps/admin/a.ts')).toEqual(['', 'apps', 'apps/admin']);
		expect(foldersAbove('README.md')).toEqual(['']);
		expect([...foldersWithGaps(TREE)]).toEqual(['', 'apps', 'apps/admin', 'apps/shop']);
		expect([...foldersWithGaps({ n: 'r', c: done, k: [{ n: 'a', c: done }] })]).toEqual([]);
	});

	it('gives each number its share and band', () => {
		expect(shareOf(half, 'statements')).toEqual({ share: 50, band: 'red' });
		expect(shareOf(done, 'lines')).toEqual({ share: 100, band: 'ok' });
		expect(shareOf(null, 'lines')).toBeNull();
		expect([shareText(100), shareText(99.9), shareText(50)]).toEqual(['100', '99.9', '50.0']);
	});
});

describe('comparing two runs', () => {
	it('reads every measured path’s counts, and how a row moved since', () => {
		const counts = countsByPath(TREE);
		expect([...counts.keys()]).toEqual([
			'',
			'apps',
			'apps/admin',
			'apps/admin/a.ts',
			'apps/admin/b.ts',
			'apps/shop',
			'apps/shop/c.ts',
		]);
		expect(deltaOf(null, done)).toBeNull();
		expect(deltaOf(done, undefined)).toEqual({ text: 'new', band: 'muted' });
		expect(deltaOf(done, done)).toEqual({ text: '±0', band: 'muted' });
		expect(deltaOf(done, half)).toEqual({ text: '▲ 50.0', band: 'ok' });
		expect(deltaOf(low, half)).toEqual({ text: '▼ 40.0', band: 'red' });
	});
});

describe('the map', () => {
	it('fills the rectangle with boxes sized by value, biggest first', () => {
		const boxes = squarify(
			[
				{ value: 6, item: 'a' },
				{ value: 2, item: 'b' },
				{ value: 2, item: 'c' },
				{ value: 0, item: 'zero' },
			],
			0,
			0,
			100,
			50,
		);
		expect(boxes.map((b) => b.item)).toEqual(['a', 'b', 'c']);
		const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
		expect(area).toBeCloseTo(5000);
		expect(boxes[0]?.w! * boxes[0]?.h!).toBeCloseTo(3000);
		const tall = squarify(
			[
				{ value: 1, item: 'x' },
				{ value: 1, item: 'y' },
				{ value: 1, item: 'z' },
			],
			0,
			0,
			30,
			90,
		);
		expect(tall.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(2700);
		expect(tall.every((b) => b.w <= 30.0001)).toBe(true);
		const many = squarify(
			Array.from({ length: 9 }, (_, i) => ({ value: 9 - i, item: i })),
			0,
			0,
			120,
			80,
		);
		expect(many).toHaveLength(9);
		expect(squarify([], 0, 0, 10, 10)).toEqual([]);
		expect(squarify([{ value: 1, item: 'x' }], 0, 0, 0, 10)).toEqual([]);
		expect(squarify([{ value: 1, item: 'x' }], 0, 0, 10, 0)).toEqual([]);
	});
});

describe('code colours', () => {
	it('reads a file’s language from its ending', () => {
		expect(['a.ts', 'b.mjs', 'c.html', 'd.SCSS', 'e.json', 'f.md', 'Makefile'].map(languageOf)).toEqual([
			'typescript',
			'javascript',
			'xml',
			'scss',
			'json',
			null,
			null,
		]);
	});

	it('colours a file as a whole and cuts it into lines, keeping colours that span lines', () => {
		const lines = highlightedLines(['/* one', ' two */', "const a = '<b>';"], 'x.ts');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe('<span class="hljs-comment">/* one</span>');
		expect(lines[1]).toBe('<span class="hljs-comment"> two */</span>');
		expect(lines[2]).toContain('<span class="hljs-keyword">const</span>');
		expect(lines[2]).toContain('&lt;b&gt;');
		expect(highlightedLines([], 'x.ts')).toEqual([]);
	});

	it('escapes text it has no colours for', () => {
		expect(highlightedLines(['a < b & "c"'], 'notes.txt')).toEqual(['a &lt; b &amp; &quot;c&quot;']);
	});
});
