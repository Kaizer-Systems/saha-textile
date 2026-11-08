import { randomUUID } from 'node:crypto';

import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
	Optional,
} from '@nestjs/common';
import type { AuditLog, Product, SaleRecord, ShopEvent } from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type OrderRepository,
	type ProductRepository,
	type ShopEventRepository,
	dueTransition,
	nextBoundary,
} from '@saha-textile/core-domain';

import { CatalogService } from '../catalog/catalog.service';
import { ProductBuilderService } from '../catalog/product-builder.service';
import {
	AUDIT_LOG_REPOSITORY,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	SALE_PRICE_BOOK,
	SHOP_EVENT_REPOSITORY,
} from '../infra/tokens';
import { EventCatalog } from './event-catalog';
import type { SalePriceBook } from './sale-price-book';

/** The catch-up sweep: a server that was down acts within a minute of coming back. */
export const EVENT_SWEEP_MS = 60_000;

/**
 * Starts and ends events on time.
 *
 * Every minute it looks for events whose moment has come, and between sweeps it sets a timer
 * for the very next start or end, so the shop changes on the second. Each step is a single
 * conditional write (`scheduled → live`, `live → ended`), so when two servers wake for the same
 * moment only one runs it. Sale prices themselves follow the clock in `SalePriceBook`; this only
 * does what has to happen once: launch items going live, search and listings re-read, the record.
 */
