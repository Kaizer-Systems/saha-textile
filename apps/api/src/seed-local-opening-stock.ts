import 'dotenv/config';
import 'reflect-metadata';

import {
	InventoryCostLayerModel,
	InventoryLedgerModel,
	MongoAdminUserRepository,
	MongoAdminUserRoleAssignmentRepository,
	MongoAuditLogRepository,
	MongoInventoryCostLayerRepository,
	MongoInventorySettingsRepository,
	MongoMediaAssetRepository,
	MongoNumberAllocator,
	MongoOpeningStockRepository,
	MongoRoleRepository,
	MongoSearchOutboxRepository,
	MongoStockHoldRepository,
	MongoStockMovement,
	MongoStockReadRepository,
	MongoTransactionManager,
	ProductModel,
	ProductVariantModel,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import type { OpeningStockRow } from '@saha-textile/contracts';

import { OpeningStockService } from './purchasing/opening-stock.service';
import { PurchasingSupport } from './purchasing/purchasing-support';
import { StockWriter } from './purchasing/stock-writer';

/**
 * LOCAL-ONLY: turns the demo catalogue's typed stock into a documented opening-stock load.
 *
 *   pnpm --filter @saha-textile/api seed:local-opening-stock -- --i-am-local [--cost-pct 55]
 *
 * Stock now moves only through documents (purchases and stock brief, step 7: "reseed with zero
 * stock, then load opening stock"). The demo seeds still type a quantity on each variant, with no
 * ledger row and no cost, which the stock screens cannot explain and opening stock refuses. This
 * script takes every such variant, sets its stock to zero, and posts the same quantity through
 * `OpeningStockService.post`, the call the Opening stock screen makes, so the rows, cost layers,
 * ledger rows, number (OS/…) and audit line are exactly what the screen would write.
 *
 * The cost is DEMO data: a share of the selling price (55% unless `--cost-pct` says otherwise),
 * so margins and stock value read sensibly on a local database. Received dates are each product's
 * creation day, so the ageing report has something to show. Variants that already have stock
 * history or cost layers are left alone, so a second run changes nothing. Excluded from `nest build`.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
if (!args.includes('--i-am-local')) throw new Error('Pass --i-am-local: this writes to the database.');
if (process.env['NODE_ENV'] === 'production') throw new Error('Refused: NODE_ENV=production.');
const mongoHost = (process.env['MONGODB_HOST'] || '127.0.0.1').toLowerCase();
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(mongoHost))
	throw new Error(`Refused: MONGODB_HOST=${mongoHost} is not a loopback host.`);
if (!/_local$/.test(process.env['MONGODB_DB_NAME'] ?? ''))
	throw new Error('Refusing: MONGODB_DB_NAME must end in _local.');
const costPct = Number(flag('--cost-pct') ?? 55);
if (!(costPct > 0 && costPct <= 100)) throw new Error('--cost-pct must be between 1 and 100.');

/** One load per this many rows keeps each posting transaction small. */
const ROWS_PER_LOAD = 400;

interface VariantDoc {
	_id: string;
	productId: string;
	sku: string;
	priceINR: number;
	salePriceINR?: number | null;
	stock?: { tracked?: boolean; quantity?: number; held?: number };
}

async function main() {
	await connectMongo();
	try {
		const variants = await ProductVariantModel.find({
			'stock.quantity': { $gt: 0 },
			'stock.tracked': { $ne: false },
		})
			.lean<VariantDoc[]>()
			.exec();
		const ids = variants.map((row) => row._id);
		const documented = new Set<string>([
			...(await InventoryLedgerModel.distinct('variantId', { variantId: { $in: ids } }).exec()).map(String),
			...(await InventoryCostLayerModel.distinct('variantId', { variantId: { $in: ids } }).exec()).map(String),
		]);
		const typed = variants.filter((row) => !documented.has(row._id));
		if (!typed.length) {
			console.log('Nothing to move: every variant with stock already has stock history.');
			return;
		}
		const products = new Map(
			(
				await ProductModel.find({ _id: { $in: [...new Set(typed.map((row) => row.productId))] } })
					.select({ soldBy: 1, createdAt: 1, type: 1 })
					.lean<Array<{ _id: string; soldBy?: string; createdAt?: Date; type?: string }>>()
					.exec()
			).map((row) => [row._id, row]),
		);
		const today = new Date().toISOString().slice(0, 10);
		const rows: OpeningStockRow[] = typed
			.filter((row) => products.get(row.productId)?.type !== 'bundle')
			.map((row, index) => {
				const product = products.get(row.productId);
				const metre = product?.soldBy === 'metre';
				const units = Math.round(row.stock?.quantity ?? 0);
				const selling = row.salePriceINR ?? row.priceINR;
				const created = product?.createdAt ? new Date(product.createdAt).toISOString().slice(0, 10) : today;
				return {
					row: index + 2,
					sku: row.sku,
					// The sheet takes metres for fabric; the stock itself is tenths.
					quantity: metre ? units / 10 : units,
					unitCostINR: Math.round(selling * costPct) / 100,
					receivedOn: created > today ? today : created,
					note: 'Demo opening stock (local seed)',
				};
			});

		// The typed numbers go to zero first, so the load is the only stock; a row the check refuses
		// gets its typed number back below, so nothing is lost.
		const moving = typed.filter((row) => products.get(row.productId)?.type !== 'bundle');
		await ProductVariantModel.updateMany(
			{ _id: { $in: moving.map((row) => row._id) } },
			{ $set: { 'stock.quantity': 0, 'stock.held': 0 } },
		).exec();
		const typedBySku = new Map(moving.map((row) => [row.sku, row]));

		const read = new MongoStockReadRepository();
		const movement = new MongoStockMovement();
		const layers = new MongoInventoryCostLayerRepository();
		const support = new PurchasingSupport(
			new MongoInventorySettingsRepository(),
			new MongoAdminUserRepository(),
			new MongoAuditLogRepository(),
			new MongoMediaAssetRepository(),
			// Opening stock reads no pictures, so no storage is wired here.
			undefined as never,
			new MongoTransactionManager(),
			new MongoRoleRepository(),
			new MongoAdminUserRoleAssignmentRepository(),
		);
		const writer = new StockWriter(
			read,
			movement,
			layers,
			new MongoStockHoldRepository(),
			new MongoSearchOutboxRepository(),
		);
		const opening = new OpeningStockService(
			read,
			new MongoOpeningStockRepository(),
			layers,
			movement,
			new MongoNumberAllocator(),
			writer,
			support,
		);
		for (let start = 0; start < rows.length; start += ROWS_PER_LOAD) {
			const batch = rows.slice(start, start + ROWS_PER_LOAD);
			const checked = await opening.check(batch);
			const notReady = checked.rows.filter((row) => row.result !== 'ready');
			for (const row of notReady) {
				const variant = typedBySku.get(row.sku);
				if (variant) {
					await ProductVariantModel.updateOne(
						{ _id: variant._id },
						{
							$set: {
								'stock.quantity': variant.stock?.quantity ?? 0,
								'stock.held': variant.stock?.held ?? 0,
							},
						},
					).exec();
				}
			}
			if (notReady.length) {
				console.log(
					`Skipped ${notReady.length} rows: ${notReady
						.slice(0, 5)
						.map((row) => `${row.sku} (${row.result})`)
						.join(', ')}`,
				);
			}
			const ready = batch.filter((row) => checked.rows.some((c) => c.row === row.row && c.result === 'ready'));
			if (!ready.length) continue;
			const load = await opening.post(ready, `seed-opening-${today}-${start}`, null);
			console.log(
				`Posted ${load.number}: ${load.rows.length} SKUs, ${load.totalUnits} units, ₹${load.totalValueINR}.`,
			);
		}
	} finally {
		await disconnectMongo();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
