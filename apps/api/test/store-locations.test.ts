import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type MediaAsset, type StoreLocation, StoreLocationWrite, WEEKDAYS } from '@saha-textile/contracts';
import { compareStoreLocations } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { AdminStoreLocationsController } from '../src/stores/admin-store-locations.controller';
import { StoreLocationsAdminService } from '../src/stores/store-locations-admin.service';
import { StoreLocationsPublicController } from '../src/stores/store-locations-public.controller';
import { StoreLocationsPublicService } from '../src/stores/store-locations-public.service';
import { LanguageStore } from '../src/languages/language-store';

const config = LanguageStore.fixed(['en', 'bn']);
const open = WEEKDAYS.map((day) => ({ day, open: day !== 'sun', opens: '10:00', closes: '20:30' }));
const closed = WEEKDAYS.map((day) => ({ day, open: false }));

const asset = (id: string, overrides: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id,
		kind: 'image',
		purpose: 'store',
		originalStorageKey: `media/${id}/original.jpg`,
		slug: id,
		width: 1600,
		height: 1200,
		derivatives: [
			{
				role: 'store_photo',
				width: 400,
				height: 300,
				format: 'image/webp',
				storageKey: `${id}-400`,
				roleVersion: 1,
			},
			{
				role: 'store_photo',
				width: 800,
				height: 600,
				format: 'image/webp',
				storageKey: `${id}-800`,
				roleVersion: 1,
			},
		],
		visibility: 'public',
		processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		warnings: [],
		text: { alt: { en: 'Inside the store' }, title: {}, caption: {} },
		dominantColor: null,
		thumbHash: null,
		uploadedBy: { type: 'admin', id: 'a1' },
		deletedAt: null,
		...overrides,
	}) as never;

const body = (overrides: Record<string, unknown> = {}) =>
	StoreLocationWrite.parse({
		name: { en: ' Saha Textile,  Barasat ', bn: 'সাহা টেক্সটাইল, বারাসাত' },
		address: { en: 'No. 29, KB Basu Rd', bn: 'নং 29, কে বি বসু রোড', fr: '' },
		landmark: { en: 'Near Barasat Police Station', bn: 'বারাসাত থানার কাছে' },
		pinCode: '700124',
		mapUrl: 'https://maps.google.com/?cid=7310727910860297646',
		phone: '033 2552 1595',
		hours: open,
		photoAssetIds: ['med_a', 'med_b', 'med_a'],
		active: true,
		...overrides,
	});

function harness(withAudit = true) {
	const stores = new Map<string, StoreLocation>();
	const assets = new Map<string, MediaAsset>([
		['med_a', asset('med_a')],
		['med_b', asset('med_b')],
		['med_gone', asset('med_gone', { deletedAt: '2026-11-01T00:00:00.000Z' })],
		['med_private', asset('med_private', { visibility: 'private' })],
		['med_raw', asset('med_raw', { derivatives: [] })],
		[
			'med_small',
			asset('med_small', {
				derivatives: [
					{
						role: 'store_photo',
						width: 300,
						height: 225,
						format: 'image/webp',
						storageKey: 's',
						byteSize: 1,
						roleVersion: 1,
					},
				],
			}),
		],
	]);
	const audit: { action: string; entityId: string | null }[] = [];
	const repo = {
		list: async () => [...stores.values()].sort(compareStoreLocations),
		findById: async (id: string) => stores.get(id) ?? null,
		save: async (store: StoreLocation) => {
			stores.set(store.id, store);
			return store;
		},
		remove: async (id: string) => void stores.delete(id),
		setOrder: async (ids: readonly string[]) => {
			ids.forEach((id, index) => {
				const store = stores.get(id);
				if (store) stores.set(id, { ...store, displayOrder: index });
			});
		},
	};
	const assetRepo = {
		findManyByIds: async (ids: readonly string[]) => ids.map((id) => assets.get(id)).filter(Boolean),
	};
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const auditRepo = withAudit
		? { append: async (entry: { action: string; entityId: string | null }) => void audit.push(entry) }
		: null;
	const admin = new StoreLocationsAdminService(
		repo as never,
		assetRepo as never,
		storage as never,
		config,
		auditRepo as never,
	);
	const publicService = new StoreLocationsPublicService(repo as never, assetRepo as never, storage as never);
	return { stores, assets, audit, admin, publicService };
}

