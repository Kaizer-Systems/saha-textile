import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type AuditLog, MediaAsset, type MediaFolder, type MediaVersion } from '@saha-textile/contracts';
import { type MediaBrowseFilter, SEEDED_MEDIA_PROFILES, mediaCategory } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
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
		seen: [] as MediaBrowseFilter[],
		browse: async (filter: MediaBrowseFilter) => {
			browseRepo.seen.push(filter);
			const items = [...files.values()].filter(
				(asset) =>
					live(asset) &&
					!!asset.trashedAt === filter.trashed &&
					(filter.folderId === undefined || (asset.folderId ?? null) === filter.folderId) &&
					(!filter.withinFolders || filter.withinFolders.includes(asset.folderId ?? '')) &&
					(!filter.ids || filter.ids.includes(asset.id)) &&
					(!filter.excludeIds || !filter.excludeIds.includes(asset.id)) &&
					(!filter.categories ||
						filter.categories.includes(
							mediaCategory(asset.originalFormat, asset.displayName ?? asset.slug),
						)) &&
					(!filter.createdBefore || (asset.createdAt ?? '') < filter.createdBefore) &&
					(!filter.search || (asset.displayName ?? '').toLowerCase().includes(filter.search.toLowerCase())) &&
					(!filter.kinds || filter.kinds.includes(asset.kind)) &&
					(!filter.withVersionOf ||
						!!asset.versions?.some((v) => v.profileKey === filter.withVersionOf && v.state === 'ready')) &&
					(!filter.withoutVersionOf ||
						!asset.versions?.some((v) => v.profileKey === filter.withoutVersionOf && v.state === 'ready')),
			);
			const sorted =
				filter.sort === 'size'
					? [...items].sort((a, b) => b.originalByteSize - a.originalByteSize)
					: filter.sort === 'created'
						? [...items].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
						: items;
			const paged = Number.isInteger(filter.page) && Number.isInteger(filter.pageSize);
			const start = paged ? (filter.page - 1) * filter.pageSize : 0;
			return {
				items: paged ? sorted.slice(start, start + filter.pageSize) : sorted,
				total: items.length,
				page: filter.page,
				pageSize: filter.pageSize,
			};
		},
		sameFileGroups: async () => {
			const groups = new Map<string, string[]>();
			for (const asset of [...files.values()].sort((a, b) =>
				(a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
			)) {
				if (!asset.sha256 || asset.trashedAt || !live(asset)) continue;
				groups.set(asset.sha256, [...(groups.get(asset.sha256) ?? []), asset.id]);
			}
			return [...groups].filter(([, ids]) => ids.length > 1).map(([sha256, ids]) => ({ sha256, ids }));
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
		// Same rules as the Mongo write: new ones still missing, retried ones still failed, or nothing changes.
		addVersions: async (input: { assetId: string; add: MediaVersion[]; retry: MediaVersion[] }) => {
			const asset = files.get(input.assetId);
			if (!asset) return null;
			const have = asset.versions ?? [];
			if (input.add.some((row) => have.some((version) => version.id === row.id))) return null;
			if (input.retry.some((row) => !have.some((version) => version.id === row.id && version.state === 'failed')))
				return null;
			const versions = [
				...have.map((version) => input.retry.find((row) => row.id === version.id) ?? version),
				...input.add,
			];
			files.set(input.assetId, { ...asset, versions });
			return files.get(input.assetId) ?? null;
		},
		removeVersion: async (assetId: string, versionId: string) => {
			const asset = files.get(assetId);
			const version = asset?.versions?.find((row) => row.id === versionId);
			if (!asset || !version || version.state === 'making') return null;
			files.set(assetId, {
				...asset,
				versions: (asset.versions ?? []).filter((row) => row.id !== versionId),
				derivatives: asset.derivatives.filter((row) => row.versionId !== versionId),
			});
			return asset;
		},
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
		startMultipartUpload: vi.fn(async () => ({ uploadId: 'up_1' })),
		createSignedPartUrl: vi.fn(
			async (input: { partNumber: number }) => `https://spaces.test/part/${input.partNumber}`,
		),
		listUploadedParts: vi.fn(async () => [{ partNumber: 1, etag: '"a"', size: 16 }]),
		completeMultipartUpload: vi.fn(async () => undefined),
		abortMultipartUpload: vi.fn(async () => undefined),
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
		list: async (query: { entityType?: string; entityId?: string } = {}) => {
			// One item's trail (A43) filters by its id and type; the page-wide list takes everything.
			const items = query.entityId
				? audit.filter((row) => row.entityId === query.entityId && row.entityType === query.entityType)
				: [...audit];
			return { items, total: items.length, page: 1, pageSize: 50 };
		},
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
		{
			// Hero 16:9 is switched off in this harness.
			findByKey: async (key: string) => {
				const found = SEEDED_MEDIA_PROFILES.find((row) => row.key === key) ?? null;
				return found && key === 'hero_16x9' ? { ...found, enabled: false } : found;
			},
		},
		{ findById: async (id: string) => (id === 'adm_1' ? { displayName: 'Moulik' } : null) } as never,
		undefined,
		LanguageStore.fixed(['en', 'bn']),
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

	it('asks photos for image profiles, keeps other picture types waiting; camera RAW and every other file upload now', async () => {
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
			'photo_type_waits',
		);
		expect(await refusalCode(h.service.presignFile('adm_1', request('look.tif', 'image/tiff')))).toBe(
			'photo_type_waits',
		);
		expect(h.storageCheck.admit).not.toHaveBeenCalled();
		const raw = await h.service.presignFile('adm_1', request('DSC0412.CR3', 'image/x-canon-cr3'));
		expect(h.files.get(raw.assetId)).toMatchObject({ kind: 'file', displayName: 'DSC0412.CR3' });
	});

	it('starts a photo upload with the versions asked for, checked against each profile first (step 2b)', async () => {
		const h = harness();
		const presigned = await h.service.presignFile('adm_1', {
			fileName: 'Red Banarasi.jpg',
			contentType: 'image/jpeg',
			byteSize: 4_000_000,
			folderId: null,
			width: 3000,
			height: 3000,
			versions: [
				{ profileKey: 'product_3x4', fill: 'white' },
				{ profileKey: 'square_1x1', fill: 'as_is' },
			],
		});
		const asset = h.files.get(presigned.assetId);
		expect(asset).toMatchObject({
			kind: 'image',
			purpose: 'product',
			originalStorageKey: `media/${presigned.assetId}/original.jpg`,
			visibility: 'public',
			width: 3000,
			slug: 'red-banarasi',
			displayName: 'Red Banarasi.jpg',
		});
		expect(asset?.versions?.map((row) => [row.id, row.state])).toEqual([
			['product_3x4.white', 'making'],
			['square_1x1.as_is', 'making'],
		]);
		// The original plus an estimate of two versions passes the storage check.
		expect(h.storageCheck.admit).toHaveBeenCalledWith(
			'adm_1',
			6_800_000,
			undefined,
			`res_${presigned.assetId}`,
			expect.any(Date),
		);
		// The original goes up private; the versions made from it are the public pictures.
		expect(presigned.uploadUrl).toContain('original.jpg');

		await h.service.finalizeFile('adm_1', presigned.assetId);
		expect(h.files.get(presigned.assetId)?.processing.state).toBe('queued');
		expect(h.jobs).toContainEqual({ type: 'process', assetId: presigned.assetId });
		expect(h.storageCheck.release).toHaveBeenCalledWith(`res_${presigned.assetId}`);
		expect(h.audit[0]).toMatchObject({ action: 'media.upload' });
		// Finishing twice changes nothing; another admin cannot finish it.
		await h.service.finalizeFile('adm_1', presigned.assetId);
		expect(h.jobs.filter((job) => job.type === 'process')).toHaveLength(1);
	});

	it('a picker lists only photos with a ready version of the profile it needs, with their chips, and counts the rest (R4-2, D15, D16)', async () => {
		const h = harness();
		const version = (id: string, state = 'ready') => {
			const [profileKey = '', fill = 'as_is'] = id.split('.');
			return { id, profileKey, profileVersion: 1, fill, state, createdAt: '2026-11-16T00:00:00.000Z' };
		};
		h.file('med_fits', {
			versions: [version('product_3x4.white'), version('product_3x4.blur'), version('hero_21x9.crop')],
			text: { alt: { en: 'Red Banarasi silk saree, front', bn: ' ' }, title: {}, caption: {} },
		});
		h.file('med_other', { versions: [version('hero_21x9.crop')] });
		h.file('med_making', { versions: [version('product_3x4.white', 'making')] });
		h.file('med_pdf', { kind: 'file', originalFormat: 'application/pdf', displayName: 'catalogue.pdf' });
		const picker = await h.service.browse('adm_1', {
			view: 'folder',
			accept: 'image',
			profile: 'product_3x4',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
			who: 'mine',
		} as never);
		expect(picker.files.map((row) => row.id)).toEqual(['med_fits']);
		expect(picker.files[0]?.fitting).toEqual([
			{ versionId: 'product_3x4.white', fill: 'white' },
			{ versionId: 'product_3x4.blur', fill: 'blur' },
		]);
		expect(picker.hidden).toEqual({ noVersion: 2, notImage: 1 });
		// D14: the shop's languages without default alt text are named (a blank one counts as missing).
		expect(picker.files[0]?.altMissing).toEqual(['bn']);
		// The switch shows the photos without it too; their chips are empty, so they can't be chosen yet.
		const all = await h.service.browse('adm_1', {
			view: 'folder',
			accept: 'image',
			profile: 'product_3x4',
			showWithout: true,
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
			who: 'mine',
		} as never);
		expect(all.files.map((row) => [row.id, row.fitting?.length]).sort()).toEqual([
			['med_fits', 2],
			['med_making', 0],
			['med_other', 0],
		]);
		expect(all.hidden).toEqual({ noVersion: 0, notImage: 1 });
		// The Media page itself is unchanged: everything, no chips, nothing hidden.
		const page = await h.service.browse('adm_1', {
			view: 'folder',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
			who: 'mine',
		} as never);
		expect(page.files).toHaveLength(4);
		expect(page.hidden).toBeUndefined();
		expect(page.files[0]?.fitting).toBeUndefined();
	});

	it('refuses a photo version its profile does not allow, before anything is stored', async () => {
		const h = harness();
		const photo = (versions: { profileKey: string; fill: string }[], extra: Record<string, unknown> = {}) =>
			refusalCode(
				h.service.presignFile('adm_1', {
					fileName: 'a.jpg',
					contentType: 'image/jpeg',
					byteSize: 1000,
					folderId: null,
					width: 3000,
					height: 4000,
					versions: versions as never,
					...extra,
				}),
			);
		expect(await photo([{ profileKey: 'product_3x4', fill: 'white' }])).toBe('fill_not_offered');
		expect(await photo([{ profileKey: 'nope_1x1', fill: 'as_is' }])).toBe('profile_unknown');
		expect(await photo([{ profileKey: 'hero_16x9', fill: 'crop' }])).toBe('profile_off');
		expect(await photo([{ profileKey: 'link_preview', fill: 'blur' }])).toBe('profile_not_chosen');
		expect(await photo([{ profileKey: 'product_3x4', fill: 'as_is' }], { width: 900, height: 1200 })).toBe(
			'below_minimum',
		);
		expect(await photo([{ profileKey: 'product_3x4', fill: 'as_is' }], { width: 8200, height: 10933 })).toBe(
			'too_many_pixels',
		);
		expect(
			await photo([
				{ profileKey: 'product_3x4', fill: 'as_is' },
				{ profileKey: 'product_3x4', fill: 'as_is' },
			]),
		).toBe('version_twice');
		expect(await photo([{ profileKey: 'product_3x4', fill: 'as_is' }], { width: undefined })).toBe(
			'photo_needs_profiles',
		);
		expect(h.storageCheck.admit).not.toHaveBeenCalled();
		expect(h.files.size).toBe(0);
	});

	it('lets a photo below a profile’s warning size through, with a note', async () => {
		const h = harness();
		const presigned = await h.service.presignFile('adm_1', {
			fileName: 'hero.jpg',
			contentType: 'image/jpeg',
			byteSize: 1000,
			folderId: null,
			width: 2100,
			height: 900,
			versions: [{ profileKey: 'hero_21x9', fill: 'as_is' }],
		});
		expect(h.files.get(presigned.assetId)).toMatchObject({
			purpose: 'banner',
			warnings: ['below_recommended_size'],
		});
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

	it('send a big file in parts that resume: only one’s own unfinished upload, finished by joining the parts (S11)', async () => {
		const h = harness();
		const big = await h.service.presignFile('adm_1', {
			fileName: 'shoot.mp4',
			contentType: 'video/mp4',
			byteSize: 200 * 1024 * 1024,
			folderId: null,
		});
		await expect(h.service.startMultipart('adm_2', big.assetId)).rejects.toBeInstanceOf(NotFoundException);
		expect(await h.service.startMultipart('adm_1', big.assetId)).toEqual({
			uploadId: 'up_1',
			partBytes: 16 * 1024 * 1024,
		});
		expect(await h.service.partUrls('adm_1', big.assetId, { uploadId: 'up_1', partNumbers: [1, 2] })).toEqual({
			urls: [
				{ partNumber: 1, url: 'https://spaces.test/part/1' },
				{ partNumber: 2, url: 'https://spaces.test/part/2' },
			],
		});
		expect(await h.service.uploadedParts('adm_1', big.assetId, 'up_1')).toEqual({
			parts: [{ partNumber: 1, size: 16 }],
		});
		await h.service.finalizeFile('adm_1', big.assetId, new Date(), 'up_1');
		expect(h.storage.completeMultipartUpload).toHaveBeenCalledWith({
			key: `media/${big.assetId}/original.mp4`,
			uploadId: 'up_1',
		});
		expect(h.files.get(big.assetId)?.processing.state).toBe('ready');
		// Finished: nothing more can be sent for it.
		await expect(
			h.service.partUrls('adm_1', big.assetId, { uploadId: 'up_1', partNumbers: [3] }),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('cancelling a big upload drops its stored parts too', async () => {
		const h = harness();
		const big = await h.service.presignFile('adm_1', {
			fileName: 'shoot.mp4',
			contentType: 'video/mp4',
			byteSize: 200 * 1024 * 1024,
			folderId: null,
		});
		await h.service.cancelUpload('adm_1', big.assetId, 'up_1');
		expect(h.storage.abortMultipartUpload).toHaveBeenCalledWith({
			key: `media/${big.assetId}/original.mp4`,
			uploadId: 'up_1',
		});
		expect(h.files.has(big.assetId)).toBe(false);
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

describe('details and Activity (A31, A32, A43, step 2e)', () => {
	it('shows a photo’s facts, folder, uploader, versions with their files, and per-photo pictures', async () => {
		const h = harness();
		const folder = await h.service.createFolder('adm_1', { name: 'Banarasi', parentId: null });
		const file = (role: string, width: number, versionId: string | null) => ({
			role,
			storageKey: `media/med_v/${role}-${width}.webp`,
			width,
			height: width,
			byteSize: width,
			format: 'image/webp',
			roleVersion: 1,
			versionId,
		});
		h.file('med_v', {
			folderId: folder.id,
			width: 3000,
			height: 4000,
			uploadedBy: { type: 'admin', id: 'adm_1' },
			createdAt: '2026-11-16T00:00:00.000Z',
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
			derivatives: [
				file('card', 400, 'product_3x4.as_is'),
				file('card', 200, 'product_3x4.as_is'),
				file('share', 1200, null),
			],
		});
		const details = await h.service.details('med_v');
		expect(details).toMatchObject({
			name: 'med_v.jpg',
			folderPath: ['Banarasi'],
			uploadedBy: 'Moulik',
			width: 3000,
		});
		expect(details.versions[0]).toMatchObject({
			id: 'product_3x4.as_is',
			bytes: 600,
			state: 'ready',
			error: null,
			shown: true,
		});
		expect(details.versions[0]?.families[0]?.files.map((row) => row.width)).toEqual([200, 400]);
		expect(details.perPhoto.map((family) => family.role)).toEqual(['share']);
		// A42: the photo's own text, per language (the unused title is not sent).
		expect(details.text).toEqual({ alt: {}, caption: {} });
		await expect(h.service.details('nope')).rejects.toThrow('File not found');
	});

	it('lists one item’s own trail, the Media page’s and the pipeline’s entries together, newest first', async () => {
		const h = harness();
		h.file('med_a');
		const entry = (id: string, entityType: string, entityId: string, createdAt: string) =>
			({ id, entityType, entityId, createdAt, action: 'x', actorUserId: 'adm_1' }) as never;
		h.audit.push(
			entry('a1', 'media', 'med_a', '2026-11-16T10:00:00.000Z'),
			entry('a2', 'mediaAsset', 'med_a', '2026-11-16T11:00:00.000Z'),
			entry('a3', 'media', 'med_b', '2026-11-16T12:00:00.000Z'),
		);
		const trail = await h.service.activity(1, 50, 'med_a');
		expect(trail.items.map((row) => row.id)).toEqual(['a2', 'a1']);
		expect((await h.service.activity(1, 50)).items.length).toBeGreaterThanOrEqual(3);
	});
});

describe('Reprocess: adding and removing versions (C01, C07, A31, step 3a)', () => {
	const ready = (id: string): MediaVersion => {
		const [profileKey = '', fill = 'as_is'] = id.split('.');
		return {
			id,
			profileKey,
			profileVersion: 1,
			fill: fill as MediaVersion['fill'],
			state: 'ready',
			error: null,
			createdAt: '2026-11-16T00:00:00.000Z',
		};
	};
	const derivative = (role: string, width: number, versionId: string) => ({
		role,
		storageKey: `media/med_w/${versionId}/${role}-${width}.webp`,
		width,
		height: width,
		byteSize: 10,
		format: 'image/webp' as const,
		roleVersion: 1,
		versionId,
	});
	/** A 2:1 photo (4800 × 2400) with one version, as in the brief's banarasi-weave-closeup. */
	const weave = (h: ReturnType<typeof harness>, versions: MediaVersion[] = [ready('blog_cover_2x1.as_is')]) =>
		h.file('med_w', {
			width: 4800,
			height: 2400,
			originalByteSize: 1_000_000,
			versions,
			derivatives: [derivative('blog', 480, 'blog_cover_2x1.as_is')],
			processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-16T00:00:00.000Z' },
		});

	it('adds new versions as making, queues the worker, checks storage and records it', async () => {
		const h = harness();
		weave(h);
		const result = await h.service.addVersions('adm_1', {
			fileIds: ['med_w'],
			versions: [
				{ profileKey: 'product_3x4', fill: 'crop' },
				{ profileKey: 'hero_21x9', fill: 'blur' },
			],
			many: false,
		});
		expect(result).toEqual({ photos: 1, added: 2, skipped: [] });
		const versions = h.files.get('med_w')?.versions ?? [];
		expect(versions.map((row) => `${row.id}:${row.state}`)).toEqual([
			'blog_cover_2x1.as_is:ready',
			'product_3x4.crop:making',
			'hero_21x9.blur:making',
		]);
		expect(h.jobs).toContainEqual({ type: 'reprocess', assetId: 'med_w', reason: 'versions' });
		// Two versions at 35% of the original each (R4-7).
		expect(h.storageCheck.admit).toHaveBeenCalledWith(
			'adm_1',
			700_000,
			undefined,
			expect.any(String),
			expect.any(Date),
		);
		expect(h.audit[0]).toMatchObject({ action: 'media.versions.add', entityId: 'med_w' });
		// The row says versions are being made (C03).
		const rows = await h.service.browse('adm_1', { view: 'folder' } as never);
		expect(rows.files.find((row) => row.id === 'med_w')?.versionsMaking).toBe(2);
	});

	it('never makes a version twice; a failed one is made again; a refused one is named', async () => {
		const h = harness();
		weave(h, [ready('blog_cover_2x1.as_is'), { ...ready('product_3x4.white'), state: 'failed', error: 'x' }]);
		const result = await h.service.addVersions('adm_1', {
			fileIds: ['med_w'],
			versions: [
				{ profileKey: 'blog_cover_2x1', fill: 'as_is' },
				{ profileKey: 'product_3x4', fill: 'white' },
				{ profileKey: 'product_3x4', fill: 'as_is' },
			],
			many: false,
		});
		expect(result.added).toBe(1);
		expect(result.skipped).toEqual([
			{ fileId: 'med_w', versionId: 'blog_cover_2x1.as_is', reason: 'already_made' },
			{ fileId: 'med_w', versionId: 'product_3x4.as_is', reason: 'fill_not_offered' },
		]);
		expect(h.files.get('med_w')?.versions?.find((row) => row.id === 'product_3x4.white')?.state).toBe('making');
		// A switched-off profile is refused, nothing queued.
		const off = await h.service.addVersions('adm_1', {
			fileIds: ['med_w'],
			versions: [{ profileKey: 'hero_16x9', fill: 'crop' }],
			many: false,
		});
		expect(off).toEqual({
			photos: 0,
			added: 0,
			skipped: [{ fileId: 'med_w', versionId: 'hero_16x9.crop', reason: 'profile_off' }],
		});
	});

	it('many photos: a fill becomes “As is” where the photo already fits; files and missing photos are listed', async () => {
		const h = harness();
		weave(h);
		h.file('med_wide', { width: 2100, height: 900, versions: [ready('hero_21x9.as_is')] });
		h.file('med_pdf', { kind: 'file', originalFormat: 'application/pdf', displayName: 'a.pdf' });
		const result = await h.service.addVersions('adm_1', {
			fileIds: ['med_w', 'med_wide', 'med_pdf', 'med_gone'],
			versions: [{ profileKey: 'hero_21x9', fill: 'crop' }],
			many: true,
		});
		expect(result.photos).toBe(1);
		expect(result.skipped).toEqual([
			{ fileId: 'med_wide', versionId: 'hero_21x9.as_is', reason: 'already_made' },
			{ fileId: 'med_pdf', versionId: 'hero_21x9.crop', reason: 'not_a_photo' },
		]);
		expect(await h.service.versionsStatus(['med_w', 'med_wide'])).toEqual({ photos: 2, making: 1, failed: 0 });
	});

	it('while a photo is being replaced, its versions wait (step 3b)', async () => {
		const h = harness();
		weave(h);
		const asset = h.files.get('med_w') as MediaAsset;
		const replacing = {
			key: 'media/med_w/original-1.png',
			contentType: 'image/png',
			byteSize: 1,
			width: 4800,
			height: 2400,
			sha256: null,
			phase: 'making' as const,
			reason: 'replace' as const,
			made: 0,
			total: 0,
			error: null,
			startedAt: '2026-11-16T00:00:00.000Z',
			by: 'adm_1',
		};
		h.files.set('med_w', { ...asset, replacing });
		const ask = { profileKey: 'hero_21x9', fill: 'crop' as const };
		expect(
			await refusalCode(h.service.addVersions('adm_1', { fileIds: ['med_w'], versions: [ask], many: false })),
		).toBe('replacing');
		const many = await h.service.addVersions('adm_1', { fileIds: ['med_w'], versions: [ask], many: true });
		expect(many).toEqual({
			photos: 0,
			added: 0,
			skipped: [{ fileId: 'med_w', versionId: '', reason: 'replacing' }],
		});
		const rows = await h.service.browse('adm_1', { view: 'folder' } as never);
		expect(rows.files.find((row) => row.id === 'med_w')?.replacing).toBe('making');
	});

	it('refuses a file that is not a photo, and a missing one, when asked for one photo', async () => {
		const h = harness();
		h.file('med_pdf', { kind: 'file', originalFormat: 'application/pdf', displayName: 'a.pdf' });
		expect(
			await refusalCode(
				h.service.addVersions('adm_1', {
					fileIds: ['med_pdf'],
					versions: [{ profileKey: 'product_3x4', fill: 'white' }],
					many: false,
				}),
			),
		).toBe('not_a_photo');
		await expect(
			h.service.addVersions('adm_1', {
				fileIds: ['med_none'],
				versions: [{ profileKey: 'product_3x4', fill: 'white' }],
				many: false,
			}),
		).rejects.toThrow();
	});

	it('removes a version the website does not show, with its files; keeps the shown one, the last one and one being made', async () => {
		const h = harness();
		weave(h, [
			ready('blog_cover_2x1.as_is'),
			ready('product_3x4.white'),
			ready('product_3x4.blur'),
			{ ...ready('product_3x4.crop'), state: 'making' },
			ready('hero_21x9.crop'),
		]);
		const asset = h.files.get('med_w') as MediaAsset;
		h.files.set('med_w', {
			...asset,
			derivatives: [
				...asset.derivatives,
				derivative('card', 200, 'product_3x4.white'),
				derivative('card', 200, 'product_3x4.blur'),
				derivative('card', 400, 'product_3x4.blur'),
				derivative('banner', 480, 'hero_21x9.crop'),
			],
		});
		h.used.set('med_w', ['blog · How to spot a real Banarasi']);
		// Shown on the website (the first ready version with its role) while the photo is used somewhere. Until pages
		// store their version (step 4), a version that is a role's only source counts as shown.
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'blog_cover_2x1.as_is'))).toBe(
			'version_in_use',
		);
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'product_3x4.white'))).toBe(
			'version_in_use',
		);
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'hero_21x9.crop'))).toBe('version_in_use');
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'product_3x4.crop'))).toBe('version_making');
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'square_1x1.white'))).toBe(
			'version_unknown',
		);
		await h.service.removeVersion('adm_1', 'med_w', 'product_3x4.blur');
		expect(h.files.get('med_w')?.versions?.map((row) => row.id)).toEqual([
			'blog_cover_2x1.as_is',
			'product_3x4.white',
			'product_3x4.crop',
			'hero_21x9.crop',
		]);
		expect(h.deletedKeys).toEqual([
			'media/med_w/product_3x4.blur/card-200.webp',
			'media/med_w/product_3x4.blur/card-400.webp',
		]);
		expect(h.audit[0]).toMatchObject({ action: 'media.versions.remove', entityId: 'med_w' });
		// Not used anywhere: any version but the last may go.
		h.used.delete('med_w');
		await h.service.removeVersion('adm_1', 'med_w', 'hero_21x9.crop');
		// The last version stays.
		h.file('med_one', { width: 3000, height: 4000, versions: [ready('product_3x4.as_is')] });
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_one', 'product_3x4.as_is'))).toBe(
			'last_version',
		);
	});
});

