import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaAsset } from '@saha-textile/contracts';
import { SEEDED_MEDIA_PROFILES } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { MediaReplaceService } from '../src/media/media-replace.service';

const version = (id: string, over: Record<string, unknown> = {}) => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return { id, profileKey, profileVersion: 1, fill, state: 'ready', createdAt: '2026-11-16T00:00:00.000Z', ...over };
};
const photo = (id: string, over: Record<string, unknown> = {}) =>
	MediaAsset.parse({
		id,
		kind: 'image',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		originalStorageKey: `media/${id}/original.jpg`,
		slug: id.replace(/_/g, '-'),
		width: 3000,
		height: 4000,
		versions: [version('product_3x4.as_is')],
		processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		...over,
	});

interface Setup {
	files?: MediaAsset[];
	started?: boolean;
	moved?: MediaAsset | null;
	pages?: MediaAsset[][];
	deleteFails?: boolean;
}

function setup(options: Setup = {}) {
	const files = new Map((options.files ?? []).map((row) => [row.id, row]));
	const audit: Array<{ actorUserId: string | null; audience: string; action: string }> = [];
	const pages = options.pages ?? [];
	const assets = {
		findById: async (id: string) => files.get(id) ?? null,
		startReplace: vi.fn(async (id: string) => (options.started === false ? null : (files.get(id) ?? { id }))),
		moveReplace: async () => (options.moved === undefined ? null : options.moved),
		setFocal: async () => undefined,
		listWithOlderVersions: vi.fn(async ({ after }: { after: string | null }) => {
			const index = after === null ? 0 : pages.findIndex((page) => page.at(-1)?.id === after) + 1;
			return pages[index] ?? [];
		}),
		refreshCounts: async () => ({ older: 0, running: 0, failed: 0 }),
	};
	const storage = {
		createSignedUploadUrl: async ({ key }: { key: string }) => ({ url: `https://spaces.test/${key}` }),
		delete: vi.fn(async () => (options.deleteFails ? Promise.reject(new Error('gone')) : undefined)),
	};
	const storageCheck = { admit: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
	const service = new MediaReplaceService(
		assets as never,
		{ whereUsed: async () => new Map() } as never,
		{
			findByKey: async (key: string) => {
				const row = SEEDED_MEDIA_PROFILES.find((one) => one.key === key);
				return row ? { ...row, version: row.version + 1 } : null;
			},
		},
		storage as never,
		{ enqueue: vi.fn(async () => undefined) },
		{ append: async (entry: (typeof audit)[number]) => (audit.unshift(entry), entry) } as never,
		storageCheck as never,
	);
	return { service, assets, storage, storageCheck, audit };
}

const refusalCode = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BadRequestException);
		return ((error as BadRequestException).getResponse() as { issues?: { code: string }[] }).issues?.[0]?.code;
	}
	throw new Error('expected a refusal');
};
const request = { contentType: 'image/jpeg', byteSize: 2000, width: 3000, height: 4000 } as never;

