import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MediaAsset, MediaProfile } from '../src/media';
import { CreateLayoutRequest, GoLiveRequest } from '../src/page-builder';
import { ProductBulkWrite, ProductSaleWrite } from '../src/product-bulk';

const problems = (schema: z.ZodType, value: unknown): string[] => {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('image profile sizes', () => {
	const base = {
		key: 'hero_21x9',
		name: 'Hero 21:9',
		shape: { width: 21, height: 9 },
		roles: ['banner'],
		fills: ['crop'],
		maxBytes: 1024,
		accepts: ['image/jpeg'],
	};

	it('gives sizes only for families the profile makes, each size once', () => {
		expect(problems(MediaProfile, { ...base, widths: { banner: [800, 1600] } })).toEqual([]);
		expect(problems(MediaProfile, { ...base, widths: { card: [400] } })).toEqual([
			'sizes are given for a family the profile does not make',
		]);
		expect(problems(MediaProfile, { ...base, widths: { banner: [800, 800] } })).toEqual([
			'each size is listed once',
		]);
	});
});

describe('a plain file in the media library', () => {
	const file = {
		id: 'med_1',
		kind: 'file',
		originalFormat: 'application/pdf',
		originalByteSize: 1000,
		slug: 'price-list',
	};

	it('is stored as it is, with no image sizes', () => {
		expect(MediaAsset.safeParse(file).success).toBe(true);
		const card = {
			role: 'card',
			storageKey: 'media/med_1/price-list-card-400w.webp',
			width: 400,
			height: 533,
			byteSize: 4000,
			format: 'image/webp',
			roleVersion: 1,
		};
		expect(problems(MediaAsset, { ...file, derivatives: [card] })).toContain(
			'a plain file is stored as it is and has no image sizes',
		);
	});
});

describe('Page Builder requests', () => {
	it('a copy names the layout it copies, and a template start names the template', () => {
		expect(problems(CreateLayoutRequest, { name: 'Diwali' })).toEqual([]);
		expect(problems(CreateLayoutRequest, { name: 'Diwali', start: 'copy', copyOf: 'lay_1' })).toEqual([]);
		expect(problems(CreateLayoutRequest, { name: 'Diwali', start: 'template', template: 'today' })).toEqual([]);
		expect(problems(CreateLayoutRequest, { name: 'Diwali', start: 'copy' })).toEqual([
			'a copy names the layout it copies',
		]);
		expect(problems(CreateLayoutRequest, { name: 'Diwali', start: 'template' })).toEqual([
			'a template start names the template',
		]);
	});

	it('a timed switch ends after it starts', () => {
		const from = '2026-12-01T00:00:00.000Z';
		expect(problems(GoLiveRequest, { expectedDraftId: 'd1' })).toEqual([]);
		expect(problems(GoLiveRequest, { expectedDraftId: 'd1', from, until: '2026-12-02T00:00:00.000Z' })).toEqual([]);
		expect(problems(GoLiveRequest, { expectedDraftId: 'd1', from, until: from })).toEqual([
			'a switch must end after it starts',
		]);
	});
});

describe('bulk product actions', () => {
	it('take each product once', () => {
		expect(problems(ProductBulkWrite, { ids: ['p1', 'p2'] })).toEqual([]);
		expect(problems(ProductBulkWrite, { ids: ['p1', 'p1'] })).toEqual(['Each product may appear once']);
		const line = (productId: string) => ({ productId, rule: { kind: 'percent', value: 10 } });
		expect(problems(ProductSaleWrite, { eventId: null, lines: [line('p1'), line('p2')] })).toEqual([]);
		expect(problems(ProductSaleWrite, { eventId: null, lines: [line('p1'), line('p1')] })).toEqual([
			'Each product once',
		]);
	});
});
