import type { MediaAsset, MediaFolder } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	ZIP_KEEP_HOURS,
	buildZip,
	sweepZips,
	zipContents,
	zipEntryName,
	zipPlan,
	zipStorageKey,
	type MediaZipRecord,
	type ZipArchivePort,
} from '../src/index';

/**
 * Folder downloads as .zip (media step 5, A30, A30B, A48). A tree of folders and files, some in Trash, held in memory.
 */
const folder = (id: string, name: string, ancestors: string[] = [], trashedAt: string | null = null): MediaFolder => ({
	id,
	name,
	parentId: ancestors.at(-1) ?? null,
	ancestors,
	files: 0,
	bytes: 0,
	trashedAt,
	trashedFrom: null,
	createdBy: null,
});
const file = (id: string, name: string, folderId: string | null, bytes = 10, extra: Partial<MediaAsset> = {}) =>
	({
		id,
		kind: 'file',
		slug: name.toLowerCase(),
		displayName: name,
		folderId,
		originalStorageKey: `media/${id}/original`,
		originalByteSize: bytes,
		trashedAt: null,
		processing: { state: 'ready', attempts: 0, error: null, processedAt: null },
		...extra,
	}) as unknown as MediaAsset;

const FOLDERS = [
	folder('fld_wed', 'Weddings'),
	folder('fld_ban', 'Banarasi', ['fld_wed']),
	folder('fld_red', 'Red / gold', ['fld_wed', 'fld_ban']),
	folder('fld_empty', 'Empty', ['fld_wed']),
	folder('fld_old', 'Old', ['fld_wed'], '2026-11-01T00:00:00.000Z'),
	folder('fld_in_old', 'Inside old', ['fld_wed', 'fld_old']),
];
const FILES = [
	file('med_1', 'cover.jpg', 'fld_wed', 100),
	file('med_2', 'front.jpg', 'fld_ban', 200),
	file('med_3', 'FRONT.jpg', 'fld_ban', 300),
	file('med_4', 'zari.jpg', 'fld_red', 400),
	file('med_5', 'trashed.jpg', 'fld_ban', 500, { trashedAt: '2026-11-02T00:00:00.000Z' }),
	file('med_6', 'half-sent.zip', 'fld_ban', 600, {
		processing: { state: 'awaiting_upload' } as MediaAsset['processing'],
	}),
	file('med_7', 'lost.jpg', 'fld_in_old', 700),
	file('med_8', 'brief.pdf', null, 50),
];
const deps = {
	folders: {
		findManyByIds: async (ids: readonly string[]) => FOLDERS.filter((row) => ids.includes(row.id)),
		findById: async (id: string) => FOLDERS.find((row) => row.id === id) ?? null,
		listSubtree: async (id: string) => FOLDERS.filter((row) => row.ancestors.includes(id)),
	},
	browse: {
		listInFolders: async (ids: readonly string[]) => FILES.filter((row) => ids.includes(row.folderId ?? '')),
	},
	assets: { findManyByIds: async (ids: readonly string[]) => FILES.filter((row) => ids.includes(row.id)) },
};

describe('zipContents — what a .zip holds (A30)', () => {
	it('one folder alone: named after it, at its top, keeping its tree; Trash and half-sent files left out', async () => {
		const contents = await zipContents(deps, { folderIds: ['fld_wed'], fileIds: [] });
		expect(contents.name).toBe('Weddings');
		expect(contents.items.map((item) => item.path).sort()).toEqual([
			'Weddings/Banarasi/FRONT (1).jpg',
			'Weddings/Banarasi/Red - gold/zari.jpg',
			'Weddings/Banarasi/front.jpg',
			'Weddings/cover.jpg',
		]);
		// A folder with nothing in it stays a folder; a trashed folder and what is inside it are left out.
		expect(contents.emptyFolders).toEqual(['Weddings/Empty/']);
		expect(zipPlan(contents)).toEqual({ name: 'Weddings.zip', files: 4, bytes: 1000 });
	});

	it('several items: named after the folder they were picked in, folders at the top beside the files', async () => {
		const inside = await zipContents(deps, { folderIds: ['fld_red'], fileIds: ['med_2'] });
		expect(inside.name).toBe('Banarasi');
		expect(inside.items.map((item) => item.path)).toEqual(['Red - gold/zari.jpg', 'front.jpg']);
		const top = await zipContents(deps, { folderIds: [], fileIds: ['med_8', 'med_5'] }, 'My files');
		expect(top).toMatchObject({ name: 'My files', items: [{ path: 'brief.pdf', key: 'media/med_8/original' }] });
	});
});

describe('zipEntryName — a file opens from the .zip by double-click', () => {
	const named = (displayName: string | null, key: string) =>
		zipEntryName({ displayName, slug: 'fallback-slug', originalStorageKey: key } as MediaAsset);

	it('adds the stored ending to a photo whose name has none, and keeps a name that has it', () => {
		expect(named('local-home-banner-hero-right', 'media/med_1/original.jpg')).toBe(
			'local-home-banner-hero-right.jpg',
		);
		expect(named('Red Banarasi FRONT.JPG', 'media/med_2/original.jpg')).toBe('Red Banarasi FRONT.JPG');
		expect(named('size-chart.pdf', 'files/med_3/size-chart.pdf')).toBe('size-chart.pdf');
		// A dot inside the name is not an ending.
		expect(named('summer.collection', 'media/med_4/original.webp')).toBe('summer.collection.webp');
		// No ending stored: nothing to add; no name: the web file name.
		expect(named('README', 'files/med_5/README')).toBe('README');
		expect(named(null, 'media/med_6/original.png')).toBe('fallback-slug.png');
	});
});

