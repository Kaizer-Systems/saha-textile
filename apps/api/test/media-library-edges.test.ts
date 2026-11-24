import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type AuditLog, MediaAsset, type MediaFolder, type MediaVersion } from '@saha-textile/contracts';
import { type MediaBrowseFilter, SEEDED_MEDIA_PROFILES, mediaCategory } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { MediaLibraryService } from '../src/media/media-library.service';

/** The Media page's in-memory stores, as media-library.test.ts builds them, with the stores handed back. */
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
		// Settings › Languages' Photos to-do: these two photos the website shows lack বাংলা alt text.
		{
			missingIds: async (area: string, code: string) =>
				area === 'photos' && code === 'bn' ? ['med_used', 'med_other'] : [],
		} as never,
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
		assetRepo,
		folderRepo,
	};
}

type Harness = ReturnType<typeof harness>;

const refusalCode = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BadRequestException);
		return ((error as BadRequestException).getResponse() as { issues?: { code: string }[] }).issues?.[0]?.code;
	}
	throw new Error('expected a refusal');
};

const TRASHED = '2026-11-20T00:00:00.000Z';
const NOW = new Date('2026-11-24T10:00:00.000Z');
const base = { view: 'folder', who: 'mine', sort: 'name', direction: 'asc', page: 1, pageSize: 60 } as const;

const folder = (h: Harness, id: string, over: Partial<MediaFolder> = {}): MediaFolder => {
	const row = {
		id,
		name: id,
		parentId: null,
		ancestors: [],
		files: 0,
		bytes: 0,
		trashedAt: null,
		trashedFrom: null,
		...over,
	} as MediaFolder;
	h.folders.set(id, row);
	return row;
};
/** Takes away one of the service's optional stores, as a deployment without it runs. */
const without = (h: Harness, field: 'languages' | 'coverage') =>
	Object.defineProperty(h.service, field, { value: undefined });

