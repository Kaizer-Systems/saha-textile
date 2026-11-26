import { describe, expect, it } from 'vitest';

import { IMenu } from '@data-access/interfaces/menu.interface';

import { AdminSearchEntry, distance, entryForUrl, indexEntry, searchAdmin, searchEntries } from './admin-search';

/** The table worked out in full, as the search did before it kept only one row: the answer must not change. */
function fullTable(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	const table = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= a.length; i++) {
		const row = table[i] as number[];
		const up = table[i - 1] as number[];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + cost);
		}
		if (Math.min(...row) > limit) return limit + 1;
	}
	return (table[a.length] as number[])[b.length] as number;
}

const entry = (id: string, title: string, over: Partial<AdminSearchEntry> = {}): AdminSearchEntry => ({
	id,
	path: `/${id}`,
	titleKey: title,
	trailKeys: [],
	icon: 'ri-file-line',
	keywords: [],
	permissions: [],
	...over,
});
const indexOf = (list: AdminSearchEntry[]) => list.map((item) => indexEntry(item, (key) => key));

describe('admin search edges', () => {
	it('measures spelling distance exactly as the full table does', () => {
		const letters = 'abcde';
		let seed = 7;
		const next = () => (seed = (seed * 48271) % 2147483647);
		const word = () => Array.from({ length: next() % 7 }, () => letters[next() % letters.length]).join('');
		for (let round = 0; round < 400; round++) {
			const [a, b, limit] = [word(), word(), 1 + (next() % 3)];
			expect(distance(a, b, limit), `${a} / ${b} / ${limit}`).toBe(fullTable(a, b, limit));
		}
		expect(distance('', 'ab')).toBe(2);
		expect(distance('ab', '')).toBe(2);
	});

	it('reads the menu: the home page, rows with no title, and icons and permissions from the parent', () => {
		const menu = [
			{ id: 1, title: 'home', path: '/' },
			{ id: 2, title: '', path: '/hidden' },
			{ id: 3, title: 'stock', children: [{ id: 4, title: 'stock alerts', path: '/stock/alerts' }] },
		] as unknown as IMenu[];
		const found = searchEntries(menu);
		expect(found.find((item) => item.path === '/')?.id).toBe('home');
		expect(found.some((item) => item.path === '/hidden')).toBe(false);
		const alerts = found.find((item) => item.path === '/stock/alerts');
		expect([alerts?.icon, alerts?.permissions, alerts?.trailKeys]).toEqual(['ri-file-line', [], ['stock']]);
	});

	it('finds a word inside a longer one', () => {
		expect(searchAdmin(indexOf([entry('stock', 'stock')]), 'tock').entries.map((item) => item.id)).toEqual([
			'stock',
		]);
	});

	it('reads a long mistyped word as the nearest, shortest word', () => {
		const index = indexOf([
			entry('produce', 'produce it'),
			entry('products', 'products'),
			entry('product', 'product'),
		]);
		const outcome = searchAdmin(index, 'productz');
		expect(outcome.corrected).toEqual({ typed: 'productz', used: 'product' });
		expect(outcome.entries.map((item) => item.id)).toEqual(['product', 'products']);
	});

	it('names no correction when the corrected words still find nothing', () => {
		expect(searchAdmin(indexOf([entry('stock', 'stock')]), 'stocl zz')).toEqual({ entries: [], corrected: null });
	});

	it('finds the home page for the bare address', () => {
		const home = entry('home', 'home', { path: '/' });
		expect(entryForUrl([home], '/')).toBe(home);
	});
});
