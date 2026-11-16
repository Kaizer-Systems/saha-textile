import { BadRequestException } from '@nestjs/common';
import { MediaAsset, type MediaReplacement } from '@saha-textile/contracts';
import { SEEDED_MEDIA_PROFILES } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { MediaReplaceService } from '../src/media/media-replace.service';

/** Replace a photo (media step 3b; S7, C05, C08): the API's part, with in-memory stores. */
const harness = () => {
	const files = new Map<string, MediaAsset>();
	const used = new Map<string, string[]>();
	const jobs: unknown[] = [];
	const audit: { action: string; entityId: string | null }[] = [];
	const deleted: string[] = [];
	const assets = {
		findById: async (id: string) => files.get(id) ?? null,
		startReplace: async (id: string, replacing: MediaReplacement) => {
			const asset = files.get(id);
			if (!asset || (asset.replacing && asset.replacing.phase !== 'failed')) return null;
			if (asset.versions?.some((version) => version.state === 'making')) return null;
			files.set(id, { ...asset, replacing });
			return files.get(id) ?? null;
		},
		moveReplace: async (id: string, from: string[], change: Partial<MediaReplacement> | null) => {
			const asset = files.get(id);
			if (!asset?.replacing || !from.includes(asset.replacing.phase)) return null;
			files.set(id, { ...asset, replacing: change ? { ...asset.replacing, ...change } : null });
			return files.get(id) ?? null;
		},
	};
	(assets as Record<string, unknown>)['setFocal'] = async (id: string, focal: { x: number; y: number } | null) => {
		files.set(id, { ...(files.get(id) as MediaAsset), focal });
	};
	const storageCheck = { admit: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
	const service = new MediaReplaceService(
		assets as never,
		{ whereUsed: async (ids: readonly string[]) => new Map(ids.map((id) => [id, used.get(id) ?? []])) } as never,
		{ findByKey: async (key: string) => SEEDED_MEDIA_PROFILES.find((row) => row.key === key) ?? null },
		{
			createSignedUploadUrl: async ({ key }: { key: string }) => ({ url: `https://spaces.test/${key}?signed` }),
			delete: async (key: string) => void deleted.push(key),
		} as never,
		{ enqueue: async (job: unknown) => void jobs.push(job) },
		{
			append: async (entry: { action: string; entityId: string | null }) => (audit.unshift(entry), entry),
		} as never,
		storageCheck as never,
	);
	const photo = (id: string, overrides: Record<string, unknown> = {}) =>
		files.set(
			id,
			MediaAsset.parse({
				id,
				kind: 'image',
				originalFormat: 'image/jpeg',
				originalByteSize: 1000,
				originalStorageKey: `media/${id}/original.jpg`,
				slug: id.replace(/_/g, '-'),
				displayName: `${id}.jpg`,
				width: 3000,
				height: 4000,
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
				processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
				...overrides,
			}),
		);
	return { service, files, used, jobs, audit, deleted, storageCheck, photo };
};

const NEW = { fileName: 'reshoot.jpg', contentType: 'image/jpeg', byteSize: 2_000_000, width: 3000, height: 4000 };
const NOW = new Date('2026-11-16T10:00:00.000Z');

const refusal = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BadRequestException);
		const issue = ((error as BadRequestException).getResponse() as { issues?: { code: string; message: string }[] })
			.issues?.[0];
		return issue;
	}
	throw new Error('expected a refusal');
};

