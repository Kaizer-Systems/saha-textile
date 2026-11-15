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
		findNamedIn: async (folderId: string | null, names: readonly string[]) =>
			[...files.values()].filter(
				(asset) =>
					(asset.folderId ?? null) === folderId &&
					!asset.trashedAt &&
					names.some((name) => name.toLowerCase() === (asset.displayName ?? asset.slug).toLowerCase()),
			),
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
		referencedIds: async () => [...used.keys()],
		whereUsed: async (ids: readonly string[]) =>
			new Map(ids.filter((id) => used.has(id)).map((id) => [id, used.get(id) as string[]])),
		listInFolders: async (ids: readonly string[]) =>
			[...files.values()].filter((asset) => ids.includes(asset.folderId ?? '')),
	};
	const assetRepo = {
		create: async (asset: MediaAsset) => (files.set(asset.id, MediaAsset.parse(asset)), asset),
		update: async (asset: MediaAsset) => (files.set(asset.id, asset), asset),
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
	const links = {
		stopForAssets: async (ids: readonly string[]) => (stopped.push(...ids), ids.length),
		removeForAssets: async (ids: readonly string[]) => ids.length,
	};
	const storage = {
		getUrl: (key: string) => `https://cdn.test/${key}`,
		createSignedUploadUrl: async ({ key }: { key: string }) => ({
			url: `https://spaces.test/${key}?signed`,
			headers: {},
		}),
		setVisibility: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
		createSignedDownloadUrl: vi.fn(
			async (input: { key: string; expiresInSeconds: number; fileName?: string; disposition?: string }) =>
				`https://spaces.test/${input.key}?for=${input.expiresInSeconds}&as=${input.disposition}&name=${input.fileName}`,
		),
	};
	const jobs: { type: string; keys?: string[]; urls: string[] }[] = [];
	// Deleting goes through a queued job that removes the objects and clears the CDN.
	const queue = {
		enqueue: async (job: { type: string; keys?: string[]; urls: string[] }) => {
			jobs.push(job);
			if (job.type === 'delete-objects') deletedKeys.push(...(job.keys ?? []));
		},
	};
	const storageCheck = { admit: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
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
		queue as never,
		storageCheck as never,
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
	return {
		service,
		folders,
		files,
		used,
		stars,
		audit,
		stopped,
		deletedKeys,
		jobs,
		storage,
		storageCheck,
		browseRepo,
		file,
		recount: folderRepo.recount,
	};
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
			{
				id: 'med_used',
				name: 'med_used.jpg',
				usedOn: ['product gallery · Red Banarasi Silk'],
				bytes: 100,
				thumbnailUrl: null,
			},
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

	it('checks before Trash which images the website uses, folders’ contents included, and moves nothing (A26)', async () => {
		const h = harness();
		const box = await h.service.createFolder('adm_1', { name: 'Box', parentId: null });
		const inner = await h.service.createFolder('adm_1', { name: 'Inner', parentId: box.id });
		h.file('med_deep', { folderId: inner.id });
		h.file('med_top', { folderId: box.id });
		h.file('med_loose');
		h.used.set('med_deep', ['banner · Home hero']);
		const check = await h.service.checkTrash({ fileIds: ['med_loose'], folderIds: [box.id] });
		// Box stays with everything in it, because Inner holds a used image; the loose file can go.
		expect(check).toEqual({
			inUse: [
				{
					id: 'med_deep',
					name: 'med_deep.jpg',
					usedOn: ['banner · Home hero'],
					bytes: 100,
					thumbnailUrl: null,
				},
			],
			total: 3,
			moving: 1,
			keptFolders: 1,
		});
		expect([...h.files.values()].every((asset) => !asset.trashedAt)).toBe(true);
		expect(h.folders.get(box.id)?.trashedAt ?? null).toBeNull();
		expect(h.audit.filter((entry) => entry.action === 'media.trash')).toHaveLength(0);
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

	it('deletes for good only from Trash, the stored files by a queued job; the nightly purge takes what is 30 days old', async () => {
		const h = harness();
		h.file('med_1');
		expect(await refusalCode(h.service.deleteForever('adm_1', { fileIds: ['med_1'], folderIds: [] }))).toBe(
			'not_in_trash',
		);
		await h.service.trash('adm_1', { fileIds: ['med_1'], folderIds: [] });
		await h.service.deleteForever('adm_1', { fileIds: ['med_1'], folderIds: [] });
		expect(h.files.has('med_1')).toBe(false);
		expect(h.deletedKeys).toEqual(['media/med_1/original.jpg']);
		expect(h.audit[0]).toMatchObject({ action: 'media.delete_forever', actorUserId: 'adm_1' });
		h.file('med_old', { trashedAt: '2026-09-01T00:00:00.000Z' });
		h.file('med_new', { trashedAt: '2026-11-14T00:00:00.000Z' });
		expect(await h.service.purgeTrash(new Date('2026-11-15T00:00:00.000Z'))).toBe(1);
		expect([...h.files.keys()]).toEqual(['med_new']);
		expect(h.audit[0]).toMatchObject({ action: 'media.trash_purged', actorUserId: null, audience: 'system' });
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

	it('break-it: a file too big to hash gets the same-name check only, whatever the letter case', async () => {
		const h = harness();
		h.file('med_video', { sha256: 'd'.repeat(64), displayName: 'Shoot.mp4' });
		const answer = await h.service.duplicates({
			folderId: null,
			files: [
				{ name: 'shoot.MP4', bytes: 1_700_000_000 },
				{ name: 'other.mp4', bytes: 1_700_000_000 },
			],
		});
		expect(answer.files[0]).toMatchObject({ identical: null, sameName: { id: 'med_video' } });
		expect(answer.files[1]).toMatchObject({ identical: null, sameName: null, keepBothName: 'other.mp4' });
	});
});

describe('plain files', () => {
	it('start private in their folder, take “(1)” when the name is taken, and pass the storage check', async () => {
		const h = harness();
		h.folders.set('fld_docs', {
			id: 'fld_docs',
			name: 'Documents',
			parentId: null,
			ancestors: [],
			files: 0,
			bytes: 0,
			trashedAt: null,
			trashedFrom: null,
		} as never);
		h.file('med_old', {
			folderId: 'fld_docs',
			displayName: 'Bridal catalogue.pdf',
			kind: 'file',
			originalFormat: 'application/pdf',
			derivatives: [],
		});
		const presigned = await h.service.presignFile(
			'adm_1',
			{ fileName: 'Bridal catalogue.pdf', contentType: 'application/pdf', byteSize: 5000, folderId: 'fld_docs' },
			new Date('2026-11-15T10:00:00.000Z'),
		);
		expect(presigned.name).toBe('Bridal catalogue (1).pdf');
		expect(presigned.uploadUrl).toContain(`media/${presigned.assetId}/original.pdf`);
		expect(h.storageCheck.admit).toHaveBeenCalledWith(
			'adm_1',
			5000,
			undefined,
			`res_${presigned.assetId}`,
			expect.any(Date),
		);
		expect(h.files.get(presigned.assetId)).toMatchObject({
			kind: 'file',
			visibility: 'private',
			folderId: 'fld_docs',
			processing: { state: 'awaiting_upload' },
		});

		const done = await h.service.finalizeFile('adm_1', presigned.assetId);
		expect(done).toEqual({ assetId: presigned.assetId, state: 'ready' });
		expect(h.files.get(presigned.assetId)?.processing.state).toBe('ready');
		expect(h.storageCheck.release).toHaveBeenCalledWith(`res_${presigned.assetId}`);
		expect(h.audit[0]).toMatchObject({ action: 'media.upload', entityId: presigned.assetId });
		// Finishing twice changes nothing.
		await h.service.finalizeFile('adm_1', presigned.assetId);
		expect(h.storageCheck.release).toHaveBeenCalledTimes(1);
	});

	it('wait for image profiles when they are photos; camera RAW and every other file upload now', async () => {
		const h = harness();
		const request = (fileName: string, contentType: string) => ({
			fileName,
			contentType,
			byteSize: 10,
			folderId: null,
		});
		expect(await refusalCode(h.service.presignFile('adm_1', request('red.jpg', 'image/jpeg')))).toBe(
			'photo_needs_profiles',
		);
		expect(await refusalCode(h.service.presignFile('adm_1', request('IMG_0412.HEIC', 'image/heic')))).toBe(
			'photo_needs_profiles',
		);
		expect(h.storageCheck.admit).not.toHaveBeenCalled();
		const raw = await h.service.presignFile('adm_1', request('DSC0412.CR3', 'image/x-canon-cr3'));
		expect(h.files.get(raw.assetId)).toMatchObject({ kind: 'file', displayName: 'DSC0412.CR3' });
	});

	it('drops one’s own unfinished upload with its stored bytes and hold, and nothing else (BOLA)', async () => {
		const h = harness();
		const mine = await h.service.presignFile('adm_1', {
			fileName: 'brief.pdf',
			contentType: 'application/pdf',
			byteSize: 10,
			folderId: null,
		});
		await expect(h.service.cancelUpload('adm_2', mine.assetId)).rejects.toBeInstanceOf(NotFoundException);
		await h.service.cancelUpload('adm_1', mine.assetId);
		expect(h.files.has(mine.assetId)).toBe(false);
		expect(h.storage.delete).toHaveBeenCalledWith(`media/${mine.assetId}/original.pdf`);
		expect(h.storageCheck.release).toHaveBeenCalledWith(`res_${mine.assetId}`);
		// A finished file is not an upload to cancel.
		h.file('med_done', { processing: { state: 'ready' }, uploadedBy: { type: 'admin', id: 'adm_1' } });
		await expect(h.service.cancelUpload('adm_1', 'med_done')).rejects.toBeInstanceOf(NotFoundException);
		expect(h.files.has('med_done')).toBe(true);
	});

	it('refuses a folder in Trash, and nothing is held', async () => {
		const h = harness();
		h.folders.set('fld_gone', {
			id: 'fld_gone',
			name: 'Gone',
			parentId: null,
			ancestors: [],
			files: 0,
			bytes: 0,
			trashedAt: '2026-11-10T00:00:00.000Z',
			trashedFrom: null,
		} as never);
		expect(
			await refusalCode(
				h.service.presignFile('adm_1', {
					fileName: 'a.pdf',
					contentType: 'application/pdf',
					byteSize: 1,
					folderId: 'fld_gone',
				}),
			),
		).toBe('target_in_trash');
		expect(h.storageCheck.admit).not.toHaveBeenCalled();
	});

	it('go public with a permanent address and back to private, which clears the CDN; photos stay as they are', async () => {
		const h = harness();
		h.file('med_pdf', {
			kind: 'file',
			originalFormat: 'application/pdf',
			derivatives: [],
			originalStorageKey: 'media/med_pdf/original.pdf',
			visibility: 'private',
		});
		await h.service.setFileVisibility('adm_1', 'med_pdf', 'public');
		expect(h.storage.setVisibility).toHaveBeenLastCalledWith('media/med_pdf/original.pdf', 'public');
		expect(h.files.get('med_pdf')?.visibility).toBe('public');
		expect(h.jobs).toEqual([]);
		await h.service.setFileVisibility('adm_1', 'med_pdf', 'private');
		expect(h.jobs).toEqual([{ type: 'purge', urls: ['https://cdn.test/media/med_pdf/original.pdf'] }]);
		h.file('med_photo');
		expect(await refusalCode(h.service.setFileVisibility('adm_1', 'med_photo', 'private'))).toBe(
			'not_a_plain_file',
		);
	});
});

describe('Preview and Download', () => {
	it('hands over the original for five minutes under its own name: shown for Preview, saved for Download', async () => {
		const h = harness();
		h.file('med_pdf', {
			kind: 'file',
			originalFormat: 'application/pdf',
			displayName: 'Size chart.pdf',
			processing: { state: 'ready' },
		});
		const view = await h.service.fileAddress('med_pdf', 'view');
		expect(view.url).toBe('https://spaces.test/media/med_pdf/original.jpg?for=300&as=inline&name=Size chart.pdf');
		const save = await h.service.fileAddress('med_pdf', 'save');
		expect(save.url).toContain('as=attachment');
		// An older photo named without an extension is saved with the stored file's one.
		h.file('med_old', { displayName: '3-bengali-bridal-saree', processing: { state: 'ready' } });
		expect((await h.service.fileAddress('med_old', 'save')).url).toContain('name=3-bengali-bridal-saree.jpg');
	});

	it('break-it: an upload that never finished, or a file deleted for good, has no address', async () => {
		const h = harness();
		h.file('med_half', { processing: { state: 'awaiting_upload' } });
		await expect(h.service.fileAddress('med_half', 'save')).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.service.fileAddress('med_none', 'save')).rejects.toBeInstanceOf(NotFoundException);
		expect(h.storage.createSignedDownloadUrl).not.toHaveBeenCalled();
	});
});

describe('filters on the Media page (A11, A12)', () => {
	const base = { view: 'folder', who: 'mine', sort: 'name', direction: 'asc', page: 1, pageSize: 60 } as const;
	const NOW = new Date('2026-11-15T10:00:00.000Z');

	it('turns each filter into what the store reads, and filters like a search: folder and below, files only', async () => {
		const h = harness();
		h.folders.set('fld_b', {
			id: 'fld_b',
			name: 'Banarasi',
			parentId: null,
			ancestors: [],
			files: 0,
			bytes: 0,
			trashedAt: null,
			trashedFrom: null,
		} as never);
		h.used.set('med_used', ['Product · Red Banarasi']);
		const spy = vi.spyOn(h.browseRepo, 'browse');
		const answer = await h.service.browse(
			'adm_1',
			{
				...base,
				folderId: 'fld_b',
				categories: ['images', 'documents'],
				state: 'processing',
				size: '1to25',
				uploaded: '7d',
				used: 'out',
			},
			NOW,
		);
		expect(spy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				categories: ['images', 'documents'],
				states: ['awaiting_upload', 'queued', 'processing'],
				minBytes: 1024 * 1024,
				maxBytes: 25 * 1024 * 1024,
				createdSince: '2026-11-08T10:00:00.000Z',
				excludeIds: ['med_used'],
				withinFolders: ['fld_b'],
			}),
		);
		expect(answer.folders).toEqual([]);
		await h.service.browse('adm_1', { ...base, size: 'under1', used: 'in' }, NOW);
		expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ maxBytes: 1024 * 1024, ids: ['med_used'] }));
		// Without filters a folder lists its own files and sub-folders, as before.
		await h.service.browse('adm_1', { ...base, folderId: 'fld_b' }, NOW);
		expect(spy.mock.lastCall?.[0]).toMatchObject({ folderId: 'fld_b' });
		expect(spy.mock.lastCall?.[0]).not.toHaveProperty('withinFolders');
	});

	it('keeps Recent to its 30 days unless the upload filter is narrower', async () => {
		const h = harness();
		const spy = vi.spyOn(h.browseRepo, 'browse');
		await h.service.browse('adm_1', { ...base, view: 'recent', uploaded: '90d' }, NOW);
		expect(spy.mock.lastCall?.[0]).toMatchObject({ createdSince: '2026-10-16T10:00:00.000Z' });
		await h.service.browse('adm_1', { ...base, view: 'recent', uploaded: '7d' }, NOW);
		expect(spy.mock.lastCall?.[0]).toMatchObject({ createdSince: '2026-11-08T10:00:00.000Z' });
	});
});
