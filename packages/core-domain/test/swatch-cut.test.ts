import { describe, expect, it, vi } from 'vitest';

import {
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	checkCut,
	cutSwatch,
	cutPixels,
	cutSlug,
	MIN_CUT_PX,
	planCut,
	sameCutRegion,
	SWATCH_CUT_PROFILE,
} from '../src/media';

// A 3:4 product photo, 1800 × 2400.
const photo = { kind: 'image' as const, width: 1800, height: 2400, originalStorageKey: 'originals/med_1.jpg' };
const square = (x: number, y: number, px: number) => ({ x, y, width: px / 1800, height: px / 2400 });

describe('swatch cuts (owner, 21 Nov 2026, brief P11)', () => {
	it('cuts a square of a photo, and says when it will look soft', () => {
		expect(checkCut(photo, square(0.2, 0.5, 600))).toEqual({ ok: true, px: 600, soft: false });
		expect(checkCut(photo, square(0.2, 0.5, MIN_CUT_PX - 1))).toEqual({ ok: true, px: 479, soft: true });
	});

	it('refuses what cannot be a swatch', () => {
		expect(checkCut({ ...photo, kind: 'video' }, square(0, 0, 600))).toEqual({ ok: false, reason: 'not_a_photo' });
		expect(checkCut({ ...photo, originalStorageKey: null }, square(0, 0, 600))).toEqual({
			ok: false,
			reason: 'no_original',
		});
		expect(checkCut({ ...photo, width: null }, square(0, 0, 600))).toEqual({ ok: false, reason: 'no_original' });
		const cut = { ...photo, cutFrom: { assetId: 'med_0', region: square(0, 0, 600) } };
		expect(checkCut(cut, square(0, 0, 600))).toEqual({ ok: false, reason: 'is_a_cut' });
		expect(checkCut(photo, square(0.9, 0, 600))).toEqual({ ok: false, reason: 'outside_photo' });
		expect(checkCut(photo, square(0, 0.9, 600))).toEqual({ ok: false, reason: 'outside_photo' });
		expect(checkCut(photo, { x: 0, y: 0, width: 0.5, height: 0.5 })).toEqual({ ok: false, reason: 'not_square' });
		expect(checkCut(photo, square(0, 0, 10))).toEqual({ ok: false, reason: 'too_small' });
	});

	it('turns the square into pixels, kept inside the photo', () => {
		expect(cutPixels(photo, square(0.2, 0.5, 600))).toEqual({ left: 360, top: 1200, size: 600 });
		expect(cutPixels(photo, { x: 0.99, y: 0.99, width: 600 / 1800, height: 600 / 2400 })).toEqual({
			left: 1200,
			top: 1800,
			size: 600,
		});
		expect(cutPixels({ width: 100, height: 50 }, { x: 0, y: 0, width: 1, height: 1 }).size).toBe(50);
	});

	it('knows the same square again, and names the cut after its photo', () => {
		expect(sameCutRegion(square(0.2, 0.5, 600), { ...square(0.2, 0.5, 600), x: 0.2001 })).toBe(true);
		expect(sameCutRegion(square(0.2, 0.5, 600), square(0.3, 0.5, 600))).toBe(false);
		expect(cutSlug('red-saree')).toBe('red-saree-cut');
		const long = cutSlug(`${'a'.repeat(75)}-b-c`);
		expect([long.length <= 80, long.endsWith('a-cut')]).toEqual([true, true]);
	});

	it('plans a cut as a picture of its own, with one Swatch 1:1 version on its way', () => {
		const cut = planCut({
			id: 'med_2',
			photo: { id: 'med_1', slug: 'red-saree', visibility: 'public', folderId: 'fld_1' },
			region: square(0.2, 0.5, 600),
			profileVersion: 3,
			by: 'usr_1',
			at: '2026-11-21T10:00:00.000Z',
		});
		expect(cut).toMatchObject({
			id: 'med_2',
			slug: 'red-saree-cut',
			originalStorageKey: expect.stringContaining('med_2'),
			cutFrom: { assetId: 'med_1' },
			versions: [{ id: 'swatch_1x1.as_is', profileVersion: 3, state: 'making' }],
			processing: { state: 'queued' },
			folderId: 'fld_1',
			uploadedBy: { type: 'admin', id: 'usr_1' },
		});
		const anonymous = planCut({
			id: 'med_3',
			photo: { id: 'med_1', slug: 'red-saree', visibility: 'private' },
			region: square(0, 0, 600),
			profileVersion: 1,
			by: null,
			at: '2026-11-21T10:00:00.000Z',
		});
		expect([anonymous.uploadedBy, anonymous.folderId, anonymous.visibility]).toEqual([null, null, 'private']);
	});

	it('has its own built-in profile of the two square swatch families, and a 360 px Image V2 size', () => {
		const profile = SEEDED_MEDIA_PROFILES.find((entry) => entry.key === SWATCH_CUT_PROFILE);
		expect(profile).toMatchObject({
			builtIn: true,
			shape: { width: 1, height: 1 },
			roles: ['swatch_image', 'swatch_image_v2'],
		});
		expect(SEEDED_MEDIA_ROLES.find((role) => role.key === 'swatch_image_v2')?.widths).toEqual([120, 240, 360]);
	});
});

