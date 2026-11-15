import type { MediaAsset, MediaFolder } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import type { MediaJob } from '../src/ports/media-job-queue.port';
import {
	type DeleteForeverDeps,
	deleteMediaForever,
	publicKeys,
	purgeMediaTrash,
	storedKeys,
} from '../src/media/library-use-cases';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const asset = (id: string, over: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id,
		kind: 'image',
		purpose: 'product',
		originalStorageKey: `media/${id}/original.jpg`,
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		width: 900,
		height: 1200,
		slug: id,
		derivatives: [
			{
				role: 'card',
				roleVersion: 1,
				width: 400,
				height: 533,
				format: 'image/webp',
				storageKey: `media/${id}/card.webp`,
				byteSize: 200,
			},
		],
		renditions: [],
		hlsPlaylistKey: null,
		visibility: 'public',
		folderId: null,
		trashedAt: null,
		...over,
	}) as MediaAsset;

const folder = (id: string, over: Partial<MediaFolder> = {}): MediaFolder =>
	({
		id,
		name: id,
		parentId: null,
		ancestors: [],
		files: 0,
		bytes: 0,
		trashedAt: null,
		trashedFrom: null,
		...over,
	}) as MediaFolder;

/** In-memory stores for the use cases (a test double, so it lives here). */
function world(assets: MediaAsset[], folders: MediaFolder[]) {
	const files = new Map(assets.map((row) => [row.id, row]));
	const dirs = new Map(folders.map((row) => [row.id, row]));
	const jobs: MediaJob[] = [];
	const audit: Array<{ action: string; metadata: Record<string, unknown> }> = [];
	const removedStars: Array<[string, readonly string[]]> = [];
	const removedLinks: string[] = [];
	const deps = {
		folders: {
			findManyByIds: async (ids: readonly string[]) => ids.map((id) => dirs.get(id)).filter((row) => !!row),
			listSubtree: async (id: string) =>
				[...dirs.values()].filter((row) => row.id === id || row.ancestors.includes(id)),
			listTrashed: async () => [...dirs.values()].filter((row) => row.trashedAt),
			hardDelete: async (ids: readonly string[]) => ids.forEach((id) => dirs.delete(id)),
		},
		files: {
			listInFolders: async (ids: readonly string[]) =>
				[...files.values()].filter((row) => ids.includes(row.folderId ?? '')),
			listTrashedBefore: async (cutoff: string, limit: number) =>
				[...files.values()].filter((row) => row.trashedAt && row.trashedAt <= cutoff).slice(0, limit),
		},
		assets: {
			findManyByIds: async (ids: readonly string[]) => ids.map((id) => files.get(id)).filter((row) => !!row),
			hardDelete: async (id: string) => void files.delete(id),
		},
		stars: { removeTargets: async (type: string, ids: readonly string[]) => void removedStars.push([type, ids]) },
		links: { removeForAssets: async (ids: readonly string[]) => (removedLinks.push(...ids), ids.length) },
		queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
		publicUrl: (key: string) => `https://cdn.example/${key}`,
		record: async (action: string, metadata: Record<string, unknown>) => void audit.push({ action, metadata }),
	} as unknown as DeleteForeverDeps;
	return { deps, files, dirs, jobs, audit, removedStars, removedLinks };
}

describe('stored and public keys', () => {
	it('lists every stored object and only what the CDN can hold', () => {
		const photo = asset('med_a');
		expect(storedKeys(photo)).toEqual(['media/med_a/original.jpg', 'media/med_a/card.webp']);
		expect(publicKeys(photo)).toEqual(['media/med_a/card.webp']);
		const pdf = asset('med_p', { kind: 'file', derivatives: [], originalFormat: 'application/pdf' });
		expect(publicKeys(pdf)).toEqual(['media/med_p/original.jpg']);
		expect(publicKeys({ ...pdf, visibility: 'private' })).toEqual([]);
	});
});

describe('delete forever', () => {
	it('refuses anything not in Trash and changes nothing', async () => {
		const w = world([asset('med_a')], []);
		expect(await deleteMediaForever(w.deps, { fileIds: ['med_a'], folderIds: [] })).toEqual({
			ok: false,
			reason: 'not_in_trash',
		});
		expect(w.files.size).toBe(1);
		expect(w.jobs).toEqual([]);
	});

	it('deletes a trashed folder with what inside is in Trash, queues the objects and the CDN purge', async () => {
		const w = world(
			[
				asset('med_in', { folderId: 'fld_b', trashedAt: daysAgo(2) }),
				asset('med_alone', { trashedAt: daysAgo(2), visibility: 'private' }),
			],
			[
				folder('fld_a', { trashedAt: daysAgo(2) }),
				folder('fld_b', { parentId: 'fld_a', ancestors: ['fld_a'], trashedAt: daysAgo(2) }),
			],
		);
		const result = await deleteMediaForever(w.deps, { fileIds: ['med_alone'], folderIds: ['fld_a'] });
		expect(result).toMatchObject({ ok: true, done: 2 });
		expect(w.files.size).toBe(0);
		expect(w.dirs.size).toBe(0);
		expect(w.jobs).toEqual([
			{
				type: 'delete-objects',
				keys: [
					'media/med_alone/original.jpg',
					'media/med_alone/card.webp',
					'media/med_in/original.jpg',
					'media/med_in/card.webp',
				],
				urls: ['https://cdn.example/media/med_in/card.webp'],
			},
		]);
		expect(w.audit[0]?.action).toBe('media.delete_forever');
		expect(w.removedStars.map(([type]) => type)).toEqual(['file', 'folder']);
		expect(w.removedLinks.sort()).toEqual(['med_alone', 'med_in']);
	});
});

describe('nightly Trash purge', () => {
	it('removes what has been in Trash 30 days and keeps the rest', async () => {
		const w = world(
			[
				asset('med_old', { trashedAt: daysAgo(31) }),
				asset('med_new', { trashedAt: daysAgo(29) }),
				asset('med_live'),
			],
			[folder('fld_old', { trashedAt: daysAgo(30) }), folder('fld_new', { trashedAt: daysAgo(3) })],
		);
		expect(await purgeMediaTrash(w.deps, NOW)).toEqual({ files: 1, folders: 1 });
		expect([...w.files.keys()].sort()).toEqual(['med_live', 'med_new']);
		expect([...w.dirs.keys()]).toEqual(['fld_new']);
		expect(w.audit[0]?.action).toBe('media.trash_purged');
		expect(await purgeMediaTrash(world([], []).deps, NOW)).toEqual({ files: 0, folders: 0 });
	});
});
