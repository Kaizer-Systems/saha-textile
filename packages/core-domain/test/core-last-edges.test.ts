import type { ShippingRuleSetBody } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { formatList, languageName } from '../src/catalog/languages';
import { placeholderFile } from '../src/catalog/media-placeholder';
import { bytesReader, measureFromHeader } from '../src/catalog/photo-header';
import { sweepKeptFiles } from '../src/media/replace-photo';
import { adjustmentRefusal } from '../src/purchasing/stock-rules';
import { resolveShippingBox } from '../src/shipping/charges';
import { validateShippingRuleSet } from '../src/shipping/validate';

describe('language names and lists that cannot be read', () => {
	it('keeps a malformed code as it is and joins a list plainly when the reader’s language cannot', () => {
		expect(languageName('!!')).toBe('!!');
		expect(formatList(['A', 'B'], '!!')).toBe('A, B');
	});
});

describe('placeholder files', () => {
	it('names the light and the dark file', () => {
		expect(placeholderFile('3x4', false)).toBe('placeholder-light-3x4.svg');
		expect(placeholderFile('3x4', true)).toBe('placeholder-dark-3x4.svg');
	});
});

describe('photo headers that stop short', () => {
	it('reads a cut-off bitmap header as nothing and a kind it does not measure as no size', async () => {
		const short = new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(await measureFromHeader(bytesReader(short), 'bmp')).toBeNull();
		expect(await measureFromHeader(bytesReader(short), 'jpeg' as never)).toBeNull();
		expect(await measureFromHeader(bytesReader(short), 'not-a-kind' as never)).toBeNull();
		const failing = { size: 100, read: async () => Promise.reject(new Error('gone')) };
		expect(await measureFromHeader(failing as never, 'tiff')).toBeNull();
	});
});

describe('stock adjustments that need no refusal', () => {
	it('lets an addition through', () => {
		expect(
			adjustmentRefusal({
				action: 'add',
				quantity: 2,
				facts: { onHand: 5, held: 0, reserved: 0 } as never,
				soldBy: 'piece',
				hold: null,
				tracked: true,
			}),
		).toBeNull();
	});
});

describe('a shipping box with nothing filled in', () => {
	it('answers no size and no weight', () => {
		const box = resolveShippingBox([null, undefined, {}]);
		expect(Object.values(box).every((value) => value === null)).toBe(true);
	});
});

describe('bands without a start or an end', () => {
	const result = (id: string) => ({ kind: 'result', id, result: { kind: 'amount', amount: 100, per: 'once' } });
	const band = (id: string, from: number | null, to: number | null) => ({ id, from, to, then: result(`r${id}`) });
	const codes = (list: unknown[]) =>
		validateShippingRuleSet(
			{
				steps: [
					{
						id: 's',
						scope: 'wholeCart',
						combine: 'sum',
						node: { kind: 'bands', id: 'b', field: 'cart.subtotal', bands: list, otherwise: null },
					},
				],
				adjust: [],
			} as unknown as ShippingRuleSetBody,
			'both',
			{},
		).issues;

	it('sorts open starts first and reads an open end as running on', () => {
		const issues = codes([band('2', 50, 80), band('1', null, 60), band('3', null, null)]);
		expect(issues.some((issue) => issue.code === 'bands_overlap')).toBe(true);
		const open = codes([band('1', 0, null), band('2', 10, 20)]);
		expect(open.some((issue) => issue.code === 'bands_overlap')).toBe(true);
	});

	it('names only the uncovered end that exists', () => {
		const above = codes([band('1', 0, 100)]).find((issue) => issue.code === 'bands_uncovered');
		expect(above?.params).toEqual({ below: -1, above: 100 });
		const below = codes([band('1', 10, null)]).find((issue) => issue.code === 'bands_uncovered');
		expect(below?.params).toEqual({ below: 10, above: -1 });
	});
});

describe('kept files of a photo whose new file is still coming in', () => {
	it('keeps the file a Replace is writing, and deletes the rest without addresses for a private photo', async () => {
		const enqueue = vi.fn(async () => undefined);
		const asset = {
			id: 'med_1',
			visibility: 'private',
			originalStorageKey: '',
			derivatives: [],
			replacing: { key: 'media/med_1/new.jpg' },
			keptFiles: [
				{ deleteAfter: '2026-11-01T00:00:00.000Z', keys: ['media/med_1/new.jpg', 'media/med_1/old.jpg'] },
			],
		};
		const swept = await sweepKeptFiles(
			{
				assets: { listKeptDue: async () => [asset as never], dropKept: async () => undefined },
				queue: { enqueue } as never,
				storage: { getUrl: (key: string) => `https://cdn/${key}` },
			},
			new Date('2026-11-20T00:00:00.000Z'),
		);
		expect(swept).toBe(1);
		expect(enqueue).toHaveBeenCalledWith({ type: 'delete-objects', keys: ['media/med_1/old.jpg'], urls: [] });
	});
});