/** Writes each entry's path and bytes one after another, so a test can read what went in. */
const archive: ZipArchivePort = {
	async *write(entries) {
		for await (const entry of entries) {
			yield new TextEncoder().encode(`[${entry.path}]`);
			if ('read' in entry) for await (const chunk of entry.read()) yield chunk;
		}
	},
};

function harness(state: MediaZipRecord['state'] = 'adding', options: { failOn?: string; cancelAfter?: number } = {}) {
	let clock = Date.parse('2026-11-16T10:00:00.000Z');
	const record: MediaZipRecord = {
		id: 'zip_1',
		name: 'Weddings.zip',
		state,
		files: { done: 0, total: 0 },
		bytes: { done: 0, total: 0 },
		createdAt: '2026-11-16T10:00:00.000Z',
		readyAt: null,
		expiresAt: null,
		error: null,
		userId: 'adm_1',
		fileIds: [],
		folderIds: ['fld_wed'],
		storageKey: zipStorageKey('zip_1'),
	};
	const stored = new Map<string, string>();
	const deleted: string[] = [];
	let reads = 0;
	return {
		record,
		stored,
		deleted,
		deps: {
			...deps,
			now: () => new Date((clock += 1500)),
			zips: {
				find: async () => ({ ...record }),
				update: async (_id: string, patch: Partial<MediaZipRecord>) => {
					if (record.state !== 'adding') return null;
					Object.assign(record, patch);
					return { ...record };
				},
			} as never,
			storage: {
				async *readStream(key: string) {
					reads += 1;
					if (options.cancelAfter && reads > options.cancelAfter) record.state = 'cancelled';
					if (key === options.failOn) throw new Error('Spaces did not answer');
					yield new TextEncoder().encode(key);
				},
				uploadStream: async (input: { key: string; body: AsyncIterable<Uint8Array> }) => {
					let text = '';
					for await (const chunk of input.body) text += new TextDecoder().decode(chunk);
					stored.set(input.key, text);
					return { bytes: text.length };
				},
				delete: async (key: string) => {
					deleted.push(key);
				},
			},
			archive,
		},
	};
}

describe('buildZip — the worker writes the .zip into Spaces (A30, A48)', () => {
	it('writes every file into one private .zip, counts real progress, and is ready for 24 hours', async () => {
		const run = harness();
		await expect(buildZip(run.deps, { zipId: 'zip_1' })).resolves.toBe('ready');
		const text = run.stored.get('zips/zip_1.zip') ?? '';
		expect(text).toContain('[Weddings/Empty/]');
		expect(text).toContain('[Weddings/Banarasi/Red - gold/zari.jpg]media/med_4/original');
		expect(run.record).toMatchObject({
			state: 'ready',
			files: { done: 4, total: 4 },
			bytes: { done: text.length },
		});
		expect(Date.parse(run.record.expiresAt ?? '') - Date.parse(run.record.readyAt ?? '')).toBe(
			ZIP_KEEP_HOURS * 3_600_000,
		);
	});

	it('stops at the next file when cancelled, and keeps nothing', async () => {
		const run = harness('adding', { cancelAfter: 1 });
		await expect(buildZip(run.deps, { zipId: 'zip_1' })).resolves.toBe('cancelled');
		expect(run.deleted).toContain('zips/zip_1.zip');
		expect(run.record.state).toBe('cancelled');
	});

	it('a failure is recorded with its reason and leaves nothing stored; a .zip not being made is left alone', async () => {
		const run = harness('adding', { failOn: 'media/med_2/original' });
		await expect(buildZip(run.deps, { zipId: 'zip_1' })).resolves.toBe('failed');
		expect(run.record).toMatchObject({ state: 'failed', error: 'Spaces did not answer' });
		expect(run.deleted).toEqual(['zips/zip_1.zip']);
		const cancelled = harness('cancelled');
		await expect(buildZip(cancelled.deps, { zipId: 'zip_1' })).resolves.toBe('cancelled');
		expect(cancelled.stored.size).toBe(0);
	});
});

describe('sweepZips — the hourly sweep', () => {
	it('deletes what is due, ends its storage hold, and marks it done so it is swept once', async () => {
		const due = [
			{ id: 'zip_a', state: 'ready', storageKey: 'zips/zip_a.zip' },
			{ id: 'zip_b', state: 'cancelled', storageKey: 'zips/zip_b.zip' },
		] as MediaZipRecord[];
		const finished: [string, string][] = [];
		const deleted: string[] = [];
		const released: string[] = [];
		const count = await sweepZips({
			zips: {
				listToSweep: async () => due,
				finishSweep: async (id, state) => {
					finished.push([id, state]);
				},
			},
			storage: { delete: async (key) => void deleted.push(key) },
			releaseHold: async (id) => void released.push(id),
			now: () => new Date('2026-11-17T11:00:00.000Z'),
		});
		expect(count).toBe(2);
		expect(deleted).toEqual(['zips/zip_a.zip', 'zips/zip_b.zip']);
		expect(released).toEqual(['zip_a', 'zip_b']);
		expect(finished).toEqual([
			['zip_a', 'expired'],
			['zip_b', 'cancelled'],
		]);
	});
});
