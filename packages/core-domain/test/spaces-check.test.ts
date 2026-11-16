import type { MediaAsset } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { checkSpaces } from '../src/media/spaces-check';

const derivative = (assetId: string, width: number, versionId = 'product_3x4.as_is') => ({
	role: 'card',
	storageKey: `media/${assetId}/red-card-${width}w-1f3a9c2e.webp`,
	width,
	height: Math.round((width * 4) / 3),
	byteSize: width * 10,
	format: 'image/webp',
	roleVersion: 1,
	versionId,
});

const photo = (id: string, extra: Record<string, unknown> = {}): MediaAsset =>
	({
		id,
		kind: 'image',
		originalFormat: 'image/jpeg',
		originalByteSize: 100,
		slug: id.replace(/_/g, '-'),
		purpose: 'product',
		width: 3000,
		height: 4000,
		processing: { state: 'ready' },
		versions: [
			{
				id: 'product_3x4.as_is',
				profileKey: 'product_3x4',
				profileVersion: 1,
				fill: 'as_is',
				state: 'ready',
				createdAt: '2026-11-16T00:00:00.000Z',
			},
		],
		derivatives: [derivative(id, 200), derivative(id, 400)],
		deletedAt: null,
		...extra,
	}) as unknown as MediaAsset;

const listing = (keys: { key: string; bytes: number }[]) =>
	async function* () {
		for (const item of keys) yield item;
	};

describe('the nightly Spaces check (R5-5; media step 5)', () => {
	it('names used photos whose files are gone, counts files no record knows, and changes nothing', async () => {
		const kept = photo('med_kept');
		const broken = photo('med_broken', { displayName: 'Red Banarasi front.jpg' });
		const unused = photo('med_unused');
		const stored = [
			...kept.derivatives.map((row) => ({ key: row.storageKey, bytes: row.byteSize })),
			// med_broken lost its 400 px file; med_unused lost everything but nobody uses it.
			{ key: broken.derivatives[0]?.storageKey as string, bytes: 2000 },
			{ key: 'media/med_stranger/left-behind-200w-aa.webp', bytes: 777 },
			{ key: 'media/README.txt', bytes: 5 },
		];
		const records = new Map([kept, broken, unused].map((asset) => [asset.id, asset]));
		const result = await checkSpaces(
			{
				listKeys: listing(stored),
				referencedIds: async () => ['med_kept', 'med_broken'],
				findManyByIds: async (ids) => ids.flatMap((id) => records.get(id) ?? []),
				whereUsed: async (ids) => new Map(ids.map((id) => [id, ['product gallery · Red Banarasi Silk']])),
			},
			new Date('2026-11-17T04:15:00.000Z'),
		);
		expect(result.checkedAt).toBe('2026-11-17T04:15:00.000Z');
		expect(result.filesInSpaces).toBe(5);
		expect(result.missingCount).toBe(1);
		expect(result.missing).toEqual([
			{
				assetId: 'med_broken',
				name: 'Red Banarasi front.jpg',
				usedOn: ['product gallery · Red Banarasi Silk'],
				files: 1,
			},
		]);
		expect(result.unrecorded).toEqual({
			count: 1,
			bytes: 777,
			sample: ['media/med_stranger/left-behind-200w-aa.webp'],
		});
	});
});
