import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { OpeningStockCheckResult, OpeningStockRow } from '@saha-textile/contracts';
import {
	type InventoryCostLayerRepository,
	type NumberAllocatorPort,
	type OpeningStockRecord,
	type OpeningStockRepository,
	type StockMovementPort,
	StockMovementRefusedError,
	type StockReadRepository,
	booksClosedProblem,
	classifyOpeningRow,
	describeUnits,
	fiscalYearOf,
	formatDocumentNumber,
	formatRupees,
	roundUnitCost,
} from '@saha-textile/core-domain';

import {
	INVENTORY_COST_LAYER_REPOSITORY,
	NUMBER_ALLOCATOR,
	OPENING_STOCK_REPOSITORY,
	STOCK_MOVEMENT,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, refuse } from './purchasing-support';
import { StockWriter } from './stock-writer';

/**
 * Opening stock (o01): the one-time load of what is already in the shop, with its cost, so value
 * is right from the first day. Once per SKU: an item that has ever had stock or a movement is
 * refused (use an adjustment). Posting stays off until every row is ready.
 */
@Injectable()
export class OpeningStockService {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(OPENING_STOCK_REPOSITORY) private readonly loads: OpeningStockRepository,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY) private readonly layers: InventoryCostLayerRepository,
		@Inject(STOCK_MOVEMENT) private readonly movement: StockMovementPort,
		@Inject(NUMBER_ALLOCATOR) private readonly numbers: NumberAllocatorPort,
		private readonly writer: StockWriter,
		private readonly support: PurchasingSupport,
	) {}

	async check(rows: readonly OpeningStockRow[]): Promise<OpeningStockCheckResult> {
		const skus = [...new Set(rows.map((row) => row.sku.trim()).filter(Boolean))];
		const facts = await this.stock.bySku(skus);
		const moved = await this.stock.withMovements([...facts.values()].map((fact) => fact.variantId));
		const seen = new Map<string, number>();
		for (const row of rows) seen.set(row.sku.trim(), (seen.get(row.sku.trim()) ?? 0) + 1);
		const today = this.support.today();
		const checked = rows.map((row) => {
			const fact = facts.get(row.sku.trim()) ?? null;
			let result = classifyOpeningRow({
				known: Boolean(fact) && fact?.productType !== 'bundle' && fact?.tracked !== false,
				soldBy: fact?.soldBy ?? null,
				quantity: row.quantity,
				unitCostINR: row.unitCostINR,
				hasStockOrMovements: fact ? moved.has(fact.variantId) : false,
				repeated: (seen.get(row.sku.trim()) ?? 0) > 1,
			});
			if (result === 'ready' && row.receivedOn && row.receivedOn > today) result = 'quantity_invalid';
			return {
				...row,
				variantId: fact?.variantId ?? null,
				title: fact ? (fact.title['en'] ?? fact.sku) : null,
				soldBy: fact?.soldBy ?? null,
				result,
			};
		});
		const ready = checked.filter((row) => row.result === 'ready');
		return {
			rows: checked,
			counts: {
				ready: ready.length,
				readyUnits: ready.reduce(
					(sum, row) => sum + (row.soldBy === 'metre' ? Math.round(row.quantity * 10) : row.quantity),
					0,
				),
				costMissing: checked.filter((row) => row.result === 'cost_missing').length,
				unknownSku: checked.filter((row) => row.result === 'unknown_sku').length,
				alreadyHasStock: checked.filter((row) => row.result === 'already_has_stock').length,
				invalid: checked.filter((row) => row.result === 'quantity_invalid' || row.result === 'repeated').length,
			},
		};
	}

	async post(
		rows: readonly OpeningStockRow[],
		requestKey: string,
		actor: string | null,
	): Promise<OpeningStockRecord> {
		const previous = await this.loads.findByRequestKey(requestKey);
		if (previous) return previous;
		const checked = await this.check(rows);
		const notReady = checked.rows.filter((row) => row.result !== 'ready');
		if (notReady.length) {
			throw refuse(
				'rows_not_ready',
				`${notReady.length} row${notReady.length === 1 ? ' is' : 's are'} not ready. Fix or remove them first.`,
			);
		}
		const today = this.support.today();
		const settings = await this.support.settings();
		const dates = checked.rows.map((row) => row.receivedOn ?? today);
		const closed = booksClosedProblem(dates, settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail);
		const facts = await this.stock.bySku(checked.rows.map((row) => row.sku.trim()));
		const fiscalYear = fiscalYearOf(today);
		const now = new Date().toISOString();

		const record = await this.support
			.inTransaction(async (context) => {
				const number = formatDocumentNumber(
					settings.numberFormats.openingStock,
					fiscalYear,
					await this.numbers.next('OS', fiscalYear, context),
				);
				const id = `os_${randomUUID()}`;
				const posted: OpeningStockRecord['rows'] = [];
				for (const row of checked.rows) {
					const fact = facts.get(row.sku.trim());
					if (!fact) throw refuse('unknown_sku', `${row.sku} is not in the catalogue.`, String(row.row));
					const units = fact.soldBy === 'metre' ? Math.round(row.quantity * 10) : row.quantity;
					// Cost is typed per piece or per metre; layers hold it per stock unit.
					const perUnit = roundUnitCost((row.unitCostINR ?? 0) / (fact.soldBy === 'metre' ? 10 : 1));
					const receivedOn = row.receivedOn ?? today;
					const layerId = `lay_${randomUUID()}`;
					await this.layers.createLayer(
						{
							id: layerId,
							variantId: fact.variantId,
							purchaseInvoiceId: null,
							sourceType: 'opening_stock',
							sourceLineId: id,
							sourceNumber: number,
							unitCostINR: perUnit,
							quantityReceived: units,
							quantityRemaining: units,
							receivedAt: new Date(`${receivedOn}T12:00:00+05:30`).toISOString(),
						},
						context,
					);
					await this.movement.move(
						{
							variantId: fact.variantId,
							productId: fact.productId,
							quantityDelta: units,
							heldDelta: 0,
							source: 'opening_stock',
							reasonCode: null,
							note: row.note || null,
							referenceType: 'opening_stock',
							referenceId: id,
							referenceNumber: number,
							actorUserId: actor,
							approverUserId: null,
							at: now,
						},
						context,
					);
					posted.push({
						variantId: fact.variantId,
						productId: fact.productId,
						sku: fact.sku,
						quantity: units,
						unitCostINR: perUnit,
						receivedOn,
						layerId,
						note: row.note,
					});
				}
				const totalValueINR =
					Math.round(posted.reduce((sum, row) => sum + row.quantity * row.unitCostINR * 100, 0)) / 100;
				const load: OpeningStockRecord = {
					id,
					number,
					requestKey,
					postedAt: now,
					postedBy: actor,
					rows: posted,
					totalUnits: posted.reduce((sum, row) => sum + row.quantity, 0),
					totalValueINR,
				};
				await this.loads.save(load, context);
				const units = describeUnits(
					posted.map((row) => ({ units: row.quantity, soldBy: facts.get(row.sku)?.soldBy ?? 'piece' })),
				);
				await this.support.record(
					{
						actor,
						action: 'stock.opening.post',
						entityType: 'opening_stock',
						entityId: id,
						text: `${await this.support.nameOf(actor)} posted opening stock ${number}: ${posted.length} SKUs, ${units}, ${formatRupees(totalValueINR)} at cost.`,
					},
					context,
				);
				return load;
			})
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse('stock_moved_meanwhile', 'Stock changed while posting. Check the rows again.');
				}
				if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
					throw refuse(
						'already_has_stock',
						'Some of these SKUs got opening stock meanwhile. Check the rows again.',
					);
				}
				throw error;
			});
		await this.writer.refreshShop(record.rows.map((row) => row.productId));
		return record;
	}

	list() {
		return this.loads.list();
	}
}
