import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import {
	InventoryCostLayerModel,
	InventoryLedgerModel,
	MediaAssetModel,
	ProductVariantModel,
} from '../src/models/index';
import {
	InsufficientStockError,
	MongoInventoryCostLayerRepository,
	MongoInventoryRepository,
} from '../src/repositories/inventory.repository';
import { MongoMediaAssetRepository } from '../src/repositories/media.repository';
import { MongoProductVariantRepository } from '../src/repositories/merchandising.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Inventory and media persistence against a real replica set.
 *
 * The inventory cases are the strongest form of the Chunk E "atomic workflows" gate:
 * overselling and lost updates only appear under genuine concurrency, so these drive
 * parallel writes rather than asserting on a mock.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const P = 'it_inv_';
const now = () => new Date().toISOString();

describe.skipIf(!hasMongoEnv())('inventory and media persistence (integration, rs0)', () => {
	const inventory = new MongoInventoryRepository();
	const costLayers = new MongoInventoryCostLayerRepository();
	const media = new MongoMediaAssetRepository();
	const variants = new MongoProductVariantRepository();
	const transactions = new MongoTransactionManager();

	const seedVariant = async (quantity: number, overrides: Record<string, unknown> = {}) => {
		const id = `${P}var_${randomUUID()}`;
		await variants.save({
			id,
			productId: `${P}prod`,
			sku: `${P}${randomUUID().slice(0, 8)}`,
			status: 'live',
			optionSelections: [{ attributeCode: 'design', termCode: 'd1' }],
			optionSelectionHash: `h_${randomUUID()}`,
			isBaseVariant: false,
			priceINR: 1000,
			compareAtPriceINR: null,
			salePriceINR: null,
			stock: { tracked: true, quantity, lowStockThreshold: null, allowBackorder: false, ...overrides },
		});
		return id;
	};

	const movement = (variantId: string, quantityDelta: number) => ({
		variantId,
		productId: `${P}prod`,
		quantityDelta,
		source: 'order_placed' as const,
		reasonCode: null,
		note: null,
		referenceType: null,
		referenceId: null,
		actorUserId: null,
		createdAt: now(),
	});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			ProductVariantModel.syncIndexes(),
			InventoryLedgerModel.syncIndexes(),
			InventoryCostLayerModel.syncIndexes(),
			MediaAssetModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const filter = { _id: new RegExp(`^${P}`) };
		await Promise.all([
			ProductVariantModel.deleteMany(filter).exec(),
			InventoryLedgerModel.deleteMany({ productId: `${P}prod` }).exec(),
			InventoryCostLayerModel.deleteMany({ variantId: new RegExp(`^${P}`) }).exec(),
			MediaAssetModel.deleteMany(filter).exec(),
		]);
		await disconnectMongo();
	});

	describe('stock movements', () => {
		it('records the balance after each movement', async () => {
			const variantId = await seedVariant(10);
			const entry = await inventory.applyDelta(movement(variantId, -3));

			expect(entry.balanceAfter).toBe(7);
			expect((await inventory.getSnapshot(variantId))?.onHand).toBe(7);
		});

		it('refuses to oversell tracked stock', async () => {
			const variantId = await seedVariant(2);
			await expect(inventory.applyDelta(movement(variantId, -5))).rejects.toBeInstanceOf(InsufficientStockError);
			// The failed movement left nothing behind.
			expect((await inventory.getSnapshot(variantId))?.onHand).toBe(2);
			expect((await inventory.listLedger({ variantId })).total).toBe(0);
		});

		it('allows overselling when the variant permits backorder', async () => {
			const variantId = await seedVariant(1, { allowBackorder: true });
			const entry = await inventory.applyDelta(movement(variantId, -3));
			expect(entry.balanceAfter).toBe(-2);
		});

		it('does not lose an update under concurrent decrements', async () => {
			const variantId = await seedVariant(100);
			const results = await Promise.all(
				Array.from({ length: 10 }, () => inventory.applyDelta(movement(variantId, -1))),
			);

			// Every concurrent movement must see a distinct balance; a read-then-write
			// implementation would repeat values and end above 90.
			expect(new Set(results.map((entry) => entry.balanceAfter)).size).toBe(10);
			expect((await inventory.getSnapshot(variantId))?.onHand).toBe(90);
		});

		it('never lets concurrent buyers take more than exists', async () => {
			const variantId = await seedVariant(3);
			const outcomes = await Promise.allSettled(
				Array.from({ length: 8 }, () => inventory.applyDelta(movement(variantId, -1))),
			);

			// Exactly three succeed; the rest are refused rather than driving stock negative.
			expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(3);
			expect((await inventory.getSnapshot(variantId))?.onHand).toBe(0);
		});

		it('rolls the stock change back with the transaction that failed', async () => {
			const variantId = await seedVariant(10);

			await expect(
				transactions.withTransaction(async (context) => {
					await inventory.applyDelta(movement(variantId, -4), context);
					throw new Error('order failed after stock was taken');
				}),
			).rejects.toThrow('order failed after stock was taken');

			// Both the stock and its ledger row are gone — the whole unit of work reversed.
			expect((await inventory.getSnapshot(variantId))?.onHand).toBe(10);
			expect((await inventory.listLedger({ variantId })).total).toBe(0);
		});
	});

	describe('FIFO cost layers', () => {
		const layer = (variantId: string, unitCostINR: number, quantity: number, ageDays: number) => ({
			id: `${P}layer_${randomUUID()}`,
			variantId,
			purchaseInvoiceId: null,
			unitCostINR,
			quantityReceived: quantity,
			quantityRemaining: quantity,
			receivedAt: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
		});

		it('consumes the oldest layer first and splits across layers', async () => {
			const variantId = `${P}var_fifo_${randomUUID()}`;
			await costLayers.createLayer(layer(variantId, 100, 5, 10));
			await costLayers.createLayer(layer(variantId, 120, 5, 5));

			const allocations = await costLayers.consumeFifo({ variantId, quantity: 7 });

			expect(allocations).toHaveLength(2);
			// Oldest (cheapest here) drains fully before the newer layer is touched.
			expect(allocations[0]).toMatchObject({ quantity: 5, unitCostINR: 100 });
			expect(allocations[1]).toMatchObject({ quantity: 2, unitCostINR: 120 });

			const open = await costLayers.listOpenLayers(variantId);
			expect(open).toHaveLength(1);
			expect(open[0]?.quantityRemaining).toBe(3);
		});

		it('refuses to cost more units than were ever received', async () => {
			const variantId = `${P}var_short_${randomUUID()}`;
			await costLayers.createLayer(layer(variantId, 100, 2, 1));
			// Silently costing the remainder at zero would corrupt margin reporting.
			await expect(costLayers.consumeFifo({ variantId, quantity: 5 })).rejects.toThrow(/uncosted/);
		});

		it('returns released quantity to its own layers', async () => {
			const variantId = `${P}var_release_${randomUUID()}`;
			const first = layer(variantId, 100, 4, 3);
			await costLayers.createLayer(first);

			const allocations = await costLayers.consumeFifo({ variantId, quantity: 3 });
			await costLayers.releaseFifo({
				variantId,
				allocations: allocations.map(({ layerId, quantity }) => ({ layerId, quantity })),
			});

			expect((await costLayers.listOpenLayers(variantId))[0]?.quantityRemaining).toBe(4);
		});

		it('rolls a partial FIFO draw back with its transaction', async () => {
			const variantId = `${P}var_fifo_tx_${randomUUID()}`;
			await costLayers.createLayer(layer(variantId, 100, 5, 2));

			await expect(
				transactions.withTransaction(async (context) => {
					await costLayers.consumeFifo({ variantId, quantity: 4 }, context);
					throw new Error('posting failed');
				}),
			).rejects.toThrow('posting failed');

			expect((await costLayers.listOpenLayers(variantId))[0]?.quantityRemaining).toBe(5);
		});
	});

	describe('media assets', () => {
		const asset = (overrides: Record<string, unknown> = {}) => ({
			id: `${P}media_${randomUUID()}`,
			kind: 'image' as const,
			originalStorageKey: `${P}${randomUUID()}.jpg`,
			originalFormat: 'image/jpeg' as const,
			originalByteSize: 1000,
			width: 100,
			height: 100,
			fullWebpStorageKey: null,
			derivatives: [],
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: { alt: {}, title: {}, caption: {} },
			status: 'live' as const,
			deletedAt: null,
			...overrides,
		});

		it('counts references from every owning surface', async () => {
			const created = asset();
			await media.create(created);
			expect(await media.countReferences(created.id)).toBe(0);

			// A variant pointing at it makes the asset non-orphaned.
			await variants.save({
				id: `${P}var_media_${randomUUID()}`,
				productId: `${P}prod`,
				sku: `${P}${randomUUID().slice(0, 8)}`,
				status: 'live',
				optionSelections: [{ attributeCode: 'design', termCode: 'd1' }],
				optionSelectionHash: `h_${randomUUID()}`,
				isBaseVariant: false,
				priceINR: 100,
				compareAtPriceINR: null,
				salePriceINR: null,
				stock: { tracked: true, quantity: 1, lowStockThreshold: null, allowBackorder: false },
				media: { primaryAssetId: created.id },
			});

			expect(await media.countReferences(created.id)).toBe(1);
		});

		it('hides soft-deleted assets from normal listings but exposes them to the GC sweep', async () => {
			const created = asset();
			await media.create(created);
			await media.softDelete(created.id, new Date(Date.now() - 86_400_000).toISOString());

			const visible = await media.list({ kind: 'image' });
			expect(visible.items.some((item) => item.id === created.id)).toBe(false);

			const orphans = await media.listOrphans({ deletedBefore: now(), limit: 50 });
			expect(orphans.some((item) => item.id === created.id)).toBe(true);
		});

		it('does not collect an asset whose grace period has not elapsed', async () => {
			const created = asset();
			await media.create(created);
			await media.softDelete(created.id, now());

			const cutoff = new Date(Date.now() - 3600_000).toISOString();
			expect(
				(await media.listOrphans({ deletedBefore: cutoff, limit: 50 })).some((i) => i.id === created.id),
			).toBe(false);
		});

		it('refuses to reuse a storage key', async () => {
			const storageKey = `${P}${randomUUID()}.jpg`;
			await media.create(asset({ originalStorageKey: storageKey }));
			await expect(media.create(asset({ originalStorageKey: storageKey }))).rejects.toThrow();
		});

		it('allows many assets with a purged master (null key)', async () => {
			await media.create(asset({ kind: 'video', originalFormat: 'video/mp4', originalStorageKey: null }));
			await expect(
				media.create(asset({ kind: 'video', originalFormat: 'video/mp4', originalStorageKey: null })),
			).resolves.toBeDefined();
		});
	});
});