const ready = (id: string, state: MediaVersion['state'] = 'ready'): MediaVersion => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return {
		id,
		profileKey,
		profileVersion: 1,
		fill: fill as MediaVersion['fill'],
		state,
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
const weave = (h: Harness, versions: MediaVersion[] = [ready('blog_cover_2x1.as_is')]) =>
	h.file('med_w', {
		width: 4800,
		height: 2400,
		originalByteSize: 1_000_000,
		versions,
		derivatives: [derivative('blog', 480, 'blog_cover_2x1.as_is')],
		processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-16T00:00:00.000Z' },
	});

describe('reading the Media page: the remaining cases', () => {
	it('lists the folder tree with each folder’s counts, leaving Trash out', async () => {
		const h = harness();
		folder(h, 'fld_a', { name: 'Photos', files: 2, bytes: 200 });
		folder(h, 'fld_t', { trashedAt: TRASHED });
		expect(await h.service.tree()).toEqual({
			folders: [{ id: 'fld_a', parentId: null, name: 'Photos', files: 2, bytes: 200 }],
		});
	});

	it('shows folders in Trash with their days left and where they came from', async () => {
		const h = harness();
		folder(h, 'fld_home', { name: 'Home' });
		folder(h, 'fld_old', {
			name: 'Old',
			parentId: 'fld_home',
			ancestors: ['fld_home'],
			trashedAt: TRASHED,
			trashedFrom: 'fld_home',
		});
		const view = await h.service.browse('adm_1', { ...base, view: 'trash' }, NOW);
		expect(view.folders).toEqual([
			expect.objectContaining({ id: 'fld_old', location: 'Home', daysLeft: expect.any(Number) }),
		]);
	});

	it('narrows favourites by a filter, keeping only the starred files that match', async () => {
		const h = harness();
		h.file('med_a');
		h.file('med_b');
		h.used.set('med_a', ['Home']);
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_a', starred: true });
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_b', starred: true });
		const view = await h.service.browse('adm_1', { ...base, view: 'favourites', used: 'in' });
		expect(view.files.map((row) => row.id)).toEqual(['med_a']);
	});

	it('names places whose folders are gone from the list as far as it can, in rows and the breadcrumb', async () => {
		const h = harness();
		folder(h, 'fld_top', { name: 'Top', trashedAt: TRASHED });
		folder(h, 'fld_mid', { name: 'Mid', parentId: 'fld_top', ancestors: ['fld_top'] });
		folder(h, 'fld_deep', { name: 'Deep', parentId: 'fld_mid', ancestors: ['fld_gone', 'fld_mid'] });
		h.file('med_in_mid', { folderId: 'fld_mid' });
		h.file('med_in_top', { folderId: 'fld_top' });
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_in_mid', starred: true });
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_in_top', starred: true });
		const starred = await h.service.browse('adm_1', { ...base, view: 'favourites' });
		expect(starred.files.map((row) => [row.id, row.location])).toEqual([
			['med_in_mid', 'Mid'],
			['med_in_top', ''],
		]);
		const deep = await h.service.browse('adm_1', { ...base, folderId: 'fld_deep' });
		expect(deep.breadcrumb).toEqual([
			{ id: 'fld_gone', name: '' },
			{ id: 'fld_mid', name: 'Mid' },
			{ id: 'fld_deep', name: 'Deep' },
		]);
	});

	it('turns the remaining filters into what the store reads', async () => {
		const h = harness();
		await h.service.browse('adm_1', { ...base, state: 'processing' }, NOW);
		expect(h.browseRepo.seen).toContainEqual(
			expect.objectContaining({ states: ['awaiting_upload', 'queued', 'processing'] }),
		);
		await h.service.browse('adm_1', { ...base, state: 'ready', size: 'over25' }, NOW);
		expect(h.browseRepo.seen).toContainEqual(
			expect.objectContaining({ states: ['ready'], minBytes: 25 * 1024 * 1024 }),
		);
		without(h, 'coverage');
		h.browseRepo.seen.length = 0;
		await h.service.browse('adm_1', { ...base, missing: 'bn' }, NOW);
		expect(h.browseRepo.seen).toContainEqual(expect.objectContaining({ ids: [] }));
	});

	it('searches English and Bengali when no languages are set, and names no missing alt text', async () => {
		const h = harness();
		without(h, 'languages');
		h.file('med_red', { displayName: 'red.jpg', createdAt: '2026-11-20T00:00:00.000Z' });
		await h.service.browse('adm_1', { ...base, view: 'trash', search: 'red' }, NOW);
		expect(h.browseRepo.seen).toContainEqual(expect.objectContaining({ searchLocales: ['en', 'bn'] }));
		const recent = await h.service.browse('adm_1', { ...base, view: 'recent' }, NOW);
		expect(recent.files[0]).not.toHaveProperty('altMissing');
	});

	it('shows a picker no fitting versions for a photo that has none', async () => {
		const h = harness();
		h.file('med_plain', { createdAt: '2026-11-20T00:00:00.000Z' });
		const picker = await h.service.browse(
			'adm_1',
			{ ...base, view: 'recent', profile: 'square_1x1', showWithout: true },
			NOW,
		);
		expect(picker.files.find((row) => row.id === 'med_plain')?.fitting).toEqual([]);
	});
});

describe('folders and moves: the remaining cases', () => {
	it('refuses a new folder inside one in Trash', async () => {
		const h = harness();
		folder(h, 'fld_t', { trashedAt: TRASHED });
		expect(await refusalCode(h.service.createFolder('adm_1', { name: 'New', parentId: 'fld_t' }))).toBe(
			'target_in_trash',
		);
	});

	it('moves folders into another folder and back to My files, skipping one already there; both undo', async () => {
		const h = harness();
		folder(h, 'fld_a');
		folder(h, 'fld_b');
		folder(h, 'fld_c', { parentId: 'fld_b', ancestors: ['fld_b'] });
		const into = await h.service.move('adm_1', { fileIds: [], folderIds: ['fld_a', 'fld_c'], toFolderId: 'fld_b' });
		expect(into.done).toBe(1);
		expect(h.folders.get('fld_a')).toMatchObject({ parentId: 'fld_b', ancestors: ['fld_b'] });
		const out = await h.service.move('adm_1', { fileIds: [], folderIds: ['fld_a'], toFolderId: null });
		expect(h.folders.get('fld_a')).toMatchObject({ parentId: null, ancestors: [] });
		await h.service.undo('adm_1', out.undoId as string);
		expect(h.folders.get('fld_a')).toMatchObject({ parentId: 'fld_b', ancestors: ['fld_b'] });
		await h.service.undo('adm_1', into.undoId as string);
		expect(h.folders.get('fld_a')).toMatchObject({ parentId: null, ancestors: [] });
	});

	it('moves a file to My files under its own free name, and records nothing when nothing moves', async () => {
		const h = harness();
		folder(h, 'fld_b');
		h.file('med_x', { folderId: 'fld_b', displayName: 'x.jpg' });
		h.file('med_root', { displayName: 'root.jpg' });
		const moved = await h.service.move('adm_1', {
			fileIds: ['med_x', 'med_root'],
			folderIds: [],
			toFolderId: null,
		});
		expect(moved.done).toBe(1);
		expect(h.files.get('med_x')).toMatchObject({ folderId: null, displayName: 'x.jpg' });
		expect(await h.service.move('adm_1', { fileIds: ['med_root'], folderIds: [], toFolderId: null })).toEqual({
			done: 0,
			inUse: [],
			undoId: null,
		});
	});

	it('refuses moving files into a folder in Trash', async () => {
		const h = harness();
		folder(h, 'fld_t', { trashedAt: TRASHED });
		h.file('med_root');
		expect(
			await refusalCode(h.service.move('adm_1', { fileIds: ['med_root'], folderIds: [], toFolderId: 'fld_t' })),
		).toBe('target_in_trash');
	});

	it('undoes a folder rename', async () => {
		const h = harness();
		folder(h, 'fld_a', { name: 'Old' });
		const renamed = await h.service.renameFolder('adm_1', 'fld_a', 'New');
		expect(h.folders.get('fld_a')?.name).toBe('New');
		await h.service.undo('adm_1', renamed.undoId as string);
		expect(h.folders.get('fld_a')?.name).toBe('Old');
	});

	it('undoes older entries that recorded nothing, and refuses an entry that is not a move, rename or Trash', async () => {
		const h = harness();
		const entry = (id: string, action: string) =>
			h.audit.unshift({
				id,
				actorUserId: 'adm_1',
				action,
				entityType: 'media',
				entityId: null,
				createdAt: TRASHED,
			} as never);
		entry('aud_move', 'media.move');
		entry('aud_rename', 'media.rename');
		entry('aud_trash', 'media.trash');
		entry('aud_made', 'media.folder.create');
		for (const id of ['aud_move', 'aud_rename', 'aud_trash']) {
			expect((await h.service.undo('adm_1', id)).done).toBe(1);
		}
		expect(await refusalCode(h.service.undo('adm_1', 'aud_made'))).toBe('nothing_to_undo');
	});
});

describe('restore: the remaining cases', () => {
	it('brings a folder from nowhere back to My files, and leaves one that is not in Trash', async () => {
		const h = harness();
		folder(h, 'fld_a', { trashedAt: TRASHED });
		folder(h, 'fld_live');
		const result = await h.service.restore('adm_1', {
			fileIds: [],
			folderIds: ['fld_a', 'fld_live'],
			whenFolderGone: 'my_files',
		});
		expect(result.done).toBe(1);
		expect(h.folders.get('fld_a')).toMatchObject({ trashedAt: null, parentId: null });
	});

	it('puts a folder back in the folder it was trashed from when that differs from its parent now', async () => {
		const h = harness();
		folder(h, 'fld_p', { name: 'Photos' });
		folder(h, 'fld_c', {
			parentId: 'fld_other',
			ancestors: ['fld_other'],
			trashedAt: TRASHED,
			trashedFrom: 'fld_p',
		});
		await h.service.restore('adm_1', { fileIds: [], folderIds: ['fld_c'], whenFolderGone: 'my_files' });
		expect(h.folders.get('fld_c')).toMatchObject({ trashedAt: null, parentId: 'fld_p', ancestors: ['fld_p'] });
	});

	it('brings back the parent folder too, or puts the folder in My files', async () => {
		const both = harness();
		folder(both, 'fld_p', { trashedAt: TRASHED });
		folder(both, 'fld_c', { parentId: 'fld_p', ancestors: ['fld_p'], trashedAt: TRASHED, trashedFrom: 'fld_p' });
		await both.service.restore('adm_1', { fileIds: [], folderIds: ['fld_c'], whenFolderGone: 'restore_folder' });
		expect(both.folders.get('fld_p')?.trashedAt).toBeNull();
		expect(both.folders.get('fld_c')).toMatchObject({ trashedAt: null, parentId: 'fld_p' });

		const alone = harness();
		folder(alone, 'fld_p', { trashedAt: TRASHED });
		folder(alone, 'fld_c', { parentId: 'fld_p', ancestors: ['fld_p'], trashedAt: TRASHED, trashedFrom: 'fld_p' });
		await alone.service.restore('adm_1', { fileIds: [], folderIds: ['fld_c'], whenFolderGone: 'my_files' });
		expect(alone.folders.get('fld_p')?.trashedAt).toBe(TRASHED);
		expect(alone.folders.get('fld_c')).toMatchObject({ trashedAt: null, parentId: null, ancestors: [] });
	});

	it('restores a file with no record of where it came from to My files', async () => {
		const h = harness();
		h.file('med_t', { folderId: 'fld_x', trashedAt: TRASHED });
		await h.service.restore('adm_1', { fileIds: ['med_t'], folderIds: [], whenFolderGone: 'my_files' });
		expect(h.files.get('med_t')).toMatchObject({ folderId: null, trashedAt: null });
	});
});

describe('uploads: the remaining cases', () => {
	const photo = (folderId: string | null) => ({
		fileName: 'red.jpg',
		contentType: 'image/jpeg',
		byteSize: 4_000_000,
		folderId,
		width: 3000,
		height: 3000,
		versions: [{ profileKey: 'square_1x1', fill: 'as_is' as const }],
	});

	it('hands back an upload address with no headers when the storage gives none', async () => {
		const h = harness();
		Object.assign(h.storage, {
			createSignedUploadUrl: async ({ key }: { key: string }) => ({ url: `https://spaces.test/${key}` }),
		});
		folder(h, 'fld_live');
		const plain = await h.service.presignFile('adm_1', {
			fileName: 'brief.pdf',
			contentType: 'application/pdf',
			byteSize: 10,
			folderId: null,
		});
		expect(plain.headers).toEqual({});
		const picture = await h.service.presignFile('adm_1', photo('fld_live'));
		expect(picture.headers).toEqual({});
		expect(h.files.get(picture.assetId)?.folderId).toBe('fld_live');
	});

	it('refuses a photo for a folder in Trash', async () => {
		const h = harness();
		folder(h, 'fld_t', { trashedAt: TRASHED });
		expect(await refusalCode(h.service.presignFile('adm_1', photo('fld_t')))).toBe('target_in_trash');
	});

	it('drops an upload even when its stored parts cannot be dropped', async () => {
		const h = harness();
		const big = await h.service.presignFile('adm_1', {
			fileName: 'shoot.mp4',
			contentType: 'video/mp4',
			byteSize: 10,
			folderId: null,
		});
		h.storage.abortMultipartUpload.mockRejectedValueOnce(new Error('already gone'));
		await h.service.cancelUpload('adm_1', big.assetId, 'up_1');
		expect(h.storage.delete).toHaveBeenCalledWith(`media/${big.assetId}/original.mp4`);
		expect(h.files.has(big.assetId)).toBe(false);
	});

	it('finishes only plain files and photos with versions, each only for the admin who started it', async () => {
		const h = harness();
		h.file('med_vid', {
			kind: 'video',
			originalFormat: 'video/mp4',
			processing: { state: 'awaiting_upload' },
			uploadedBy: { type: 'admin', id: 'adm_1' },
		});
		expect(await refusalCode(h.service.finalizeFile('adm_1', 'med_vid'))).toBe('not_a_plain_file');
		h.file('med_bare');
		expect(await refusalCode(h.service.finalizeFile('adm_1', 'med_bare'))).toBe('not_a_plain_file');
		const pdf = await h.service.presignFile('adm_1', {
			fileName: 'big.pdf',
			contentType: 'application/pdf',
			byteSize: 10,
			folderId: null,
		});
		await expect(h.service.finalizeFile('adm_2', pdf.assetId, NOW, 'up_1')).rejects.toBeInstanceOf(
			NotFoundException,
		);
		const picture = await h.service.presignFile('adm_1', photo(null));
		await expect(h.service.finalizeFile('adm_2', picture.assetId)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('leaves a file’s visibility alone when it already has it', async () => {
		const h = harness();
		h.file('med_pdf', { kind: 'file', originalFormat: 'application/pdf', visibility: 'private' });
		expect(await h.service.setFileVisibility('adm_1', 'med_pdf', 'private')).toEqual({
			done: 1,
			inUse: [],
			undoId: null,
		});
		expect(h.storage.setVisibility).not.toHaveBeenCalled();
	});
});

describe('details and delete for good: the remaining cases', () => {
	it('shows a plain file without a web name or text, and its uploader by whatever name they have', async () => {
		const h = harness();
		h.file('med_pdf', {
			kind: 'file',
			originalFormat: 'application/pdf',
			uploadedBy: { type: 'admin', id: 'adm_u' },
		});
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ displayName: null, username: 'asha', email: 'asha@example.test' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: 'asha@example.test' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: null })
			.mockRejectedValueOnce(new Error('database down'));
		Object.defineProperty(h.service, 'admins', { value: { findById } });
		const first = await h.service.details('med_pdf');
		expect(first).not.toHaveProperty('slug');
		expect(first).not.toHaveProperty('text');
		expect(first.uploadedBy).toBe('asha');
		expect((await h.service.details('med_pdf')).uploadedBy).toBe('asha@example.test');
		expect((await h.service.details('med_pdf')).uploadedBy).toBeNull();
		expect((await h.service.details('med_pdf')).uploadedBy).toBeNull();
	});

	it('hands the email pictures store to delete for good when there is one', async () => {
		const h = harness();
		const keep = vi.fn(async () => undefined);
		Object.defineProperty(h.service, 'emailPictures', { value: { keep } });
		h.file('med_t', { trashedAt: TRASHED });
		expect((await h.service.deleteForever('adm_1', { fileIds: ['med_t'], folderIds: [] })).done).toBe(1);
		expect(h.files.has('med_t')).toBe(false);
	});

	it('cuts a swatch at profile version 1 when the cut profile is missing', async () => {
		const h = harness();
		h.file('med_photo', { width: 1800, height: 2400 });
		Object.defineProperty(h.service, 'profiles', { value: { findByKey: async () => null } });
		const made = await h.service.cut('adm_1', 'med_photo', {
			x: 0.2,
			y: 0.5,
			width: 600 / 1800,
			height: 600 / 2400,
		});
		expect(made.created).toBe(true);
		expect(h.files.get(made.id)?.versions?.[0]?.profileVersion).toBe(1);
	});
});

describe('Clean up: the remaining cases', () => {
	it('skips copies the website uses or that are gone, and names no first copy when it is gone', async () => {
		const h = harness();
		const now = new Date('2026-11-16T00:00:00.000Z');
		h.file('med_first');
		h.file('med_used_copy');
		h.file('med_copy');
		h.file('med_orphan');
		h.used.set('med_used_copy', ['Home']);
		h.browseRepo.sameFileGroups = async () => [
			{ sha256: 'a'.repeat(64), ids: ['med_first', 'med_used_copy', 'med_gone', 'med_copy'] },
			{ sha256: 'b'.repeat(64), ids: ['med_lost', 'med_orphan'] },
		];
		const copies = await h.service.cleanUp('adm_1', { list: 'duplicates', page: 1 }, now);
		expect(copies.total).toBe(3);
		expect(copies.rows.map((row) => [row.file.id, row.sameAs?.id ?? null])).toEqual([
			['med_copy', 'med_first'],
			['med_orphan', null],
		]);
	});

	it('lists nothing past the 50 largest, and dates files without an upload date as unknown', async () => {
		const h = harness();
		h.file('med_undated');
		const largest = await h.service.cleanUp('adm_1', { list: 'largest', page: 2 }, NOW);
		expect(largest.rows).toEqual([]);
		expect(largest.total).toBe(1);
		const unused = await h.service.cleanUp('adm_1', { list: 'unused', page: 1 }, NOW);
		expect(unused.rows).toEqual([expect.objectContaining({ uploadedAt: null, sameAs: null })]);
	});
});

describe('versions: the remaining cases', () => {
	const asked = { fileIds: ['med_w'], versions: [{ profileKey: 'product_3x4', fill: 'crop' as const }], many: false };

	it('skips a profile that does not exist', async () => {
		const h = harness();
		weave(h);
		const result = await h.service.addVersions('adm_1', {
			...asked,
			versions: [{ profileKey: 'no_such', fill: 'as_is' }],
			many: true,
		});
		expect(result).toMatchObject({ photos: 0, added: 0 });
	});

	it('stops when another admin finished the versions first, or the photo went meanwhile', async () => {
		const finished = harness();
		weave(finished);
		finished.assetRepo.addVersions = async () => {
			const asset = finished.files.get('med_w') as MediaAsset;
			finished.files.set('med_w', { ...asset, versions: [...(asset.versions ?? []), ready('product_3x4.crop')] });
			return null;
		};
		expect(await finished.service.addVersions('adm_1', asked)).toMatchObject({ photos: 0, added: 0 });

		for (const gone of [
			(h: Harness) => h.files.delete('med_w'),
			(h: Harness) => h.files.set('med_w', { ...(h.files.get('med_w') as MediaAsset), trashedAt: TRASHED }),
			(h: Harness) => h.files.set('med_w', { ...(h.files.get('med_w') as MediaAsset), deletedAt: TRASHED }),
		]) {
			const h = harness();
			weave(h);
			h.assetRepo.addVersions = async () => {
				gone(h);
				return null;
			};
			expect(await h.service.addVersions('adm_1', asked)).toMatchObject({ photos: 0, added: 0 });
		}
	});

	it('takes off a version only from a photo still there, and says when another admin is making it', async () => {
		const h = harness();
		await expect(h.service.removeVersion('adm_1', 'med_none', 'x.as_is')).rejects.toBeInstanceOf(NotFoundException);
		h.file('med_gone', { deletedAt: TRASHED });
		await expect(h.service.removeVersion('adm_1', 'med_gone', 'x.as_is')).rejects.toBeInstanceOf(NotFoundException);
		weave(h, [ready('blog_cover_2x1.as_is'), ready('square_1x1.as_is')]);
		h.assetRepo.removeVersion = async () => null;
		expect(await refusalCode(h.service.removeVersion('adm_1', 'med_w', 'square_1x1.as_is'))).toBe('version_making');
	});

	it('removes a version with no files of its own without a delete job', async () => {
		const h = harness();
		weave(h, [ready('blog_cover_2x1.as_is'), ready('square_1x1.as_is')]);
		await h.service.removeVersion('adm_1', 'med_w', 'square_1x1.as_is');
		expect(h.jobs.filter((job) => job.type === 'delete-objects')).toEqual([]);
		expect(h.audit[0]).toMatchObject({
			action: 'media.versions.remove',
			metadata: expect.objectContaining({ bytes: 0 }),
		});
	});

	it('counts how far versions have got, skipping unknown photos', async () => {
		const h = harness();
		h.file('med_plain');
		h.file('med_failed', { versions: [ready('square_1x1.as_is', 'failed')] });
		h.file('med_making', { versions: [ready('square_1x1.as_is', 'making')] });
		expect(await h.service.versionsStatus(['med_plain', 'med_failed', 'med_making', 'med_none'])).toEqual({
			photos: 3,
			making: 1,
			failed: 1,
		});
	});
});

const SHA = 'a'.repeat(64);

describe('the lists that only fill with folders, stars and older trash', () => {
	it('shows starred folders among favourites', async () => {
		const h = harness();
		folder(h, 'fld_fav', { name: 'Sarees' });
		folder(h, 'fld_plain', { name: 'Blouses' });
		h.file('med_a');
		await h.service.star('adm_1', { targetType: 'folder', targetId: 'fld_fav', starred: true });
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_a', starred: true });
		const view = await h.service.browse('adm_1', { ...base, view: 'favourites' }, NOW);
		expect(view.folders.map((row) => row.id)).toEqual(['fld_fav']);
		const everyone = await h.service.browse('adm_1', { ...base, view: 'favourites', who: 'everyone' }, NOW);
		expect(everyone.folders.map((row) => row.id)).toEqual(['fld_fav']);
	});

	it('gives a renamed folder a free name beside its sisters', async () => {
		const h = harness();
		folder(h, 'fld_a', { name: 'Sarees' });
		folder(h, 'fld_b', { name: 'Silk' });
		await h.service.renameFolder('adm_1', 'fld_a', 'Silk');
		expect(h.folders.get('fld_a')?.name).not.toBe('Silk');
		expect(h.folders.get('fld_a')?.name).toContain('Silk');
	});

	it('brings back the trashed files inside a restored folder', async () => {
		const h = harness();
		folder(h, 'fld_t', { trashedAt: TRASHED });
		h.file('med_in', { folderId: 'fld_t', trashedAt: TRASHED });
		h.file('med_kept', { folderId: 'fld_t' });
		await h.service.restore('adm_1', { fileIds: [], folderIds: ['fld_t'], whenFolderGone: 'my_files' });
		expect(h.files.get('med_in')?.trashedAt).toBeNull();
	});

	it('names each deleted file’s address when emptying old trash', async () => {
		const h = harness();
		h.file('med_old', {
			kind: 'file',
			originalFormat: 'application/pdf',
			visibility: 'public',
			trashedAt: '2026-01-01T00:00:00.000Z',
		});
		expect(await h.service.purgeTrash(NOW)).toBeGreaterThan(0);
		expect(h.jobs.flatMap((job) => job.urls).some((url) => url.startsWith('https://cdn.test/'))).toBe(true);
	});

	it('looks up the folders of files that would be uploaded twice, and of the clean-up lists', async () => {
		const h = harness();
		folder(h, 'fld_a', { name: 'Sarees' });
		h.file('med_same', { folderId: 'fld_a', sha256: SHA, createdAt: '2026-11-01T00:00:00.000Z' });
		h.file('med_copy', { folderId: 'fld_a', sha256: SHA, createdAt: '2026-11-02T00:00:00.000Z' });
		await h.service.star('adm_1', { targetType: 'file', targetId: 'med_same', starred: true });
		const twice = await h.service.duplicates({
			folderId: 'fld_a',
			files: [{ name: 'med_same.jpg', sha256: SHA }],
		} as never);
		expect(twice.files).toHaveLength(1);
		const copies = await h.service.cleanUp('adm_1', { list: 'duplicates', page: 1 } as never, NOW);
		expect(JSON.stringify(copies)).toContain('med_copy');
	});
});
