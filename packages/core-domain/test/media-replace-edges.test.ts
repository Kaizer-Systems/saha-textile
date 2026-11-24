import type { ImageDerivative, MediaAsset, MediaReplacement, MediaVersion } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	ImageDecodeError,
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	checkReplace,
	keptAfterReplace,
	keptAfterSwap,
	olderVersions,
	replaceMediaAsset,
	sweepKeptFiles,
	type ImageCodecPort,
	type MediaAssetRepository,
	type MediaJob,
	type StoragePort,
} from '../src/index';

const profiles = new Map(SEEDED_MEDIA_PROFILES.map((profile) => [profile.key, profile]));
const product = profiles.get('product_3x4') as (typeof SEEDED_MEDIA_PROFILES)[number];
const NOW = new Date('2026-11-16T10:00:00.000Z');

const ready = (id: string): MediaVersion => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return {
		id,
		profileKey,
		profileVersion: 1,
		fill: fill as MediaVersion['fill'],
		state: 'ready',
		error: null,
		createdAt: '2026-11-10T00:00:00.000Z',
	};
};
const file = (
	versionId: string | null,
	role: string,
	width: number,
	over: Partial<ImageDerivative> = {},
): ImageDerivative => ({
	role,
	storageKey: `media/med_r/${versionId ?? 'photo'}/${role}-${width}w-old.webp`,
	width,
	height: Math.round((width * 4) / 3),
	byteSize: 100,
	format: 'image/webp',
	roleVersion: 1,
	versionId,
	...over,
});
const photo = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id: 'med_r',
		kind: 'image',
		purpose: 'product',
		originalStorageKey: 'media/med_r/original.jpg',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		width: 3000,
		height: 4000,
		slug: 'red-banarasi',
		derivatives: [file('product_3x4.as_is', 'card', 400)],
		versions: [ready('product_3x4.as_is')],
		dominantColor: '#111111',
		thumbHash: 'OLD',
		visibility: 'public',
		processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-10T00:00:00.000Z' },
		warnings: [],
		servesAsPrimary: false,
		maxDisplayWidth: null,
		renditions: [],
		hlsPlaylistKey: null,
		durationSeconds: null,
		text: { alt: { en: 'Red saree' }, title: {}, caption: {} },
		status: 'draft',
		uploadedBy: null,
		deletedAt: null,
		...overrides,
	}) as MediaAsset;
const queued = (overrides: Partial<MediaReplacement> = {}): MediaReplacement => ({
	key: 'media/med_r/original-20261116095900.jpg',
	contentType: 'image/jpeg',
	byteSize: 2000,
	width: 3000,
	height: 4000,
	sha256: null,
	phase: 'queued',
	reason: 'replace',
	made: 0,
	total: 0,
	error: null,
	startedAt: '2026-11-16T09:59:00.000Z',
	by: 'adm_1',
	...overrides,
});

const harness = (
	start: MediaAsset,
	options: {
		probe?: () => Promise<unknown>;
		download?: () => Promise<Uint8Array>;
		render?: ImageCodecPort['render'];
		finish?: boolean;
		profilesList?: () => Promise<unknown[]>;
	} = {},
) => {
	let row = start;
	const jobs: MediaJob[] = [];
	const assets = {
		moveReplace: async (
			_id: string,
			from: readonly MediaReplacement['phase'][],
			change: Partial<MediaReplacement> | null,
		) => {
			if (!row.replacing || !from.includes(row.replacing.phase)) return null;
			row = { ...row, replacing: change ? { ...row.replacing, ...change } : null };
			return row;
		},
		finishReplace: async (input: Parameters<MediaAssetRepository['finishReplace']>[0]) => {
			if (options.finish === false) return null;
			row = {
				...row,
				...input.set,
				derivatives: [...input.derivatives],
				versions: [...input.versions],
				keptFiles: [...input.keptFiles],
				replacing: null,
			};
			return row;
		},
	};
	const storage = {
		download: options.download ?? (async () => new Uint8Array(2000)),
		upload: async () => undefined,
		getUrl: (key: string) => `https://cdn.example.test/${key}`,
	} as unknown as StoragePort;
	const codec: ImageCodecPort = {
		probe: (options.probe ??
			(async () => ({ width: 3000, height: 4000, format: 'jpeg', hasAlpha: false }))) as never,
		render:
			options.render ??
			(async (_bytes, spec) => ({
				bytes: new Uint8Array(10),
				width: spec.width,
				height: spec.height ?? spec.width,
				sha256: `${spec.width}`.padEnd(8, 'a'),
			})),
		placeholder: async () => ({ thumbHash: 'NEW', dominantColor: '#aa3322' }),
	};
	const emailPictures = { keep: vi.fn() };
	const deps = {
		assets: assets as unknown as MediaAssetRepository,
		roles: {
			list: async () => [...SEEDED_MEDIA_ROLES],
			findByKey: async () => null,
			save: async (role: never) => role,
			insertMissing: async () => 0,
		},
		profiles: { list: options.profilesList ?? (async () => [...SEEDED_MEDIA_PROFILES]) },
		storage,
		codec,
		queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
		emailPictures,
		now: () => NOW,
	};
	return { deps: deps as never, jobs, emailPictures, row: () => row };
};
const same = { contentType: 'image/jpeg', byteSize: 2000, width: 3000, height: 4000 };