describe('StoreLocationsAdminService', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('creates a complete store active, cleaned, last in the order, and audited', async () => {
		const first = await h.admin.create(body(), 'admin_1');
		expect(first).toEqual({ id: first.id, active: true, gaps: [] });
		const second = await h.admin.create(body({ name: { en: 'Second', bn: 'দ্বিতীয়' } }), 'admin_1');
		const stored = h.stores.get(first.id);
		expect(stored).toMatchObject({
			name: { en: 'Saha Textile, Barasat', bn: 'সাহা টেক্সটাইল, বারাসাত' },
			address: { en: 'No. 29, KB Basu Rd', bn: 'নং 29, কে বি বসু রোড' },
			phone: '+913325521595',
			photoAssetIds: ['med_a', 'med_b'],
			displayOrder: 0,
		});
		expect(h.stores.get(second.id)?.displayOrder).toBe(1);
		expect(h.audit.map((entry) => entry.action)).toEqual(['store_location.create', 'store_location.create']);
	});

	it('saves an incomplete store switched off and says what is missing', async () => {
		const result = await h.admin.create(body({ name: { en: 'Agartala' }, hours: closed }), null);
		expect(result.active).toBe(false);
		expect(result.gaps).toEqual([
			{ field: 'name', locale: 'bn' },
			{ field: 'hours', locale: null },
		]);
		expect(h.stores.get(result.id)?.active).toBe(false);
		const noPhone = await h.admin.create(body({ phone: '' }), null);
		expect(noPhone.gaps).toEqual([{ field: 'phone', locale: null }]);
		const quiet = await h.admin.create(body({ hours: closed, active: false }), null);
		expect(quiet).toEqual({ id: quiet.id, active: false, gaps: [] });
	});

	it('refuses a missing English name or address and photos outside the library', async () => {
		await expect(h.admin.create(body({ name: { bn: 'নাম' } }), null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(h.admin.create(body({ address: { en: ' ' } }), null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(h.admin.create(body({ photoAssetIds: ['med_missing'] }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(h.admin.create(body({ photoAssetIds: ['med_gone'] }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect((await h.admin.create(body({ photoAssetIds: [] }), null)).active).toBe(true);
	});

	it('updates a store in place, keeping its order', async () => {
		const { id } = await h.admin.create(body(), null);
		await h.admin.create(body(), null);
		await h.admin.update(id, body({ landmark: {} }), 'admin_2');
		expect(h.stores.get(id)).toMatchObject({ landmark: {}, displayOrder: 0 });
		expect(h.audit.at(-1)).toMatchObject({ action: 'store_location.update', entityId: id });
		await expect(h.admin.update('nope', body(), null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('lists and details stores with photo previews and gaps', async () => {
		const { id } = await h.admin.create(body({ photoAssetIds: ['med_a', 'med_small', 'med_raw'] }), null);
		h.stores.set(id, {
			...(h.stores.get(id) as StoreLocation),
			photoAssetIds: ['med_a', 'med_small', 'med_raw', 'med_deleted_from_db'],
		});
		const [row] = await h.admin.list();
		expect(row?.photos).toEqual([
			{ id: 'med_a', url: 'https://cdn.test/med_a-400' },
			{ id: 'med_small', url: 'https://cdn.test/s' },
			{ id: 'med_raw', url: '' },
		]);
		expect(row?.gaps).toEqual([]);
		expect((await h.admin.detail(id)).store.id).toBe(id);
		await expect(h.admin.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
		const empty = await h.admin.create(body({ photoAssetIds: [] }), null);
		expect((await h.admin.detail(empty.id)).photos).toEqual([]);
	});

	it('switches a store on only when ready, and off any time', async () => {
		const ready = await h.admin.create(body({ active: false }), null);
		const unready = await h.admin.create(body({ hours: closed, active: false }), null);
		expect(await h.admin.setActive(unready.id, true, null)).toEqual({
			id: unready.id,
			active: false,
			gaps: [{ field: 'hours', locale: null }],
		});
		expect(await h.admin.setActive(ready.id, true, null)).toEqual({ id: ready.id, active: true, gaps: [] });
		const before = h.audit.length;
		await h.admin.setActive(ready.id, true, null);
		expect(h.audit.length).toBe(before);
		await h.admin.setActive(ready.id, false, null);
		expect(h.stores.get(ready.id)?.active).toBe(false);
		expect(h.audit.at(-1)?.action).toBe('store_location.deactivate');
	});

	it('reorders by the ids given and keeps left-out stores after them', async () => {
		const a = await h.admin.create(body(), null);
		const b = await h.admin.create(body(), null);
		const c = await h.admin.create(body(), null);
		await h.admin.reorder([c.id, a.id], null);
		expect((await h.admin.list()).map((row) => row.store.id)).toEqual([c.id, a.id, b.id]);
		await expect(h.admin.reorder([a.id, a.id], null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(h.admin.reorder(['nope'], null)).rejects.toBeInstanceOf(BadRequestException);
	});

	it('deletes a store', async () => {
		const { id } = await h.admin.create(body(), null);
		await h.admin.remove(id, null);
		expect(h.stores.has(id)).toBe(false);
		await expect(h.admin.remove(id, null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('works without an audit log', async () => {
		const quiet = harness(false);
		const { id } = await quiet.admin.create(body(), null);
		expect(quiet.stores.has(id)).toBe(true);
	});
});

describe('StoreLocationsPublicService', () => {
	it('lists active stores in one language with finished public photos only', async () => {
		const h = harness();
		const { id } = await h.admin.create(
			body({ photoAssetIds: ['med_a', 'med_private', 'med_raw', 'med_b'], landmark: {} }),
			null,
		);
		h.stores.set(id, {
			...(h.stores.get(id) as StoreLocation),
			photoAssetIds: ['med_a', 'med_private', 'med_raw', 'med_b', 'med_gone', 'med_none'],
		});
		await h.admin.create(body({ hours: closed }), null);
		const [card, ...rest] = await h.publicService.list('bn');
		expect(rest).toEqual([]);
		expect(card).toMatchObject({
			name: 'সাহা টেক্সটাইল, বারাসাত',
			landmark: null,
			phoneDisplay: '+91 33 2552 1595',
			hoursSummary: 'সোম–শনি 10:00–20:30, রবি বন্ধ',
		});
		expect(card?.photos.map((photo) => photo.assetId)).toEqual(['med_a', 'med_b']);
	});

	it('falls back to English and handles stores without photos', async () => {
		const h = harness();
		await h.admin.create(body({ name: { en: 'Only English', bn: 'শুধু' }, photoAssetIds: [] }), null);
		h.stores.forEach((store, key) =>
			h.stores.set(key, { ...store, name: { en: 'Only English' }, landmark: { en: 'Near the station' } }),
		);
		const [card] = await h.publicService.list('bn');
		expect(card).toMatchObject({ name: 'Only English', landmark: 'Near the station', photos: [] });
		h.stores.forEach((store, key) => h.stores.set(key, { ...store, phone: null }));
		expect((await h.publicService.list('bn'))[0]).toMatchObject({ phone: null, phoneDisplay: null });
		h.stores.forEach((store, key) => h.stores.set(key, { ...store, name: {} }));
		expect((await h.publicService.list('bn'))[0]?.name).toBe('');
	});
});

describe('store location controllers', () => {
	it('pass requests to the services', async () => {
		const h = harness();
		const admin = new AdminStoreLocationsController(h.admin);
		const principal = { userId: 'admin_1' } as never;
		const created = await admin.create(body(), principal);
		expect((await admin.list()).length).toBe(1);
		expect((await admin.detail(created.id)).store.id).toBe(created.id);
		await admin.update(created.id, body({ active: false }), undefined);
		expect((await admin.active(created.id, { active: true }, principal)).active).toBe(true);
		expect(await admin.reorder({ ids: [created.id] }, principal)).toEqual({ ok: true });
		const publicController = new StoreLocationsPublicController(h.publicService);
		expect((await publicController.list({ locale: 'en' })).length).toBe(1);
		expect(await admin.remove(created.id, principal)).toEqual({ ok: true });
	});
});
