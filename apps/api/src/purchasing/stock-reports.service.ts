import { Inject, Injectable } from '@nestjs/common';
import {
	GST_STATES,
	type MovementReportQuery,
	type PurchaseOrder,
	type PurchaseRegisterRow,
	type ReorderRow,
} from '@saha-textile/contracts';
import {
	AGEING_BANDS,
	type ExpenseBillRepository,
	type PurchaseEntryRepository,
	REORDER_LOOKBACK_DAYS,
	type StockItemFacts,
	type StockLayerRow,
	type StockReadRepository,
	addDays,
	ageingBandOf,
	daysBetween,
	entryOutstanding,
	reorderSuggestion,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { EXPENSE_BILL_REPOSITORY, PURCHASE_ENTRY_REPOSITORY, STOCK_READ_REPOSITORY } from '../infra/tokens';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchasingSupport, actorOf, canSeeCost, refuse } from './purchasing-support';

const MS_DAY = 86_400_000;
/** The widest list a report reads in one go; past it the report says it is partial. */
const REPORT_SCOPE = 20_000;

const endOfIndianDay = (day: string): string => new Date(Date.parse(`${day}T23:59:59.999+05:30`)).toISOString();

/**
 * What the pieces on hand came in as, newest first: FIFO sends the oldest out first, so on-hand
 * units are the newest layers (the same rule stock value uses). Returns each piece's age band.
 */
function onHandLayers(
	layers: readonly StockLayerRow[],
	onHand: number,
): Array<{ layer: StockLayerRow; units: number }> {
	const newest = [...layers]
		.filter((layer) => layer.quantityRemaining > 0)
		.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
	let left = Math.max(0, onHand);
	const out: Array<{ layer: StockLayerRow; units: number }> = [];
	for (const layer of newest) {
		if (left <= 0) break;
		const units = Math.min(left, layer.quantityRemaining);
		out.push({ layer, units });
		left -= units;
	}
	return out;
}