describe('checking and keeping files for a Replace: the remaining cases', () => {
	it('has no versions to remake on a photo that never had any, and refuses a version of an unknown profile', () => {
		expect(checkReplace({ asset: photo({ versions: undefined } as never), profiles, photo: same }).refusal).toBe(
			'no_versions',
		);
		expect(
			checkReplace({ asset: photo({ versions: [ready('gone_profile.as_is')] }), profiles, photo: same }),
		).toEqual({
			refusal: 'versions_refused',
			versions: [{ versionId: 'gone_profile.as_is', refusal: 'profile_unknown' }],
		});
	});

	it('counts an old file of unknown size as no bytes', () => {
		const kept = keptAfterReplace(
			{ derivatives: [file('v', 'card', 400, { byteSize: undefined } as never)], originalStorageKey: null },
			{ derivatives: [], originalStorageKey: 'media/med_r/new.jpg' },
			NOW,
		);
		expect(kept?.bytes).toBe(0);
	});

	it('has no older versions for a photo without a size or without versions', () => {
		expect(olderVersions(photo({ width: null } as never), product)).toEqual([]);
		expect(olderVersions(photo({ versions: undefined } as never), { ...product, version: 9 })).toEqual([]);
	});

	it('keeps untouched entries, drops entries the new set uses entirely, and adds nothing new', () => {
		const untouched = {
			keys: ['media/med_r/a.webp'],
			bytes: 10,
			deleteAfter: '2026-11-20',
			reason: 'replace' as const,
		};
		const reused = {
			keys: ['media/med_r/b.webp'],
			bytes: 10,
			deleteAfter: '2026-11-20',
			reason: 'replace' as const,
		};
		const fresh = {
			derivatives: [file('v', 'card', 400, { storageKey: 'media/med_r/b.webp', byteSize: undefined } as never)],
			originalStorageKey: 'media/med_r/o.jpg',
		};
		expect(keptAfterSwap([untouched, reused], fresh, null)).toEqual([untouched]);
	});
});