describe('cutSwatch: the worker’s cut job', () => {
	const region = { x: 0.2, y: 0.5, width: 600 / 1800, height: 600 / 2400 };
	const setup = (over: { cut?: Record<string, unknown> | null; photo?: Record<string, unknown> | null } = {}) => {
		const cut =
			over.cut === null
				? null
				: ({
						...planCut({
							id: 'med_2',
							photo: { id: 'med_1', slug: 'red-saree', visibility: 'public' },
							region,
							profileVersion: 1,
							by: null,
							at: '2026-11-21T10:00:00.000Z',
						}),
						...over.cut,
					} as never);
		const photoRow =
			over.photo === null ? null : { id: 'med_1', originalStorageKey: 'originals/med_1.jpg', ...over.photo };
		const rows = new Map<string, unknown>([
			['med_2', cut],
			['med_1', photoRow],
		]);
		const updated: Record<string, unknown>[] = [];
		const deps = {
			assets: {
				findById: vi.fn(async (id: string) => (rows.get(id) ?? null) as never),
				update: vi.fn(async (row: never) => (updated.push(row), row)),
			},
			storage: {
				download: vi.fn(async () => new Uint8Array([9])),
				upload: vi.fn(async () => ({}) as never),
			},
			cutter: { cut: vi.fn(async () => ({ bytes: new Uint8Array(10), width: 600, height: 600, sha256: 'x' })) },
			now: () => new Date('2026-11-21T10:00:00.000Z'),
			process: vi.fn(async () => ({ status: 'ready' as const, rendered: 5, skipped: 0 })),
		};
		return { deps, updated };
	};

	it('cuts the square from the photo’s original into the cut’s own, then makes its sizes', async () => {
		const { deps, updated } = setup();
		await expect(cutSwatch(deps, { assetId: 'med_2' })).resolves.toEqual({ status: 'made', px: 600 });
		expect(deps.storage.download).toHaveBeenCalledWith('originals/med_1.jpg');
		expect(deps.cutter.cut).toHaveBeenCalledWith(new Uint8Array([9]), region);
		expect(deps.storage.upload).toHaveBeenCalledWith(
			expect.objectContaining({
				key: expect.stringContaining('med_2'),
				contentType: 'image/jpeg',
				visibility: 'private',
			}),
		);
		expect(updated[0]).toMatchObject({ width: 600, height: 600, originalByteSize: 10, derivatives: [] });
		expect(updated[0]).not.toHaveProperty('keptFiles');
		expect(deps.process).toHaveBeenCalledWith('med_2');
	});

	it('cut again after a Replace, keeps the old files 7 days and makes the version again', async () => {
		const file = {
			role: 'swatch_image',
			storageKey: 'derived/old.webp',
			width: 80,
			height: 80,
			byteSize: 500,
			format: 'image/webp',
			roleVersion: 1,
			versionId: 'swatch_1x1.as_is',
		};
		const { deps, updated } = setup({
			cut: {
				derivatives: [file, { ...file, width: 160, storageKey: 'derived/old2.webp' }],
				versions: [{ id: 'swatch_1x1.as_is', state: 'ready', error: 'x' }],
			},
		});
		await cutSwatch(deps, { assetId: 'med_2' });
		expect(updated[0]).toMatchObject({
			keptFiles: [
				{
					keys: ['derived/old.webp', 'derived/old2.webp'],
					bytes: 1000,
					deleteAfter: '2026-11-28T10:00:00.000Z',
					reason: 'replace',
				},
			],
			versions: [{ state: 'making', error: null }],
			processing: { state: 'queued' },
		});
	});

	it('stops when the cut or its photo is gone, and passes on a failed run', async () => {
		expect(await cutSwatch(setup({ cut: null }).deps, { assetId: 'med_2' })).toEqual({ status: 'gone' });
		expect(
			await cutSwatch(setup({ cut: { deletedAt: '2026-11-21T09:00:00.000Z' } }).deps, { assetId: 'med_2' }),
		).toEqual({ status: 'gone' });
		expect(await cutSwatch(setup({ cut: { cutFrom: null } }).deps, { assetId: 'med_2' })).toEqual({
			status: 'gone',
		});
		expect(await cutSwatch(setup({ photo: null }).deps, { assetId: 'med_2' })).toEqual({ status: 'no_photo' });
		expect(await cutSwatch(setup({ photo: { originalStorageKey: null } }).deps, { assetId: 'med_2' })).toEqual({
			status: 'no_photo',
		});
		const failed = setup();
		failed.deps.process.mockResolvedValueOnce({ status: 'rejected', reason: 'not_an_image' } as never);
		expect(await cutSwatch(failed.deps, { assetId: 'med_2' })).toEqual({
			status: 'rejected',
			reason: 'not_an_image',
		});
	});
});
