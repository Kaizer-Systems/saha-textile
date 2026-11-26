import type { MediaAsset } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MediaZipRecord } from '../src/ports/media-zip.repository';
import { buildZip, publicZip, sweepZips, zipContents, zipEntryName, type ZipBuildDeps } from '../src/media/zip';

const file = (id: string, over: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id,
		displayName: 'Red',
		slug: id,
		originalStorageKey: `media/${id}/original.jpg`,
		originalByteSize: 3,
		processing: { state: 'ready' },
		trashedAt: null,
		folderId: null,
		...over,
	}) as MediaAsset;
const record = (over: Partial<MediaZipRecord> = {}): MediaZipRecord =>
	({
		id: 'z1',
		userId: 'u1',
		name: 'My files.zip',
		state: 'adding',
		fileIds: ['med_1'],
		folderIds: [],
		storageKey: 'zips/z1.zip',
		...over,
	}) as MediaZipRecord;

function deps(
	over: {
		update?: ZipBuildDeps['zips']['update'];
		upload?: (body: AsyncIterable<Uint8Array>) => Promise<{ bytes: number }>;
		at?: number;
		zip?: MediaZipRecord | null;
	} = {},
) {
	const zip = over.zip === undefined ? record() : over.zip;
	const drain = async (body: AsyncIterable<Uint8Array>) => {
		for await (const _chunk of body) void _chunk;
		return { bytes: 3 };
	};
	return {
		folders: { findManyByIds: async () => [], findById: async () => null, listSubtree: async () => [] },
		browse: { listInFolders: async () => [] },
		assets: { findManyByIds: async () => [file('med_1')] },
		zips: { find: async () => zip, update: over.update ?? vi.fn(async () => zip) },
		storage: {
			readStream: async function* () {
				yield new Uint8Array(3);
			},
			uploadStream: async ({ body }: { body: AsyncIterable<Uint8Array> }) => (over.upload ?? drain)(body),
			delete: vi.fn(async () => {
				throw new Error('already gone');
			}),
		},
		archive: {
			write: (entries: AsyncIterable<{ read?: () => AsyncIterable<Uint8Array> }>) =>
				(async function* () {
					for await (const entry of entries)
						if (entry.read) for await (const chunk of entry.read()) yield chunk;
				})(),
		},
		now: () => new Date(over.at ?? 500),
	} as unknown as ZipBuildDeps & { storage: { delete: ReturnType<typeof vi.fn> } };
}

describe('zip contents: the remaining cases', () => {
	it('names a file with a blank name “untitled”, and numbers twins without an ending', async () => {
		expect(zipEntryName({ displayName: '  ', slug: 'x', originalStorageKey: null })).toBe('untitled');
		const twins = [
			file('a', { displayName: 'Notes', originalStorageKey: 'media/a/original' }),
			file('b', { displayName: 'Notes', originalStorageKey: 'media/b/original' }),
		];
		const contents = await zipContents(
			{
				folders: { findManyByIds: async () => [], findById: async () => null, listSubtree: async () => [] },
				browse: { listInFolders: async () => [] },
				assets: { findManyByIds: async () => twins },
			} as never,
			{ fileIds: ['a', 'b'], folderIds: [] },
		);
		expect(contents.items.map((item) => item.path)).toEqual(['Notes', 'Notes (1)']);
	});
});

describe('making a zip: the remaining cases', () => {
	it('finds nothing to do for a missing, cancelled or failed zip', async () => {
		expect(await buildZip(deps({ zip: null }), { zipId: 'z1' })).toBe('not_found');
		expect(await buildZip(deps({ zip: record({ state: 'cancelled' }) }), { zipId: 'z1' })).toBe('cancelled');
		expect(await buildZip(deps({ zip: record({ state: 'failed' }) }), { zipId: 'z1' })).toBe('failed');
	});

	it('stops and leaves nothing stored when the zip is cancelled while it is being made', async () => {
		const update = vi.fn().mockResolvedValueOnce(record()).mockResolvedValue(null);
		const d = deps({ update, at: 5000 });
		expect(await buildZip(d, { zipId: 'z1' })).toBe('cancelled');
		expect(d.storage.delete).toHaveBeenCalledWith('zips/z1.zip');
	});

	it('leaves nothing stored when the zip is cancelled at the very end', async () => {
		const update = vi.fn().mockResolvedValueOnce(record()).mockResolvedValue(null);
		expect(await buildZip(deps({ update }), { zipId: 'z1' })).toBe('cancelled');
	});

	it('records a failure with its reason, even one that is not an Error', async () => {
		const update = vi.fn(async () => record());
		const d = deps({
			update,
			upload: async () => {
				throw 'storage said no';
			},
		});
		expect(await buildZip(d, { zipId: 'z1' })).toBe('failed');
		expect(update).toHaveBeenLastCalledWith('z1', { state: 'failed', error: 'storage said no' });
	});

	it('calls a failure after a cancel a cancel', async () => {
		const update = vi.fn().mockResolvedValueOnce(record()).mockResolvedValue(null);
		const d = deps({
			update,
			at: 5000,
			upload: async (body) => {
				for await (const _chunk of body) void _chunk;
				throw new Error('stream closed');
			},
		});
		expect(await buildZip(d, { zipId: 'z1' })).toBe('cancelled');
	});
});

describe('sweeping zips and showing them', () => {
	it('deletes each due zip even when its file is already gone, and marks a ready one expired', async () => {
		const finishSweep = vi.fn();
		const swept = await sweepZips({
			zips: {
				listToSweep: async () => [record({ state: 'ready' }), record({ id: 'z2', state: 'failed' })],
				finishSweep,
			},
			storage: { delete: async () => Promise.reject(new Error('gone')) },
			releaseHold: vi.fn(),
			now: () => new Date('2026-11-20T00:00:00Z'),
		} as never);
		expect(swept).toBe(2);
		expect(finishSweep.mock.calls).toEqual([
			['z1', 'expired'],
			['z2', 'failed'],
		]);
	});

	it('shows a zip without who asked, what was picked or where it is stored', () => {
		expect(publicZip(record())).toEqual({ id: 'z1', name: 'My files.zip', state: 'adding' });
	});
});