describe('the worker’s Replace: the remaining cases', () => {
	const claim = (over: Partial<MediaReplacement> = {}, asset: Partial<MediaAsset> = {}) =>
		photo({ replacing: queued(over), ...asset });

	it('stops when the upload is missing, is not an image, or is over the limits', async () => {
		const missing = harness(claim(), { download: async () => Promise.reject(new Error('404')) });
		expect(await replaceMediaAsset(missing.deps, { assetId: 'med_r' })).toEqual({
			status: 'rejected',
			reason: 'upload_missing',
		});
		const notImage = harness(claim(), { probe: async () => Promise.reject(new ImageDecodeError('bad')) });
		expect(await replaceMediaAsset(notImage.deps, { assetId: 'med_r' })).toEqual({
			status: 'rejected',
			reason: 'not_an_image',
		});
		const huge = harness(claim(), {
			probe: async () => ({ width: 9000, height: 12000, format: 'jpeg', hasAlpha: false }),
		});
		expect(await replaceMediaAsset(huge.deps, { assetId: 'med_r' })).toMatchObject({ status: 'rejected' });
	});

	it('lets an unexpected decoding error through', async () => {
		const broken = harness(claim(), { probe: async () => Promise.reject(new Error('library crashed')) });
		await expect(replaceMediaAsset(broken.deps, { assetId: 'med_r' })).rejects.toThrow('library crashed');
	});

	it('names the version it could not render and sends the new files away, public addresses too', async () => {
		const run = harness(claim(), {
			render: async (_bytes, spec) => {
				if (spec.format === 'image/webp') throw new Error('render');
				return {
					bytes: new Uint8Array(10),
					width: spec.width,
					height: spec.height ?? spec.width,
					sha256: 'abcdabcd',
				};
			},
		});
		const outcome = await replaceMediaAsset(run.deps, { assetId: 'med_r' });
		expect(outcome).toEqual({ status: 'rejected', reason: 'product_3x4.as_is: render_failed' });
		expect(run.jobs.at(-1)).toMatchObject({ type: 'delete-objects' });
	});

	it('gives up when the photo was taken away during the Replace', async () => {
		const run = harness(claim(), { finish: false });
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toEqual({
			status: 'rejected',
			reason: 'replace_gone',
		});
	});

	it('changes nothing for a refresh of a profile that no longer exists', async () => {
		const run = harness(claim({ reason: 'refresh', profileKey: 'gone' } as never), {
			profilesList: async () => [],
		});
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toEqual({
			status: 'ready',
			rendered: 0,
			skipped: 0,
		});
	});

	it('remakes only the crop versions for a new focal point, keeping the rest', async () => {
		const run = harness(
			claim(
				{ reason: 'focal', width: 4000, height: 3000 },
				{
					width: 4000,
					height: 3000,
					versions: [ready('product_3x4.as_is'), ready('product_3x4.crop')],
					derivatives: [file('product_3x4.as_is', 'card', 400), file('product_3x4.crop', 'card', 400)],
				},
			),
			{ probe: async () => ({ width: 4000, height: 3000, format: 'jpeg', hasAlpha: false }) },
		);
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toMatchObject({ status: 'ready' });
		expect(run.row().versions?.map((version) => version.id)).toEqual(['product_3x4.as_is', 'product_3x4.crop']);
	});

	it('keeps the email pictures the old photo leaves behind', async () => {
		const run = harness(
			claim({}, { derivatives: [file(null, 'email_thumb', 300, { storageKey: 'email/med_r/thumb.jpg' })] }),
		);
		await replaceMediaAsset(run.deps, { assetId: 'med_r' });
		expect(run.emailPictures.keep).toHaveBeenCalled();
	});
});

describe('the daily kept-files sweep: the remaining cases', () => {
	it('drops a photo with nothing kept, and sends a private photo’s files away without addresses', async () => {
		const queue = { enqueue: vi.fn() };
		const dropKept = vi.fn();
		const due = [
			photo({ keptFiles: undefined } as never),
			photo({
				id: 'med_p',
				visibility: 'private',
				keptFiles: [
					{
						keys: ['media/med_p/card-old.webp'],
						bytes: 1,
						deleteAfter: '2026-11-01T00:00:00.000Z',
						reason: 'replace',
					},
				],
			} as never),
		];
		expect(
			await sweepKeptFiles(
				{
					assets: { listKeptDue: async () => due, dropKept },
					queue,
					storage: { getUrl: (key: string) => key },
				} as never,
				NOW,
			),
		).toBe(2);
		expect(queue.enqueue).toHaveBeenCalledTimes(1);
		expect(queue.enqueue).toHaveBeenCalledWith({
			type: 'delete-objects',
			keys: ['media/med_p/card-old.webp'],
			urls: [],
		});
	});
});

describe('the worker’s Replace: a photo with no versions list, and a private photo that fails', () => {
	it('moves the focal point of a photo with no versions list, keeping it without versions', async () => {
		const run = harness(photo({ replacing: queued({ reason: 'focal' }), versions: undefined } as never));
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toMatchObject({ status: 'ready' });
		expect(run.row().versions).toEqual([]);
	});

	it('renames the files of a photo with no versions list', async () => {
		const run = harness(
			photo({ replacing: queued({ reason: 'rename', slug: 'maroon-banarasi' }), versions: undefined } as never),
		);
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toMatchObject({ status: 'ready' });
		expect(run.row().versions).toEqual([]);
	});

	it('sends a private photo’s files away without addresses when its Replace fails', async () => {
		const run = harness(photo({ replacing: queued(), visibility: 'private' }), {
			download: async () => Promise.reject(new Error('404')),
		});
		expect(await replaceMediaAsset(run.deps, { assetId: 'med_r' })).toEqual({
			status: 'rejected',
			reason: 'upload_missing',
		});
		expect(run.jobs.at(-1)).toMatchObject({ type: 'delete-objects', urls: [] });
	});
});