describe('Media search (media step 4e)', () => {
	it('searches the alt text and caption in every added language, and the folders a word names', async () => {
		const h = harness();
		const photos = await h.service.createFolder('adm_1', { name: 'Product photos', parentId: null });
		const banarasi = await h.service.createFolder('adm_1', { name: 'Banarasi', parentId: photos.id });
		await h.service.browse('adm_1', {
			view: 'folder',
			search: 'banarasi front',
			who: 'mine',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		} as never);
		const filter = h.browseRepo.seen.at(-1);
		expect(filter?.searchLocales).toEqual(['en', 'bn']);
		expect(filter?.searchFolders).toEqual({ banarasi: [banarasi.id], front: [] });
		// No words, nothing extra.
		await h.service.browse('adm_1', {
			view: 'folder',
			who: 'mine',
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 60,
		} as never);
		expect(h.browseRepo.seen.at(-1)?.searchFolders).toBeUndefined();
	});
});

describe('Clean up lists (A44, media step 5)', () => {
	it('offers files not used for 90 days, the largest, and later copies of the same file; never used ones or backups', async () => {
		const h = harness();
		const now = new Date('2026-11-16T00:00:00.000Z');
		const old = '2026-07-01T00:00:00.000Z';
		const recent = '2026-11-10T00:00:00.000Z';
		h.file('med_old', { createdAt: old, originalByteSize: 500, sha256: 'a'.repeat(64) });
		h.file('med_copy', { createdAt: recent, originalByteSize: 500, sha256: 'a'.repeat(64) });
		h.file('med_used', { createdAt: old, originalByteSize: 9000 });
		h.file('med_big', { createdAt: recent, originalByteSize: 7000 });
		h.file('med_backup', {
			createdAt: old,
			originalByteSize: 99_000,
			kind: 'file',
			originalFormat: 'application/gzip',
			displayName: 'nightly-backup.archive.gz',
		});
		h.used.set('med_used', ['product gallery · Red Banarasi Silk']);
		const list = (name: 'unused' | 'largest' | 'duplicates') =>
			h.service.cleanUp('adm_1', { list: name, page: 1 }, now);

		const unused = await list('unused');
		expect(unused.rows.map((row) => row.file.id)).not.toContain('med_used');
		expect(unused.rows.map((row) => row.file.id)).toContain('med_old');
		expect(unused.rows.map((row) => row.file.id)).not.toContain('med_copy');
		expect(unused.rows.find((row) => row.file.id === 'med_old')?.uploadedAt).toBe(old);

		const largest = await list('largest');
		expect(largest.rows[0]?.file.id).toBe('med_big');
		expect(largest.rows.map((row) => row.file.id)).not.toContain('med_used');

		const twice = await list('duplicates');
		expect(twice.rows.map((row) => row.file.id)).toEqual(['med_copy']);
		expect(twice.rows[0]?.sameAs).toMatchObject({ id: 'med_old' });
		expect(twice.counts.duplicates).toBe(1);
	});
});
