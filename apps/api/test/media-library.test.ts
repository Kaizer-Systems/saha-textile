import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type AuditLog, MediaAsset, type MediaFolder } from '@saha-textile/contracts';
import type { MediaBrowseFilter } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryService } from '../src/media/media-library.service';

/** In-memory stand-ins for the Media page's stores: enough behaviour to test the rules end to end. */
function harness() {
	const folders = new Map<string, MediaFolder>();
	const files = new Map<string, MediaAsset>();
	const used = new Map<string, string[]>();
	const stars: { userId: string; type: 'folder' | 'file'; id: string }[] = [];
	const audit: AuditLog[] = [];
	const stopped: string[] = [];
	const deletedKeys: string[] = [];
	const live = (asset: MediaAsset) => !asset.deletedAt;

	const folderRepo = {
		findById: async (id: string) => folders.get(id) ?? null,
		findManyByIds: async (ids: readonly string[]) =>
			ids.flatMap((id) => (folders.has(id) ? [folders.get(id) as MediaFolder] : [])),
		listChildren: async (parentId: string | null, { trashed }: { trashed: boolean }) =>
			[...folders.values()].filter((row) => row.parentId === parentId && !!row.trashedAt === trashed),
		listAll: async () => [...folders.values()].filter((row) => !row.trashedAt),
		listSubtree: async (id: string) =>
			[...folders.values()].filter((row) => row.id === id || row.ancestors.includes(id)),
		listTrashed: async () => [...folders.values()].filter((row) => row.trashedAt),
		save: async (folder: MediaFolder) => (folders.set(folder.id, { ...folder }), folder),
		move: async (id: string, parentId: string | null, ancestors: readonly string[]) => {
			const folder = folders.get(id) as MediaFolder;
			const before = [...folder.ancestors, id];
			folders.set(id, { ...folder, parentId, ancestors: [...ancestors] });
			for (const row of folders.values()) {
				if (row.ancestors.includes(id))
					folders.set(row.id, {
						...row,
						ancestors: [...ancestors, id, ...row.ancestors.slice(before.length)],
					});
			}
		},
		setTrashed: async (ids: readonly string[], at: string | null, from: ReadonlyMap<string, string | null>) => {
			for (const id of ids) {
				const row = folders.get(id) as MediaFolder;
				folders.set(
					id,
					at ? { ...row, trashedAt: at, trashedFrom: from.get(id) ?? null } : { ...row, trashedAt: null },
				);
			}
		},
		hardDelete: async (ids: readonly string[]) => void ids.forEach((id) => folders.delete(id)),
		recount: vi.fn(async () => undefined),
	};
	const browseRepo = {
		browse: async (filter: MediaBrowseFilter) => {
			const items = [...files.values()].filter(
				(asset) =>
					live(asset) &&
					!!asset.trashedAt === filter.trashed &&
					(filter.folderId === undefined || (asset.folderId ?? null) === filter.folderId) &&
					(!filter.withinFolders || filter.withinFolders.includes(asset.folderId ?? '')) &&
					(!filter.ids || filter.ids.includes(asset.id)) &&
					(!filter.search || (asset.displayName ?? '').toLowerCase().includes(filter.search.toLowerCase())),
			);
			return { items, total: items.length, page: filter.page, pageSize: filter.pageSize };
		},
		findBySha256: async (hashes: readonly string[]) =>
			[...files.values()].filter((asset) => !asset.trashedAt && hashes.includes(asset.sha256 ?? '')),
		namesIn: async (folderId: string | null) =>
			[...files.values()]
				.filter((asset) => (asset.folderId ?? null) === folderId && !asset.trashedAt)
				.map((asset) => asset.displayName ?? asset.slug),
		moveTo: async (ids: readonly string[], folderId: string | null) =>
			void ids.forEach((id) => files.set(id, { ...(files.get(id) as MediaAsset), folderId })),
		rename: async (id: string, name: string) =>
			void files.set(id, { ...(files.get(id) as MediaAsset), displayName: name }),
		setTrashed: async (
			ids: readonly string[],
			at: string | null,
			from: ReadonlyMap<string, string | null>,
			restoreTo?: ReadonlyMap<string, string | null>,
		) => {
			for (const id of ids) {
				const asset = files.get(id) as MediaAsset;
				files.set(
					id,
					at
						? { ...asset, trashedAt: at, trashedFrom: from.get(id) ?? null }
						: {
								...asset,
								trashedAt: null,
								trashedFrom: null,
								...(restoreTo?.has(id) ? { folderId: restoreTo.get(id) ?? null } : {}),
							},
				);
			}
		},
		usage: async () => ({ originals: 0, versions: 0, files: 0, trash: 0 }),
		listTrashedBefore: async (cutoff: string) =>
			[...files.values()].filter((asset) => asset.trashedAt && asset.trashedAt <= cutoff),
		totalsByFolder: async () => [],
		whereUsed: async (ids: readonly string[]) =>
			new Map(ids.filter((id) => used.has(id)).map((id) => [id, used.get(id) as string[]])),
		listInFolders: async (ids: readonly string[]) =>
			[...files.values()].filter((asset) => ids.includes(asset.folderId ?? '')),
	};
	const assetRepo = {
		findById: async (id: string) => files.get(id) ?? null,
		findManyByIds: async (ids: readonly string[]) =>
			ids.flatMap((id) => (files.has(id) ? [files.get(id) as MediaAsset] : [])),
		hardDelete: async (id: string) => void files.delete(id),
	};
	const starRepo = {
		set: async (userId: string, target: { type: 'folder' | 'file'; id: string }, on: boolean) => {
			const at = stars.findIndex(
				(row) => row.userId === userId && row.type === target.type && row.id === target.id,
			);
			if (on && at < 0) stars.push({ userId, ...target });
			if (!on && at >= 0) stars.splice(at, 1);
		},
		listForUser: async (userId: string) =>
			stars.filter((row) => row.userId === userId).map(({ type, id }) => ({ type, id })),
		listAll: async () => [...stars],
		removeTargets: async (type: string, ids: readonly string[]) => {
			for (let i = stars.length - 1; i >= 0; i -= 1)
				if (stars[i]?.type === type && ids.includes(stars[i]?.id ?? '')) stars.splice(i, 1);
		},
	};
	const links = { stopForAssets: async (ids: readonly string[]) => (stopped.push(...ids), ids.length) };
	const storage = {
		deleteMany: async (keys: readonly string[]) => void deletedKeys.push(...keys),
		getUrl: (key: string) => `https://cdn.test/${key}`,
	};
	const auditRepo = {
		append: async (entry: AuditLog) => (audit.unshift(entry), entry),
		list: async () => ({ items: [...audit], total: audit.length, page: 1, pageSize: 50 }),
	};
	const service = new MediaLibraryService(
		folderRepo as never,
		browseRepo as never,
		assetRepo as never,
		starRepo as never,
		links as never,
		storage as never,
		auditRepo as never,
	);
	const file = (id: string, overrides: Record<string, unknown> = {}) =>
		files.set(
			id,
			MediaAsset.parse({
				id,
				kind: 'image',
				originalFormat: 'image/jpeg',
				originalByteSize: 100,
				slug: id.replace(/_/g, '-'),
				originalStorageKey: `media/${id}/original.jpg`,
				displayName: `${id}.jpg`,
				...overrides,
			}),
		);
	return { service, folders, files, used, stars, audit, stopped, deletedKeys, file, recount: folderRepo.recount };
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

describe('the Media page', () => {
	it('makes folders with clean, unique names and lists them with their files', async () => {
		const h = harness();
		const photos = await h.service.createFolder('adm_1', { name: '  Product   photos ', parentId: null });
		const again = await h.service.createFolder('adm_1', { name: 'product photos', parentId: null });
		expect([photos.name, again.name]).toEqual(['Product photos', 'product photos (1)']);
		const banarasi = await h.service.createFolder('adm_1', { name: 'Banarasi', parentId: photos.id });
		expect(banarasi.ancestors).toEqual([photos.id]);
		expect(await refusalCode(h.service.createFolder('adm_1', { name: 'a/b', parentId: null }))).toBe(
			'bad_character',
		);
		h.file('med_red', { folderId: banarasi.id });
		const view = await h.service.browse('adm_1', {
			view: 'folder',
			folderId: banarasi.id,
			who: 'mine',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		});
		expect(view.breadcrumb.map((row) => row.name)).toEqual(['Product photos', 'Banarasi']);
		expect(view.files.map((row) => [row.name, row.location, row.category])).toEqual([
			['med_red.jpg', 'Product photos › Banarasi', 'images'],
		]);
		await expect(
			h.service.browse('adm_1', {
				view: 'folder',
				folderId: 'fld_none',
				who: 'mine',
				sort: 'name',
				direction: 'asc',
				page: 1,
				pageSize: 60,
			}),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('moves files with "(1)" names, never a folder into itself, and undoes a move once', async () => {
		const h = harness();
		const a = await h.service.createFolder('adm_1', { name: 'A', parentId: null });
		const b = await h.service.createFolder('adm_1', { name: 'B', parentId: a.id });
		h.file('med_1', { displayName: 'red.jpg' });
		h.file('med_2', { displayName: 'red.jpg', folderId: b.id });
		const moved = await h.service.move('adm_1', { fileIds: ['med_1'], folderIds: [], toFolderId: b.id });
		expect(moved.done).toBe(1);
		expect(h.files.get('med_1')).toMatchObject({ folderId: b.id, displayName: 'red (1).jpg' });
		expect(await refusalCode(h.service.move('adm_1', { fileIds: [], folderIds: [a.id], toFolderId: b.id }))).toBe(
			'into_itself',
		);
		await h.service.undo('adm_1', moved.undoId as string);
		expect(h.files.get('med_1')?.folderId).toBeNull();
		expect(await refusalCode(h.service.undo('adm_1', moved.undoId as string))).toBe('nothing_to_undo');
		expect(await refusalCode(h.service.undo('adm_2', 'audit_other'))).toBe('nothing_to_undo');
	});

	it('renames a file keeping its extension, and a folder; both undo', async () => {
		const h = harness();
		h.file('med_1', { displayName: 'red.jpg' });
		const renamed = await h.service.renameFile('adm_1', 'med_1', 'red-front');
		expect(h.files.get('med_1')?.displayName).toBe('red-front.jpg');
		await h.service.undo('adm_1', renamed.undoId as string);
		expect(h.files.get('med_1')?.displayName).toBe('red.jpg');
		const folder = await h.service.createFolder('adm_1', { name: 'Old', parentId: null });
		await h.service.renameFolder('adm_1', folder.id, 'New');
		expect(h.folders.get(folder.id)?.name).toBe('New');
	});

	it('keeps images the website uses out of Trash, names where, and stops share links of the rest', async () => {
		const h = harness();
		h.file('med_used');
		h.file('med_free');
		h.used.set('med_used', ['product gallery · Red Banarasi Silk']);
		const result = await h.service.trash('adm_1', { fileIds: ['med_used', 'med_free'], folderIds: [] });
		expect(result.done).toBe(1);
		expect(result.inUse).toEqual([
			{ id: 'med_used', name: 'med_used.jpg', usedOn: ['product gallery · Red Banarasi Silk'] },
		]);
		expect(h.files.get('med_free')?.trashedAt).toBeTruthy();
		expect(h.files.get('med_used')?.trashedAt ?? null).toBeNull();
		expect(h.stopped).toEqual(['med_free']);
		const trash = await h.service.browse('adm_1', {
			view: 'trash',
			who: 'mine',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		});
		expect(trash.files.map((row) => [row.id, row.daysLeft])).toEqual([['med_free', 30]]);
	});

	it('trashes a folder with everything in it, unless it holds a used image; restore brings it all back', async () => {
		const h = harness();
		const box = await h.service.createFolder('adm_1', { name: 'Box', parentId: null });
		const inner = await h.service.createFolder('adm_1', { name: 'Inner', parentId: box.id });
		h.file('med_in', { folderId: inner.id });
		const done = await h.service.trash('adm_1', { fileIds: [], folderIds: [box.id] });
		expect(done.done).toBe(1);
		expect(h.folders.get(box.id)?.trashedAt).toBeTruthy();
		expect(h.files.get('med_in')?.trashedAt).toBeTruthy();
		await h.service.undo('adm_1', done.undoId as string);
		expect(h.folders.get(box.id)?.trashedAt).toBeNull();
		expect(h.files.get('med_in')).toMatchObject({ trashedAt: null, folderId: inner.id });

		h.used.set('med_in', ['banner · Home hero']);
		const blocked = await h.service.trash('adm_1', { fileIds: [], folderIds: [box.id] });
		expect(blocked.done).toBe(0);
		expect(h.folders.get(box.id)?.trashedAt).toBeNull();
	});

	it('restores to the old folder, or to My files when that folder is in Trash too (A19)', async () => {
		const h = harness();
		const tant = await h.service.createFolder('adm_1', { name: 'Tant cotton', parentId: null });
		h.file('med_blue', { folderId: tant.id });
		await h.service.trash('adm_1', { fileIds: ['med_blue'], folderIds: [] });
		await h.service.trash('adm_1', { fileIds: [], folderIds: [tant.id] });
		await h.service.restore('adm_1', { fileIds: ['med_blue'], folderIds: [], whenFolderGone: 'my_files' });
		expect(h.files.get('med_blue')).toMatchObject({ trashedAt: null, folderId: null });
		await h.service.trash('adm_1', { fileIds: ['med_blue'], folderIds: [] });
		h.files.set('med_blue', { ...(h.files.get('med_blue') as MediaAsset), trashedFrom: tant.id });
		await h.service.restore('adm_1', { fileIds: ['med_blue'], folderIds: [], whenFolderGone: 'restore_folder' });
		expect(h.files.get('med_blue')).toMatchObject({ folderId: tant.id });
		expect(h.folders.get(tant.id)?.trashedAt).toBeNull();
	});

	it('deletes for good only from Trash, files in Spaces first; the nightly purge takes what is 30 days old', async () => {
		const h = harness();
		h.file('med_1');
		expect(await refusalCode(h.service.deleteForever('adm_1', { fileIds: ['med_1'], folderIds: [] }))).toBe(
			'not_in_trash',
		);
		await h.service.trash('adm_1', { fileIds: ['med_1'], folderIds: [] });
		await h.service.deleteForever('adm_1', { fileIds: ['med_1'], folderIds: [] });
		expect(h.files.has('med_1')).toBe(false);
		expect(h.deletedKeys).toEqual(['media/med_1/original.jpg']);
		h.file('med_old', { trashedAt: '2026-09-01T00:00:00.000Z' });
		h.file('med_new', { trashedAt: '2026-11-14T00:00:00.000Z' });
		expect(await h.service.purgeTrash(new Date('2026-11-15T00:00:00.000Z'))).toBe(1);
		expect([...h.files.keys()]).toEqual(['med_new']);
		expect(h.audit[0]).toMatchObject({ action: 'media.delete_forever', actorUserId: null, audience: 'system' });
	});

	it('keeps each admin’s stars, and everyone’s with who starred', async () => {
		const h = harness();
		h.file('med_1');
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_1', starred: true });
		await h.service.star('adm_2', { targetType: 'file', targetId: 'med_1', starred: true });
		const mine = await h.service.browse('adm_1', {
			view: 'favourites',
			who: 'mine',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		});
		expect(mine.files.map((row) => [row.id, row.starred])).toEqual([['med_1', true]]);
		const everyone = await h.service.browse('adm_3', {
			view: 'favourites',
			who: 'everyone',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		});
		expect(everyone.starredBy['file:med_1']).toEqual(['adm_1', 'adm_2']);
		await expect(
			h.service.star('adm_1', { targetType: 'folder', targetId: 'fld_none', starred: true }),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('finds the same bytes anywhere and the same name in the folder, with the name keeping both would give', async () => {
		const h = harness();
		h.file('med_same', { sha256: 'a'.repeat(64), displayName: 'front.jpg' });
		h.file('med_named', { sha256: 'b'.repeat(64), displayName: 'back.jpg' });
		const answer = await h.service.duplicates({
			folderId: null,
			files: [
				{ name: 'copy.jpg', bytes: 100, sha256: 'a'.repeat(64) },
				{ name: 'back.jpg', bytes: 100, sha256: 'c'.repeat(64) },
			],
		});
		expect(answer.files[0]).toMatchObject({
			identical: { id: 'med_same', name: 'front.jpg', location: '' },
			sameName: null,
		});
		expect(answer.files[1]).toMatchObject({
			identical: null,
			sameName: { id: 'med_named' },
			keepBothName: 'back (1).jpg',
		});
	});
});