@Injectable()
export class EventClock implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('EventClock');
	private sweepTimer: NodeJS.Timeout | null = null;
	private nextTimer: NodeJS.Timeout | null = null;
	private running: Promise<void> | null = null;

	constructor(
		@Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository,
		@Inject(SALE_PRICE_BOOK) private readonly book: SalePriceBook,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly catalog: EventCatalog,
		private readonly builder: ProductBuilderService,
		private readonly catalogService: CatalogService,
		@Optional() @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository | null = null,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.book.start();
		this.sweepTimer = setInterval(() => void this.sweep(), EVENT_SWEEP_MS);
		this.sweepTimer.unref();
		void this.sweep();
	}

	onApplicationShutdown(): void {
		this.book.stop();
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		if (this.nextTimer) clearTimeout(this.nextTimer);
	}

	/** After an admin change: re-read the sale prices and re-aim the next timer. */
	async poke(): Promise<void> {
		await this.book.refresh();
		await this.sweep();
	}

	/** One pass. Overlapping calls share the pass already running. */
	sweep(now = new Date()): Promise<void> {
		this.running ??= this.pass(now).finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private async pass(now: Date): Promise<void> {
		try {
			const published = await this.events.listPublished();
			for (const event of published) {
				const due = dueTransition(event, now);
				if (due === 'start') await this.start(event, now);
				else if (due === 'end') await this.end(event, now);
			}
			this.aim(await this.events.listPublished());
		} catch (error) {
			this.logger.error(`Event sweep failed: ${error instanceof Error ? error.message : 'unknown'}`);
		}
	}

	/** A timer for the next boundary when it falls before the next sweep. */
	private aim(published: readonly ShopEvent[]): void {
		if (this.nextTimer) clearTimeout(this.nextTimer);
		this.nextTimer = null;
		const next = published
			.map((event) => nextBoundary(event))
			.filter((at): at is string => !!at)
			.map((at) => Date.parse(at))
			.sort((a, b) => a - b)[0];
		if (next === undefined) return;
		const wait = next - Date.now();
		if (wait > EVENT_SWEEP_MS) return;
		this.nextTimer = setTimeout(() => void this.sweep(), Math.max(0, wait) + 50);
		this.nextTimer.unref();
	}

	async start(event: ShopEvent, now = new Date()): Promise<void> {
		const won = await this.events.transition(event.id, 'scheduled', { status: 'live', startedAt: now.toISOString() });
		if (!won) return;
		if (won.type === 'launch') {
			const report = await this.runLaunch(won);
			await this.events.save({ ...won, launchReport: report });
			await this.record('event.launch.start', won.id, {
				live: report.liveProductIds.length,
				failed: report.failed.length,
				skipped: report.skippedProductIds.length,
			});
		} else {
			await this.book.refresh();
			await this.reindex(this.book.productsIn(won.id));
			await this.record('event.sale.start', won.id, { products: this.book.productsIn(won.id).length });
		}
	}

	/** Each item checked again; one edited since Publish that now fails stays draft and is listed. */
	private async runLaunch(event: ShopEvent) {
		const report = {
			liveProductIds: [] as string[],
			liveCategoryIds: [] as string[],
			skippedProductIds: [] as string[],
			failed: [] as { productId: string; gaps: { field: string; locale: string | null }[] }[],
		};
		report.liveCategoryIds = await this.catalog.liveCategories(event.launch.categoryIds);
		for (const productId of [...event.launch.productIds, ...(await this.draftsInCategories(event))]) {
			if (report.liveProductIds.includes(productId) || report.skippedProductIds.includes(productId)) continue;
			const product = await this.products.findById(productId, 'admin');
			if (!product || product.status === 'discontinued') continue;
			if (product.status === 'live') {
				report.skippedProductIds.push(productId);
				continue;
			}
			try {
				const result = await this.builder.goLive(productId, null);
				if (result.live) report.liveProductIds.push(productId);
				else report.failed.push({ productId, gaps: result.gaps });
			} catch (error) {
				report.failed.push({ productId, gaps: [{ field: 'error', locale: null }] });
				this.logger.warn(`Launch item ${productId} failed: ${error instanceof Error ? error.message : 'unknown'}`);
			}
		}
		return report;
	}

	private async draftsInCategories(event: ShopEvent): Promise<string[]> {
		const held = new Set(event.launch.heldProductIds);
		return (await this.catalog.inCategories(event.launch.categoryIds))
			.filter((product) => !held.has(product.id))
			.map((product) => product.id);
	}

	/** A running sale ends: prices go back by themselves; the record keeps what it sold. */
	async end(event: ShopEvent, now = new Date(), from: 'live' | 'scheduled' = 'live', cancelled = false): Promise<void> {
		const productIds = this.book.productsIn(event.id);
		const record = cancelled ? null : await this.saleRecord(event, now);
		const won = await this.events.transition(
			event.id,
			from,
			cancelled
				? { status: 'cancelled', cancelledAt: now.toISOString() }
				: {
						status: 'ended',
						endedAt: now.toISOString(),
						saleRecord: record,
						// The record keeps every SKU's prices; the working rules are not needed again.
						sale: { categories: [], products: [] },
					},
		);
		if (!won) return;
		await this.book.refresh();
		await this.reindex(productIds);
		await this.record(cancelled ? 'event.sale.cancel' : 'event.sale.end', won.id, { products: productIds.length });
	}

	/** Each SKU's normal and sale price, and what the sale's window sold, from paid orders. */
	private async saleRecord(event: ShopEvent, now: Date): Promise<SaleRecord> {
		const prices = await this.catalog.salePrices(event);
		const sold =
			this.orders && event.startsAt
				? await this.orders.listPaidLinesBetween(
						event.startsAt,
						now.toISOString(),
						prices.map((row) => row.productId),
					)
				: [];
		const rows = prices
			.filter((row) => row.saleINR !== null)
			.map((row) => {
				const lines = sold.filter((line) => line.sku === row.sku && line.productId === row.productId);
				const unitsSold = lines.reduce((sum, line) => sum + line.quantity, 0);
				const revenueINR = lines.reduce((sum, line) => sum + line.unitPriceINR * line.quantity, 0);
				return {
					productId: row.productId,
					sku: row.sku,
					normalINR: row.normalINR,
					saleINR: row.saleINR as number,
					unitsSold,
					revenueINR: Math.round(revenueINR),
					discountINR: Math.max(0, Math.round(row.normalINR * unitsSold - revenueINR)),
				};
			});
		return {
			rows,
			orders: new Set(sold.map((line) => line.orderId)).size,
			unitsSold: rows.reduce((sum, row) => sum + row.unitsSold, 0),
			revenueINR: rows.reduce((sum, row) => sum + row.revenueINR, 0),
			discountINR: rows.reduce((sum, row) => sum + row.discountINR, 0),
		};
	}

	/** Search, price filters and sorting read the new prices. */
	async reindex(productIds: readonly string[]): Promise<void> {
		if (!productIds.length) return;
		const found = await Promise.all(productIds.map((id) => this.products.findById(id, 'admin')));
		await this.catalogService.syncSearchMany(found.filter((product): product is Product => !!product));
	}

	private async record(action: string, entityId: string, metadata: Record<string, unknown>) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: null,
			targetUserId: null,
			audience: 'system',
			action,
			entityType: 'shop_event',
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