/** Reorder list (i07), ageing (i08), value on a date (i09), purchase register (i10), movements, unpaid bills. */
@Injectable()
export class StockReportsService {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		private readonly orders: PurchaseOrdersService,
		private readonly support: PurchasingSupport,
		@Inject(EXPENSE_BILL_REPOSITORY) private readonly expenseBills: Pick<ExpenseBillRepository, 'list'>,
	) {}

	private async everything(): Promise<StockItemFacts[]> {
		const page = await this.stock.list({
			filter: 'all',
			page: 1,
			pageSize: REPORT_SCOPE,
			olderThan: new Date().toISOString(),
		});
		return page.items.filter((fact) => fact.tracked);
	}

	/** i07: at or under the low level, or out within 14 days at the last 60 days' pace. */
	async reorder(principal: AuthenticatedPrincipal | undefined): Promise<{ items: ReorderRow[] }> {
		const facts = await this.everything();
		const sold = await this.stock.soldSince(
			null,
			new Date(Date.now() - REORDER_LOOKBACK_DAYS * MS_DAY).toISOString(),
		);
		const listed = facts
			.filter((fact) => !fact.madeToOrder && fact.productStatus !== 'discontinued')
			.map((fact) => ({
				fact,
				verdict: reorderSuggestion({
					free: fact.onHand - fact.held,
					lowLevel: fact.lowStockLevel,
					soldLast60: sold.get(fact.variantId) ?? 0,
					soldBy: fact.soldBy,
				}),
			}))
			.filter((row) => row.verdict.listed);
		const ids = listed.map((row) => row.fact.variantId);
		const [last, images] = await Promise.all([
			this.entries.lastPurchases(ids, null),
			this.support.thumbnails(listed.map((row) => row.fact.galleryAssetId)),
		]);
		const seeCost = canSeeCost(principal);
		const items = listed
			.map(({ fact, verdict }) => {
				const bought = last.get(fact.variantId);
				return {
					variantId: fact.variantId,
					productId: fact.productId,
					sku: fact.sku,
					title: fact.title['en'] ?? fact.sku,
					optionsLabel: fact.optionsLabel,
					imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
					soldBy: fact.soldBy,
					freeToSell: fact.onHand - fact.held,
					soldLast60Days: sold.get(fact.variantId) ?? 0,
					daysLeft: verdict.daysLeft,
					lastSupplierId: bought?.supplierId ?? null,
					lastSupplierName: bought?.supplierName ?? null,
					lastCostINR: seeCost ? (bought?.unitPriceExGstINR ?? null) : null,
					suggested: verdict.suggested,
				};
			})
			.sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1) || a.freeToSell - b.freeToSell);
		return { items };
	}

	/** i07 → po02: ticked lines become one draft order per supplier (the last one, or one chosen). */
	async reorderToOrders(
		lines: ReadonlyArray<{ variantId: string; quantity: number; supplierId?: string }>,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<PurchaseOrder[]> {
		const last = await this.entries.lastPurchases(
			lines.map((line) => line.variantId),
			null,
		);
		const groups = new Map<
			string,
			Array<{
				variantId: string;
				quantity: number;
				agreedPriceINR: number;
				gstRatePct: number;
				supplierItemCode: string | null;
				backorderLineIds: string[];
			}>
		>();
		for (const line of lines) {
			const supplierId = line.supplierId ?? last.get(line.variantId)?.supplierId;
			if (!supplierId)
				throw refuse('supplier_required', 'Pick a supplier for items never bought before.', line.variantId);
			const group = groups.get(supplierId) ?? [];
			group.push({
				variantId: line.variantId,
				quantity: line.quantity,
				agreedPriceINR: last.get(line.variantId)?.unitPriceExGstINR ?? 0,
				gstRatePct: 5,
				supplierItemCode: null,
				backorderLineIds: [],
			});
			groups.set(supplierId, group);
		}
		return this.orders.draftsFromReorder(
			[...groups.entries()].map(([supplierId, groupLines]) => ({ supplierId, lines: groupLines })),
			actorOf(principal),
		);
	}

	/** i08: value in four age bands by the day each piece was received, with what to do per row. */
	async ageing(
		query: { band?: number; page: number; pageSize: number },
		principal: AuthenticatedPrincipal | undefined,
	) {
		const seeCost = canSeeCost(principal);
		const today = this.support.today();
		const facts = (await this.everything()).filter((fact) => fact.onHand > 0);
		const layers = await this.stock.openLayers(facts.map((fact) => fact.variantId));
		const byVariant = new Map<string, StockLayerRow[]>();
		for (const layer of layers) byVariant.set(layer.variantId, [...(byVariant.get(layer.variantId) ?? []), layer]);
		const bands = AGEING_BANDS.map((band) => ({ ...band, valuePaise: 0, units: 0 }));
		const rows = facts.map((fact) => {
			const parts = onHandLayers(byVariant.get(fact.variantId) ?? [], fact.onHand);
			let valuePaise = 0;
			let oldest = 0;
			for (const { layer, units } of parts) {
				const days = Math.max(0, daysBetween(layer.receivedAt.slice(0, 10), today));
				// A day count of 0 or more always falls in a band (the last one has no end).
				const band = bands[ageingBandOf(days)] as (typeof bands)[number];
				const paise = Math.round(units * layer.unitCostINR * 100);
				band.units += units;
				band.valuePaise += paise;
				valuePaise += paise;
				oldest = Math.max(oldest, days);
			}
			return {
				fact,
				oldest,
				valuePaise,
				canReturn: parts.some(
					({ layer }) => layer.sourceType === 'purchase_invoice' && layer.purchaseInvoiceId,
				),
			};
		});
		const filtered = rows
			.filter((row) => query.band === undefined || ageingBandOf(row.oldest) === query.band)
			.sort((a, b) => b.oldest - a.oldest || b.valuePaise - a.valuePaise);
		const pageRows = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
		const [lastSold, images] = await Promise.all([
			this.stock.lastSoldOn(pageRows.map((row) => row.fact.variantId)),
			this.support.thumbnails(pageRows.map((row) => row.fact.galleryAssetId)),
		]);
		return {
			bands: bands.map((band) => ({
				label: band.label,
				fromDays: band.fromDays,
				toDays: band.toDays,
				valueINR: seeCost ? band.valuePaise / 100 : null,
				units: band.units,
			})),
			rows: pageRows.map((row) => ({
				variantId: row.fact.variantId,
				productId: row.fact.productId,
				sku: row.fact.sku,
				title: row.fact.title['en'] ?? row.fact.sku,
				optionsLabel: row.fact.optionsLabel,
				imageUrl: row.fact.galleryAssetId ? (images.get(row.fact.galleryAssetId) ?? null) : null,
				soldBy: row.fact.soldBy,
				onHand: row.fact.onHand,
				oldestPieceDays: row.oldest,
				lastSoldOn: lastSold.get(row.fact.variantId) ?? null,
				valueAtCostINR: seeCost ? row.valuePaise / 100 : null,
				canReturnToSupplier: row.canReturn,
			})),
			total: filtered.length,
		};
	}

	/** i09: value at cost on any day, from history and the layers as they stood, so a closed year never changes. */
	async valuation(asOn: string, groupBy: 'category' | 'supplier' | 'product') {
		const today = this.support.today();
		if (asOn > today) throw refuse('date_in_future', 'Pick today or an earlier day.', 'asOn');
		const rows = (await this.stock.valuationAsOf(endOfIndianDay(asOn))).filter((row) => row.units > 0);
		const facts = await this.stock.items(rows.map((row) => row.variantId));
		const last =
			groupBy === 'supplier'
				? await this.entries.lastPurchases(
						rows.map((row) => row.variantId),
						null,
					)
				: new Map();
		const groups = new Map<string, { units: number; valuePaise: number; sellingPaise: number }>();
		for (const row of rows) {
			const fact = facts.get(row.variantId);
			const label =
				groupBy === 'category'
					? (fact?.categoryName ?? 'No category')
					: groupBy === 'supplier'
						? (last.get(row.variantId)?.supplierName ?? 'Opening stock or no supplier')
						: `${fact?.title['en'] ?? row.variantId}${fact?.optionsLabel ? `, ${fact.optionsLabel}` : ''}`;
			const group = groups.get(label) ?? { units: 0, valuePaise: 0, sellingPaise: 0 };
			group.units += row.units;
			group.valuePaise += Math.round(row.valueINR * 100);
			const priced = fact?.soldBy === 'metre' ? row.units / 10 : row.units;
			group.sellingPaise += Math.round(priced * (fact?.sellingPriceINR ?? 0) * 100);
			groups.set(label, group);
		}
		const totalPaise = [...groups.values()].reduce((sum, group) => sum + group.valuePaise, 0);
		return {
			asOn,
			groupBy,
			rows: [...groups.entries()]
				.map(([label, group]) => ({
					label,
					units: group.units,
					valueAtCostINR: group.valuePaise / 100,
					sellingValueINR: group.sellingPaise / 100,
					sharePct: totalPaise ? Math.round((group.valuePaise / totalPaise) * 1000) / 10 : 0,
				}))
				.sort((a, b) => b.valueAtCostINR - a.valueAtCostINR),
			totalUnits: rows.reduce((sum, row) => sum + row.units, 0),
			totalValueINR: totalPaise / 100,
			uncostedUnits: rows.reduce((sum, row) => sum + row.uncostedUnits, 0),
		};
	}

	/** i10: posted bills between two days, in the columns the CA asked for on 21 Aug 2026. */
	async purchaseRegister(from: string, to: string): Promise<{ rows: PurchaseRegisterRow[] }> {
		if (from > to) throw refuse('dates_reversed', 'The start day is after the end day.', 'from');
		const homeCode = await this.support.homeState();
		const home = GST_STATES.find((state) => state.code === homeCode);
		const entries = await this.entries.postedBetween(from, to);
		return {
			rows: entries.map((entry) => ({
				billDate: entry.billDate,
				supplierName: entry.supplierName,
				gstin: entry.supplierGstin,
				billNumber: entry.billNumber,
				placeOfSupply: `${homeCode}-${home?.name ?? ''}`,
				taxableINR: entry.totals.taxableINR,
				cgstINR: entry.totals.cgstINR,
				sgstINR: entry.totals.sgstINR,
				igstINR: entry.totals.igstINR,
				totalINR: entry.totals.totalINR,
				entryNumber: entry.number ?? '',
				// Reverse charge on purchases waits on the CA (round 2, D6).
				reverseCharge: false,
			})),
		};
	}

	/** Every stock movement, filtered: the movements report. */
	async movements(query: MovementReportQuery) {
		let variantId: string | undefined;
		if (query.q) {
			const found = await this.stock.search(query.q, 2);
			if (found.length === 0) return { items: [], total: 0 };
			variantId = found[0]?.variantId;
		}
		const ledger = await this.stock.ledger({
			variantId,
			source: query.source,
			actorId: query.actorId,
			from: query.from ? new Date(`${query.from}T00:00:00+05:30`).toISOString() : undefined,
			to: query.to ? endOfIndianDay(query.to) : undefined,
			page: query.page,
			pageSize: query.pageSize,
		});
		const [facts, names] = await Promise.all([
			this.stock.items([...new Set(ledger.items.map((row) => row.variantId))]),
			this.support.names(ledger.items.flatMap((row) => [row.actorUserId, row.approverUserId])),
		]);
		return {
			items: ledger.items.map((row) => ({
				...row,
				sku: facts.get(row.variantId)?.sku ?? row.variantId,
				title: facts.get(row.variantId)?.title['en'] ?? '',
				soldBy: facts.get(row.variantId)?.soldBy ?? 'piece',
				actorName: row.actorUserId ? (names.get(row.actorUserId) ?? 'Someone') : null,
				approverName: row.approverUserId ? (names.get(row.approverUserId) ?? 'Someone') : null,
			})),
			total: ledger.total,
		};
	}

	/**
	 * Unpaid bills, oldest first, with how close each is to the 180-day input-credit rule: purchase entries and posted
	 * expense bills (brief 25 EB2), each saying which it is.
	 */
	async unpaidBills() {
		const settings = await this.support.settings();
		const today = this.support.today();
		const nearLimit = (billDate: string) => billDate <= addDays(today, -settings.unpaidAlertDays);
		const open = (await this.entries.openPayables()).filter((entry) => entryOutstanding(entry) > 0.005);
		const expense = (await this.expenseBills.list({ status: 'posted' })).filter(
			(bill) => bill.totalINR - bill.paidINR > 0.005,
		);
		return {
			alertDays: settings.unpaidAlertDays,
			rows: [
				...open.map((entry) => ({
					kind: 'purchaseEntry' as const,
					id: entry.id,
					number: entry.number,
					supplierId: entry.supplierId,
					supplierName: entry.supplierName,
					billNumber: entry.billNumber,
					billDate: entry.billDate,
					dueOn: entry.dueOn,
					totalINR: entry.totals.totalINR,
					leftINR: entryOutstanding(entry),
					days: daysBetween(entry.billDate, today),
					nearLimit: nearLimit(entry.billDate),
				})),
				...expense.map((bill) => ({
					kind: 'expenseBill' as const,
					id: bill.id,
					number: bill.number,
					supplierId: bill.supplierId,
					supplierName: bill.supplierName,
					billNumber: bill.billNumber,
					billDate: bill.billDate,
					dueOn: bill.billDate,
					totalINR: bill.totalINR,
					leftINR: Math.round((bill.totalINR - bill.paidINR) * 100) / 100,
					days: daysBetween(bill.billDate, today),
					nearLimit: nearLimit(bill.billDate),
				})),
			].sort((a, b) => b.days - a.days),
		};
	}
}
