import { describe, expect, it } from 'vitest';

import {
	changedPaths,
	describeValue,
	draftTab,
	fingerprint,
	flattenSnapshot,
	type ProductFormSnapshot,
	stable,
} from './product-draft-state';

const snap = (over: Partial<ProductFormSnapshot> = {}): ProductFormSnapshot => ({
	v: 1,
	raw: {
		name: 'Shown in the current language',
		sku: 'S1',
		categories: ['c1'],
		variations: [{ id: 'v1', name: 'Red', variation_name: 'Red', price: 900, mrp: 1000 }, { name: 'no id' }],
	},
	text: { name: { en: 'Silk', bn: 'সিল্ক' } },
	state: { images: { gallery: ['m1'] }, tiles: { m1: 'url' } },
	...over,
});

describe('product draft state', () => {
	it('flattens every field to one path, leaving out labels and pictures kept for show', () => {
		const flat = flattenSnapshot(snap());
		expect([...flat.keys()].sort()).toEqual([
			'raw.categories',
			'raw.sku',
			'raw.variations.v1.mrp',
			'raw.variations.v1.price',
			'state.images',
			'text.name.bn',
			'text.name.en',
		]);
		expect(flattenSnapshot({ v: 1 } as never).size).toBe(0);
	});

	it('finds only the fields that changed, with their old values', () => {
		const base = snap();
		const next = snap({
			raw: { ...base.raw, sku: 'S2', variations: [{ id: 'v1', price: 850, mrp: 1000 }] },
			text: { name: { en: 'Silk', bn: 'সিল্ক শাড়ি' }, description: { en: '' } },
		});
		expect(changedPaths(base, next)).toEqual([
			{ path: 'raw.sku', from: 'S1' },
			{ path: 'raw.variations.v1.price', from: 900 },
			{ path: 'text.name.bn', from: 'সিল্ক' },
		]);
		expect(fingerprint(base)).toBe(fingerprint(snap()));
		expect(fingerprint(base)).not.toBe(fingerprint(next));
	});

	it('reads categories and tags as sets, since the picker reorders them on load', () => {
		const base = snap();
		const reordered = snap({ raw: { ...base.raw, categories: ['c2', 'c1'], tags: [3, 1] } });
		const same = snap({ raw: { ...base.raw, categories: ['c1', 'c2'], tags: [1, 3] } });
		expect(changedPaths(reordered, same)).toEqual([]);
		expect(changedPaths(base, same).map((change) => change.path)).toEqual(['raw.categories', 'raw.tags']);
	});

	it('treats empty, missing and null as the same, and key order as nothing', () => {
		expect(stable('')).toBe(stable(null));
		expect(stable(undefined)).toBe('null');
		expect(stable({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe(stable({ a: [1, { c: 2 }], b: 1 }));
		expect(
			changedPaths(snap({ text: { name: { en: 'Silk', bn: '' } } }), snap({ text: { name: { en: 'Silk' } } })),
		).toEqual([]);
	});

	it('puts each change on its tab', () => {
		expect(draftTab('text.meta_title.en')).toBe('seo');
		expect(draftTab('text.unknown.en')).toBe('general');
		expect(draftTab('raw.variations.v1.price')).toBe('inventory');
		expect(draftTab('raw.status')).toBe('status');
		expect(draftTab('raw.something')).toBe('general');
		expect(draftTab('state.faq')).toBe('faq');
		expect(draftTab('state.other')).toBe('general');
	});

	it('says an old value in plain words, cut short', () => {
		expect(describeValue('<p>Light and   easy</p>')).toBe('Light and easy');
		expect(describeValue(null)).toBe('—');
		expect(describeValue('<p> </p>')).toBe('—');
		expect(describeValue(['a', 2])).toBe('a, 2');
		expect(describeValue({ a: 1 })).toBe('…');
		expect(describeValue(true)).toBe('true');
		expect(describeValue('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
	});
});
