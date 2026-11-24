import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	type AdminStoreLocationRow,
	type AdminStorePhoto,
	type AuditLog,
	type MediaAsset,
	StoreLocation,
	type StoreLocationSaveResult,
	type StoreLocationWriteParsed,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type MediaAssetRepository,
	type StoragePort,
	type StoreLocationRepository,
	resolveImage,
	storeLocationGaps,
} from '@saha-textile/core-domain';

import { LanguageStore } from '../languages/language-store';
import { AUDIT_LOG_REPOSITORY, MEDIA_ASSET_REPOSITORY, STORAGE_PORT, STORE_LOCATION_REPOSITORY } from '../infra/tokens';

/** Trimmed text per language, empty languages dropped. */
const clean = (values: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values)
			.map(([locale, value]) => [locale, value.trim().replace(/\s+/g, ' ')] as const)
			.filter(([, value]) => value.length > 0),
	);

/**
 * The super admin's Stores screen (Settings › Stores): add, edit, reorder, switch on and off,
 * delete. A store goes active only with every language complete and at least one open day; any
 * other save is kept as it is, so a store with unknown hours can wait switched off.
 */
@Injectable()
export class StoreLocationsAdminService {
	constructor(
		@Inject(STORE_LOCATION_REPOSITORY) private readonly stores: StoreLocationRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		private readonly languages: LanguageStore,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async list(): Promise<AdminStoreLocationRow[]> {
		const stores = await this.stores.list();
		const assets = await this.assetMap(stores.flatMap((store) => store.photoAssetIds));
		return stores.map((store) => this.row(store, assets));
	}

	async detail(id: string): Promise<AdminStoreLocationRow> {
		const store = await this.require(id);
		return this.row(store, await this.assetMap(store.photoAssetIds));
	}

	async create(body: StoreLocationWriteParsed, actor: string | null): Promise<StoreLocationSaveResult> {
		const existing = await this.stores.list();
		const order = existing.reduce((max, store) => Math.max(max, store.displayOrder + 1), 0);
		return this.write(`store_${randomUUID()}`, body, order, null, actor);
	}

	async update(id: string, body: StoreLocationWriteParsed, actor: string | null): Promise<StoreLocationSaveResult> {
		const current = await this.require(id);
		return this.write(id, body, current.displayOrder, current, actor);
	}

	/** The list's switch. Switching on is refused, with the gaps, while anything is missing. */
	async setActive(id: string, active: boolean, actor: string | null): Promise<StoreLocationSaveResult> {
		const store = await this.require(id);
		const gaps = active ? storeLocationGaps(store, this.languages.shop()) : [];
		if (gaps.length) return { id, active: store.active, gaps };
		if (store.active !== active) {
			await this.stores.save({ ...store, active });
			await this.record(actor, active ? 'store_location.activate' : 'store_location.deactivate', id, {});
		}
		return { id, active, gaps: [] };
	}

	/** Every store id in the new order, as the drag-and-drop list sends it. */
	async reorder(ids: readonly string[], actor: string | null): Promise<void> {
		const stored = await this.stores.list();
		const known = new Set(stored.map((store) => store.id));
		if (new Set(ids).size !== ids.length) throw new BadRequestException('Each store may appear once');
		const unknown = ids.filter((id) => !known.has(id));
		if (unknown.length) throw new BadRequestException('Unknown store in the new order');
		// Stores the request left out keep their relative order after the ones it names.
		const rest = stored.map((store) => store.id).filter((id) => !ids.includes(id));
		await this.stores.setOrder([...ids, ...rest]);
		await this.record(actor, 'store_location.reorder', null, { ids: [...ids, ...rest] });
	}

	async remove(id: string, actor: string | null): Promise<void> {
		await this.require(id);
		await this.stores.remove(id);
		await this.record(actor, 'store_location.delete', id, {});
	}

	private async write(
		id: string,
		body: StoreLocationWriteParsed,
		displayOrder: number,
		current: StoreLocation | null,
		actor: string | null,
	): Promise<StoreLocationSaveResult> {
		const name = clean(body.name);
		const address = clean(body.address);
		if (!name['en']) throw new BadRequestException('A name in English is required');
		if (!address['en']) throw new BadRequestException('An address in English is required');
		await this.assertPhotos(body.photoAssetIds);
		const draft = StoreLocation.parse({
			id,
			name,
			address,
			landmark: clean(body.landmark),
			pinCode: body.pinCode,
			mapUrl: body.mapUrl,
			geo: body.geo,
			phone: body.phone,
			hours: body.hours,
			photoAssetIds: [...new Set(body.photoAssetIds)],
			// Only the store's own photos keep a stored version. The schema defaults the versions to {}.
			imageVersions: Object.fromEntries(
				Object.entries(body.imageVersions).filter(([assetId]) => body.photoAssetIds.includes(assetId)),
			),
			displayOrder,
			active: false,
		});
		const gaps = storeLocationGaps(draft, this.languages.shop());
		// Asked to be active but not ready: everything else is saved and the store stays off.
		const active = body.active && gaps.length === 0;
		await this.stores.save({ ...draft, active });
		await this.record(actor, current ? 'store_location.update' : 'store_location.create', id, { active });
		return { id, active, gaps: body.active ? gaps : [] };
	}

	private async assertPhotos(ids: readonly string[]): Promise<void> {
		if (!ids.length) return;
		const found = await this.assets.findManyByIds([...new Set(ids)]);
		const usable = new Set(
			found.filter((asset) => !asset.deletedAt && asset.kind === 'image').map((asset) => asset.id),
		);
		if (ids.some((id) => !usable.has(id)))
			throw new BadRequestException('A chosen photo is not in the media library');
	}

	private async require(id: string): Promise<StoreLocation> {
		const store = await this.stores.findById(id);
		if (!store) throw new NotFoundException('No such store');
		return store;
	}

	private row(store: StoreLocation, assets: Map<string, MediaAsset>): AdminStoreLocationRow {
		return {
			store,
			photos: store.photoAssetIds
				.map((id) => this.photo(id, assets))
				.filter((photo): photo is AdminStorePhoto => !!photo),
			gaps: storeLocationGaps(store, this.languages.shop()),
		};
	}

	private photo(id: string, assets: Map<string, MediaAsset>): AdminStorePhoto | null {
		const asset = assets.get(id);
		if (!asset) return null;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles: ['store_photo'],
		});
		const sources = resolved?.roles['store_photo'] ?? [];
		const preview = sources.find((source) => source.width >= 400) ?? sources.at(-1);
		return { id: asset.id, url: preview?.url ?? '' };
	}

	private async assetMap(ids: readonly string[]): Promise<Map<string, MediaAsset>> {
		const wanted = [...new Set(ids)];
		if (!wanted.length) return new Map();
		return new Map((await this.assets.findManyByIds(wanted)).map((asset) => [asset.id, asset]));
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string | null,
		metadata: Record<string, unknown>,
	) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'store_location',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
