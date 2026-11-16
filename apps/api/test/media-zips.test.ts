import type { MediaAsset, MediaFolder } from '@saha-textile/contracts';
import type { MediaZipRecord } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { MediaZipsService } from '../src/media/media-zips.service';

/** Folder downloads as .zip (media step 5): the plan, the storage hold, own-only access and the link. */
const NOW = new Date('2026-11-16T10:00:00.000Z');
const folder = {
	id: 'fld_1',
	name: 'Product photos',
	parentId: null,
	ancestors: [],
	trashedAt: null,
} as unknown as MediaFolder;
const asset = (id: string, bytes: number) =>
	({
		id,
		slug: id,
		displayName: `${id}.jpg`,
		folderId: 'fld_1',
		originalStorageKey: `media/${id}/original.jpg`,
		originalByteSize: bytes,
		trashedAt: null,
		processing: { state: 'ready' },
	}) as unknown as MediaAsset;

function harness() {
	const records = new Map<string, MediaZipRecord>();
	const zips = {
		create: vi.fn(async (zip: MediaZipRecord) => void records.set(zip.id, zip)),
		find: vi.fn(async (id: string) => records.get(id) ?? null),
		setState: vi.fn(async (id: string, state: MediaZipRecord['state']) => {
			const zip = records.get(id);
			if (zip) records.set(id, { ...zip, state });
		}),
		listForUser: vi.fn(async (userId: string) => [...records.values()].filter((zip) => zip.userId === userId)),
	};
	const ledger = { reserve: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
	const queue = { enqueue: vi.fn(async () => undefined) };
	const audit = { append: vi.fn(async () => undefined) };
	const storageCheck = { admit: vi.fn(async () => undefined) };
	const storage = { createSignedDownloadUrl: vi.fn(async () => 'https://spaces.test/zips/signed') };
	const service = new MediaZipsService(
		zips as never,
		{
			findManyByIds: async (ids: readonly string[]) => (ids.includes('fld_1') ? [folder] : []),
			findById: async () => null,
			listSubtree: async () => [],
		},
		{ listInFolders: async () => [asset('med_1', 100), asset('med_2', 250)] },
		{ findManyByIds: async () => [] },
		storage as never,
		ledger as never,
		queue as never,
		audit as never,
		storageCheck as never,
	);
	return { service, records, ledger, queue, audit, storageCheck, storage };
}

describe('MediaZipsService (media step 5, A30, A30B, A48)', () => {
	it('plans a folder as Folder.zip with its files and bytes, for the storage check', async () => {
		const { service } = harness();
		await expect(service.plan({ folderIds: ['fld_1'], fileIds: [] })).resolves.toEqual({
			name: 'Product photos.zip',
			files: 2,
			bytes: 350,
		});
	});

	it('starts a .zip under the check’s hold, keeps a 25-hour hold of its own, and hands it to the worker', async () => {
		const run = harness();
		const zip = await run.service.create(
			'adm_1',
			{ folderIds: ['fld_1'], fileIds: [], reservationId: 'res_1' },
			NOW,
		);
		expect(zip).toMatchObject({ name: 'Product photos.zip', state: 'adding', files: { done: 0, total: 2 } });
		expect(zip).not.toHaveProperty('storageKey');
		expect(run.storageCheck.admit).toHaveBeenCalledWith('adm_1', 350, 'res_1', zip.id, NOW);
		expect(run.ledger.reserve).toHaveBeenCalledWith({
			id: zip.id,
			userId: 'adm_1',
			bytes: 350,
			expiresAt: '2026-11-17T11:00:00.000Z',
		});
		expect(run.ledger.release).toHaveBeenCalledWith('res_1');
		expect(run.queue.enqueue).toHaveBeenCalledWith({ type: 'zip', zipId: zip.id });
		expect(run.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'media.zip.create' }));
	});

	it('refuses a .zip with nothing in it', async () => {
		const run = harness();
		await expect(run.service.create('adm_1', { folderIds: ['fld_gone'], fileIds: [] }, NOW)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'zip_empty' })] },
		});
		expect(run.queue.enqueue).not.toHaveBeenCalled();
	});

	it('shows, cancels and links only the person’s own .zip; another admin is told it does not exist', async () => {
		const run = harness();
		const zip = await run.service.create('adm_1', { folderIds: ['fld_1'], fileIds: [] }, NOW);
		await expect(run.service.get('adm_2', zip.id)).rejects.toThrow('No such .zip');
		await expect(run.service.cancel('adm_2', zip.id)).rejects.toThrow('No such .zip');
		await expect(run.service.link('adm_2', zip.id, NOW)).rejects.toThrow('No such .zip');
		expect((await run.service.list('adm_2', NOW)).zips).toEqual([]);
		expect((await run.service.list('adm_1', NOW)).zips.map((row) => row.id)).toEqual([zip.id]);
	});

	it('links a ready .zip for five minutes under its name; not before, and not after its 24 hours', async () => {
		const run = harness();
		const zip = await run.service.create('adm_1', { folderIds: ['fld_1'], fileIds: [] }, NOW);
		await expect(run.service.link('adm_1', zip.id, NOW)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'zip_not_ready' })] },
		});
		const stored = run.records.get(zip.id);
		if (!stored) throw new Error('no record');
		run.records.set(zip.id, {
			...stored,
			state: 'ready',
			readyAt: '2026-11-16T10:05:00.000Z',
			expiresAt: '2026-11-17T10:05:00.000Z',
		});
		await expect(run.service.link('adm_1', zip.id, NOW)).resolves.toEqual({
			url: 'https://spaces.test/zips/signed',
		});
		expect(run.storage.createSignedDownloadUrl).toHaveBeenCalledWith({
			key: `zips/${zip.id}.zip`,
			expiresInSeconds: 300,
			fileName: 'Product photos.zip',
			disposition: 'attachment',
		});
		await expect(run.service.link('adm_1', zip.id, new Date('2026-11-17T10:06:00.000Z'))).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'zip_not_ready' })] },
		});
	});

	it('cancels a .zip being made once; a finished one stays as it is', async () => {
		const run = harness();
		const zip = await run.service.create('adm_1', { folderIds: ['fld_1'], fileIds: [] }, NOW);
		await expect(run.service.cancel('adm_1', zip.id)).resolves.toMatchObject({ state: 'cancelled' });
		await expect(run.service.cancel('adm_1', zip.id)).resolves.toMatchObject({ state: 'cancelled' });
		expect(run.audit.append).toHaveBeenCalledTimes(2);
	});
});