describe('Replace a photo: the remaining cases', () => {
	it('refuses a photo with no versions, and names a version whose profile is gone', async () => {
		const bare = setup({ files: [photo('med_bare', { versions: undefined })] });
		expect(await refusalCode(bare.service.start('adm_1', 'med_bare', request))).toBe('no_versions');
		const lost = setup({ files: [photo('med_lost', { versions: [version('gone_profile.as_is')] })] });
		expect(await refusalCode(lost.service.start('adm_1', 'med_lost', request))).toBe('versions_refused');
	});

	it('moves the focus only on a photo that is free, and remakes its crops when it has them', async () => {
		const file = setup({ files: [photo('med_file', { kind: 'file', originalFormat: 'application/pdf' })] });
		expect(await refusalCode(file.service.setFocal('adm_1', 'med_file', { x: 0.5, y: 0.5 }))).toBe('not_a_photo');
		const bare = setup({ files: [photo('med_bare', { versions: undefined })], moved: null });
		await expect(bare.service.setFocal('adm_1', 'med_bare', null)).resolves.toMatchObject({ phase: 'done' });
		const crop = photo('med_crop', {
			versions: [version('product_3x4.crop', { fill: 'crop' })],
			replacing: {
				key: 'k',
				contentType: 'image/jpeg',
				byteSize: 1,
				width: 1,
				height: 1,
				startedAt: '2026-11-16T00:00:00.000Z',
				phase: 'failed',
			},
		});
		const busy = setup({ files: [crop], started: false });
		expect(await refusalCode(busy.service.setFocal('adm_1', 'med_crop', { x: 0.2, y: 0.2 }))).toBe('focal_waits');
		expect(busy.storageCheck.release).toHaveBeenCalled();
	});

	it('renames through the files only for a photo with versions, after a failed Replace too', () => {
		const { service } = setup();
		expect(service.renames(photo('med_bare', { versions: undefined }))).toBe(false);
		const failed = photo('med_failed', {
			replacing: {
				key: 'k',
				contentType: 'image/jpeg',
				byteSize: 1,
				width: 1,
				height: 1,
				startedAt: '2026-11-16T00:00:00.000Z',
				phase: 'failed',
			},
		});
		expect(service.renames(failed)).toBe(true);
	});

	it('refuses a new web name for a file, a photo of no known size, or one that started meanwhile', async () => {
		const file = setup({ files: [photo('med_file', { kind: 'file', originalFormat: 'application/pdf' })] });
		expect(await refusalCode(file.service.rename('adm_1', 'med_file', 'new-name'))).toBe('not_a_photo');
		const unsized = setup({ files: [photo('med_unsized', { width: null })] });
		expect(await refusalCode(unsized.service.rename('adm_1', 'med_unsized', 'new-name'))).toBe('not_a_photo');
		const raced = setup({ files: [photo('med_raced')], started: false });
		expect(await refusalCode(raced.service.rename('adm_1', 'med_raced', 'new-name'))).toBe('rename_waits');
	});

	it('brings a profile up to date page by page, skipping photos with nothing older or no original, as the system', async () => {
		const older = (id: string, over: Record<string, unknown> = {}) => photo(id, over);
		const fullPage = Array.from({ length: 200 }, (_, index) => older(`med_${String(index).padStart(3, '0')}`));
		const lastPage = [
			older('med_new', { versions: [version('product_3x4.as_is', { profileVersion: 99 })] }),
			older('med_keyless', { originalStorageKey: null }),
		];
		const { service, assets, audit } = setup({ pages: [fullPage, lastPage] });
		const result = await service.refresh('system', 'product_3x4');
		expect(result).toEqual({ started: 200, busy: 0 });
		expect(assets.listWithOlderVersions).toHaveBeenCalledWith(expect.objectContaining({ after: 'med_199' }));
		expect(audit[0]).toMatchObject({ actorUserId: null, audience: 'system', action: 'media.profile.refresh' });
	});

	it('finishes an upload of a photo with no version list, counting none', async () => {
		const moved = photo('med_up', {
			versions: undefined,
			replacing: {
				key: 'k',
				contentType: 'image/jpeg',
				byteSize: 5,
				width: 1,
				height: 1,
				startedAt: '2026-11-16T00:00:00.000Z',
				phase: 'queued',
			},
		});
		const { service, audit } = setup({ files: [photo('med_up')], moved });
		await service.finish('adm_1', 'med_up');
		expect(audit[0]).toMatchObject({ action: 'media.replace' });
	});

	it('answers where a Replace got only for a photo still there', async () => {
		const { service } = setup({ files: [photo('med_gone', { deletedAt: '2026-11-20T00:00:00.000Z' })] });
		await expect(service.status('med_none')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.status('med_gone')).rejects.toBeInstanceOf(NotFoundException);
		const fresh = setup({ files: [photo('med_ok')] });
		expect(await fresh.service.status('med_ok')).toMatchObject({ phase: 'done', places: 0 });
	});

	it('cancels nothing for a photo gone or with no Replace, and deletes no bytes it does not know', async () => {
		const gone = setup();
		await expect(gone.service.cancel('med_none')).rejects.toBeInstanceOf(NotFoundException);
		const idle = setup({ files: [photo('med_idle')], moved: null });
		await expect(idle.service.cancel('med_idle')).resolves.toBeUndefined();
		const keyless = setup({ files: [photo('med_idle')], moved: photo('med_idle') });
		await keyless.service.cancel('med_idle');
		expect(keyless.storage.delete).not.toHaveBeenCalled();
		const failing = photo('med_fail', {
			replacing: {
				key: 'media/med_fail/new.jpg',
				contentType: 'image/jpeg',
				byteSize: 1,
				width: 1,
				height: 1,
				startedAt: '2026-11-16T00:00:00.000Z',
				phase: 'uploading',
			},
		});
		const broken = setup({ files: [failing], moved: failing, deleteFails: true });
		await expect(broken.service.cancel('med_fail')).resolves.toBeUndefined();
		expect(broken.storageCheck.release).toHaveBeenCalled();
	});
});