describe('Replace a photo (media step 3b)', () => {
	it('checks the new photo, holds storage for it and its versions, and gives an upload address beside the old one', async () => {
		const h = harness();
		h.photo('med_r');
		const upload = await h.service.start('adm_1', 'med_r', NEW, NOW);
		expect(upload.uploadUrl).toBe('https://spaces.test/media/med_r/original-20261116100000.jpg?signed');
		// The new photo plus one version at 35% (R4-7).
		expect(h.storageCheck.admit).toHaveBeenCalledWith('adm_1', 2_700_000, undefined, 'res_replace_med_r', NOW);
		expect(h.files.get('med_r')?.replacing).toMatchObject({ phase: 'uploading', by: 'adm_1', width: 3000 });
		// One at a time.
		expect((await refusal(h.service.start('adm_1', 'med_r', NEW, NOW)))?.code).toBe('replacing');
	});

	it('names the versions a different photo could not make, and refuses before anything is held', async () => {
		const h = harness();
		h.photo('med_r');
		const issue = await refusal(h.service.start('adm_1', 'med_r', { ...NEW, width: 4000, height: 2000 }, NOW));
		expect(issue?.code).toBe('versions_refused');
		expect(issue?.message).toContain('product_3x4.as_is (fill_not_offered)');
		expect(h.storageCheck.admit).not.toHaveBeenCalled();
		expect(
			(await refusal(h.service.start('adm_1', 'med_r', { ...NEW, contentType: 'image/heic' }, NOW)))?.code,
		).toBe('photo_type_waits');
	});

	it('finishing the upload queues the worker, gives back the hold, and is recorded; status follows it', async () => {
		const h = harness();
		h.photo('med_r');
		h.used.set('med_r', ['product · Red Banarasi Silk', 'product · Bridal Red Set']);
		await h.service.start('adm_1', 'med_r', NEW, NOW);
		const status = await h.service.finish('adm_1', 'med_r');
		expect(status).toEqual({ phase: 'queued', made: 0, total: 0, error: null, places: 2 });
		expect(h.jobs).toEqual([{ type: 'replace', assetId: 'med_r' }]);
		expect(h.storageCheck.release).toHaveBeenCalledWith('res_replace_med_r');
		expect(h.audit[0]).toMatchObject({ action: 'media.replace', entityId: 'med_r' });
		// Finishing twice does nothing more.
		expect((await refusal(h.service.finish('adm_1', 'med_r')))?.code).toBe('not_uploading');
		// Once the worker swapped it in, nothing is running: done.
		h.files.set('med_r', { ...(h.files.get('med_r') as MediaAsset), replacing: null });
		expect(await h.service.status('med_r')).toMatchObject({ phase: 'done', made: 0, total: 0, places: 2 });
	});

	it('cancel drops an upload still under way, or a failed Replace, with its bytes; not one being made', async () => {
		const h = harness();
		h.photo('med_r');
		await h.service.start('adm_1', 'med_r', NEW, NOW);
		await h.service.cancel('med_r');
		expect(h.files.get('med_r')?.replacing).toBeNull();
		expect(h.deleted).toEqual(['media/med_r/original-20261116100000.jpg']);
		await h.service.start('adm_1', 'med_r', NEW, NOW);
		await h.service.finish('adm_1', 'med_r');
		expect((await refusal(h.service.cancel('med_r')))?.code).toBe('not_cancellable');
	});

	it('a photo in Trash or a missing one is not found; versions being made wait', async () => {
		const h = harness();
		h.photo('med_t', { trashedAt: '2026-11-16T00:00:00.000Z' });
		await expect(h.service.start('adm_1', 'med_t', NEW, NOW)).rejects.toThrow('File not found');
		h.photo('med_m', {
			versions: [
				{
					id: 'product_3x4.white',
					profileKey: 'product_3x4',
					profileVersion: 1,
					fill: 'white',
					state: 'making',
					createdAt: '2026-11-16T00:00:00.000Z',
				},
			],
		});
		expect((await refusal(h.service.start('adm_1', 'med_m', NEW, NOW)))?.code).toBe('versions_making');
	});
});

describe('a focal point (S10, C06, media step 3c)', () => {
	const crop = {
		id: 'product_3x4.crop',
		profileKey: 'product_3x4',
		profileVersion: 1,
		fill: 'crop',
		state: 'ready',
		createdAt: '2026-11-16T00:00:00.000Z',
	};

	it('is saved and the Crop versions are remade from the same original; the worker takes it', async () => {
		const h = harness();
		h.photo('med_f', { width: 4000, height: 2000, versions: [crop] });
		const status = await h.service.setFocal('adm_1', 'med_f', { x: 0.3, y: 0.4 }, NOW);
		expect(h.files.get('med_f')?.focal).toEqual({ x: 0.3, y: 0.4 });
		expect(h.files.get('med_f')?.replacing).toMatchObject({
			reason: 'focal',
			phase: 'queued',
			key: 'media/med_f/original.jpg',
		});
		expect(h.jobs).toEqual([{ type: 'replace', assetId: 'med_f' }]);
		expect(h.audit[0]).toMatchObject({ action: 'media.focal', entityId: 'med_f' });
		expect(status.phase).toBe('queued');
	});

	it('a photo with no Crop version just keeps the point; while versions are made or a Replace runs, it waits', async () => {
		const h = harness();
		h.photo('med_n');
		await h.service.setFocal('adm_1', 'med_n', null, NOW);
		expect(h.jobs).toEqual([]);
		expect(h.files.get('med_n')?.focal).toBeNull();
		h.photo('med_m', { versions: [{ ...crop, state: 'making' }] });
		expect((await refusal(h.service.setFocal('adm_1', 'med_m', { x: 0.5, y: 0.5 }, NOW)))?.code).toBe(
			'focal_waits',
		);
	});
});
