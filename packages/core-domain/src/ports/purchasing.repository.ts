import type {
	AdjustmentRequest,
	InventorySettings,
	ShopDetails,
	PurchaseEntry,
	PurchaseOrder,
	PurchaseReturn,
	StockCount,
	Supplier,
	SupplierPayment,
	LocationStock,
} from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/**
 * Purchases and stock persistence. Each aggregate (supplier, order, entry, return, count…) is
 * stored whole, with its lines inside, and carries a `version`: a save names the version it read
 * and is refused when someone else saved in between (two people on one draft). Writes take an
 * optional transaction, because posting an entry writes the entry, stock, ledger rows, cost
 * layers, the order's received quantities and the number counter as one unit.
 */

/** Raised by a save whose expected version is no longer current. */
export class StaleVersionError extends Error {
	constructor(
		readonly entity: string,
		readonly id: string,
		readonly current: { version: number; updatedAt: string; updatedBy: string | null },
	) {
		super(`${entity} ${id} was changed by someone else`);
		this.name = 'StaleVersionError';
	}
}

/**
 * Raised when a stock movement would leave held above on-hand or held below zero, or a cost
 * layer no longer holds what was asked of it: someone else moved the stock meanwhile.
 */
export class StockMovementRefusedError extends Error {
	constructor(readonly variantId: string) {
		super(`stock movement refused for ${variantId}`);
		this.name = 'StockMovementRefusedError';
	}
}

export interface ListPage<T> {
	items: T[];
	total: number;
}

export interface SupplierListFilter {
	q?: string;
	filter: 'all' | 'owed' | 'inactive';
	page: number;
	pageSize: number;
}

export interface SupplierRepository {
	findById(id: string, context?: TransactionContext): Promise<Supplier | null>;
	findByGstin(gstin: string): Promise<Supplier | null>;
	findByPan(pan: string): Promise<Supplier[]>;
	list(filter: SupplierListFilter, owedBySupplier: ReadonlyMap<string, number>): Promise<ListPage<Supplier>>;
	/** Suppliers with any purchase entry (posted or draft): they cannot be deleted. */
	hasDocuments(id: string): Promise<boolean>;
	save(supplier: Supplier, context?: TransactionContext): Promise<void>;
	/** Soft delete: the record stays for history and audit, hidden from lists and pickers. */
	softDelete(id: string, actorId: string | null, at: string): Promise<void>;
	countActive(): Promise<{ all: number; inactive: number }>;
}

export interface SupplierItemCodeRepository {
	findVariant(supplierId: string, code: string): Promise<string | null>;
	codesFor(supplierId: string, variantIds: readonly string[]): Promise<Map<string, string>>;
	remember(supplierId: string, code: string, variantId: string, context?: TransactionContext): Promise<void>;
}

export interface DocumentListFilter {
	q?: string;
	filter: string;
	supplierId?: string;
	from?: string;
	to?: string;
	page: number;
	pageSize: number;
	today: string;
}

export interface PurchaseOrderRepository {
	findById(id: string, context?: TransactionContext): Promise<PurchaseOrder | null>;
	list(filter: DocumentListFilter): Promise<ListPage<PurchaseOrder> & { counts: Record<string, number> }>;
	/** Insert (version 1) or update when `expectedVersion` matches; returns the saved version. */
	save(order: PurchaseOrder, expectedVersion: number | null, context?: TransactionContext): Promise<number>;
	remove(id: string): Promise<void>;
	openForSupplier(supplierId: string): Promise<PurchaseOrder[]>;
}

export interface LastPurchaseFact {
	variantId: string;
	unitPriceExGstINR: number;
	entryNumber: string | null;
	supplierId: string;
	supplierName: string;
	billDate: string;
}

export interface PurchaseEntryRepository {
	findById(id: string, context?: TransactionContext): Promise<PurchaseEntry | null>;
	list(filter: DocumentListFilter): Promise<ListPage<PurchaseEntry> & { counts: Record<string, number> }>;
	save(entry: PurchaseEntry, expectedVersion: number | null, context?: TransactionContext): Promise<number>;
	remove(id: string): Promise<void>;
	/** A non-void entry from the supplier with the same (normalized) bill number. */
	findByBill(
		supplierId: string,
		normalizedBillNumber: string,
		excludeId: string | null,
	): Promise<PurchaseEntry | null>;
	/** Same supplier, same total and bill date, another number: a softer warning. */
	findLookalike(
		supplierId: string,
		billDate: string,
		totalINR: number,
		excludeId: string | null,
	): Promise<PurchaseEntry | null>;
	/** The latest posted price per variant (before GST, per piece or metre). */
	lastPurchases(variantIds: readonly string[], excludeEntryId: string | null): Promise<Map<string, LastPurchaseFact>>;
	/** Posted, unpaid or part-paid entries (owed money, due dates, statements). */
	openPayables(supplierId?: string): Promise<PurchaseEntry[]>;
	postedBetween(from: string, to: string): Promise<PurchaseEntry[]>;
	forSupplier(supplierId: string): Promise<PurchaseEntry[]>;
	/** Records a request key so a repeated post never posts twice (idempotency). */
	claimRequestKey(key: string, entryId: string, context?: TransactionContext): Promise<'claimed' | 'seen'>;
}

export interface SupplierPaymentRepository {
	forEntry(entryId: string): Promise<SupplierPayment[]>;
	forSupplier(supplierId: string): Promise<SupplierPayment[]>;
	save(payment: SupplierPayment, context?: TransactionContext): Promise<void>;
	findById(id: string): Promise<SupplierPayment | null>;
}

export interface PurchaseReturnRepository {
	findById(id: string, context?: TransactionContext): Promise<PurchaseReturn | null>;
	list(filter: DocumentListFilter): Promise<ListPage<PurchaseReturn> & { counts: Record<string, number> }>;
	save(doc: PurchaseReturn, expectedVersion: number | null, context?: TransactionContext): Promise<number>;
	remove(id: string): Promise<void>;
	forEntry(entryId: string): Promise<PurchaseReturn[]>;
	forSupplier(supplierId: string): Promise<PurchaseReturn[]>;
	/** Records the send request key so a repeated Send never sends twice (idempotency). */
	claimSendKey(key: string, returnId: string, context?: TransactionContext): Promise<'claimed' | 'seen'>;
}

export interface StockHoldRecord {
	id: string;
	variantId: string;
	productId: string;
	quantity: number;
	reason: 'waiting_for_supplier' | 'photoshoot' | 'store_display' | 'quality_check' | 'damaged';
	note: string;
	since: string;
	byId: string | null;
	status: 'open' | 'released' | 'written_off' | 'returned';
	closedAt: string | null;
	closedBy: string | null;
	/** The purchase entry the held pieces came from, when known (returns to supplier). */
	entryId: string | null;
}

export interface StockHoldRepository {
	findById(id: string, context?: TransactionContext): Promise<StockHoldRecord | null>;
	open(filter: {
		reason?: string;
		q?: string;
		variantIds?: readonly string[];
		page: number;
		pageSize: number;
	}): Promise<ListPage<StockHoldRecord> & { counts: Record<string, number> }>;
	openForVariant(variantId: string): Promise<StockHoldRecord[]>;
	save(hold: StockHoldRecord, context?: TransactionContext): Promise<void>;
}

export interface AdjustmentRequestRepository {
	findById(id: string, context?: TransactionContext): Promise<AdjustmentRequest | null>;
	list(filter: {
		status: 'pending' | 'approved' | 'rejected';
		q?: string;
		page: number;
		pageSize: number;
	}): Promise<ListPage<AdjustmentRequest>>;
	pendingCount(): Promise<number>;
	/** A change already made with this request key (a repeated press of the same button). */
	findByRequestKey(key: string): Promise<AdjustmentRequest | null>;
	save(request: AdjustmentRequest, requestKey: string | null, context?: TransactionContext): Promise<void>;
	/** Decisions on a requester's own requests they have not opened yet (the bell, i05b). */
	unseenDecisions(requesterId: string): Promise<AdjustmentRequest[]>;
	markSeen(requesterId: string, ids: readonly string[]): Promise<void>;
}

export interface StockCountRepository {
	findById(id: string, context?: TransactionContext): Promise<StockCount | null>;
	list(filter: {
		filter: string;
		page: number;
		pageSize: number;
	}): Promise<ListPage<StockCount> & { counts: Record<string, number> }>;
	save(count: StockCount, expectedVersion: number | null, context?: TransactionContext): Promise<number>;
	/** Variants whose last posted count had a difference ("items that differed last time"). */
	lastDifferences(): Promise<string[]>;
}

/** One posted opening-stock load (o01): every row with its cost, kept for audit. */
export interface OpeningStockRecord {
	id: string;
	number: string;
	requestKey: string;
	postedAt: string;
	postedBy: string | null;
	rows: Array<{
		variantId: string;
		productId: string;
		sku: string;
		quantity: number;
		unitCostINR: number;
		receivedOn: string;
		layerId: string;
		note: string;
	}>;
	totalUnits: number;
	totalValueINR: number;
}

export interface OpeningStockRepository {
	findByRequestKey(key: string): Promise<OpeningStockRecord | null>;
	save(record: OpeningStockRecord, context?: TransactionContext): Promise<void>;
	list(): Promise<OpeningStockRecord[]>;
}

/** Document numbers: one counter per series and financial year, allocated in a transaction. */
export interface NumberAllocatorPort {
	next(series: string, fiscalYear: string, context?: TransactionContext): Promise<number>;
	/** The number the next document would get, without taking it (the post confirmation, p09). */
	peek(series: string, fiscalYear: string): Promise<number>;
}

export interface InventorySettingsRepository {
	get(): Promise<InventorySettings>;
	save(settings: InventorySettings): Promise<void>;
}

/**
 * Settings › Shop details (R3-1): one record for the shop. `get` is null until the first save.
 * `save` writes only over the copy the editor read (`expectedUpdatedAt`, null for the first save)
 * and throws `StaleVersionError` naming the newer copy otherwise.
 */
export interface ShopDetailsRepository {
	get(): Promise<ShopDetails | null>;
	save(details: ShopDetails, expectedUpdatedAt: string | null): Promise<void>;
}

/**
 * Stock movements beyond the plain ledger: held pieces, cost layers drawn from a named layer
 * (a return goes back at its own entry's cost) and FIFO, and the read sides the screens need.
 */
export interface StockMovementPort {
	/**
	 * Atomically moves on-hand, held and reserved for a variant and appends one ledger row. A change
	 * that would take on-hand below held + reserved, or held or reserved below 0, matches nothing and
	 * throws. `reservedDelta` keeps pieces for orders (`DEC-STOCK-RESERVE`); omitted, it is 0.
	 */
	move(
		input: {
			variantId: string;
			productId: string;
			quantityDelta: number;
			heldDelta: number;
			reservedDelta?: number;
			source: string;
			reasonCode: string | null;
			note: string | null;
			referenceType: string | null;
			referenceId: string | null;
			referenceNumber: string | null;
			actorUserId: string | null;
			approverUserId: string | null;
			at: string;
			/** Where the pieces move (accounts brief F4); the API fills the default stock location when omitted. */
			locationId?: string | null;
		},
		context?: TransactionContext,
	): Promise<{ ledgerId: string; onHandAfter: number; heldAfter: number }>;
	/** Each variant's stock split by location (N1); variants with no split yet return no rows. */
	locationStock(variantIds: readonly string[]): Promise<LocationStock[]>;
	/**
	 * Places stock that has no location yet at one location, once (F4 migration): the variant's own totals
	 * become that location's row, and past ledger rows and cost layers without a location get it. Idempotent.
	 */
	placeUnlocatedStock(locationId: string): Promise<{ variants: number; ledgerRows: number; layers: number }>;
	/** Takes units out of one named layer; throws when the layer no longer holds them. */
	consumeLayer(layerId: string, quantity: number, context?: TransactionContext): Promise<void>;
}

/** What purchase lines, stock rows and counts need to know about a variant and its product. */
export interface StockItemFacts {
	variantId: string;
	productId: string;
	sku: string;
	barcode: string | null;
	title: Record<string, string>;
	optionsLabel: string;
	galleryAssetId: string | null;
	productType: 'simple' | 'variable' | 'bundle';
	productStatus: 'draft' | 'live' | 'disabled' | 'discontinued';
	soldBy: 'piece' | 'metre';
	madeToOrder: boolean;
	tracked: boolean;
	hsnCode: string | null;
	categoryIds: string[];
	categoryName: string | null;
	sellingPriceINR: number;
	mrpINR: number | null;
	onHand: number;
	held: number;
	/** Pieces kept for orders (`DEC-STOCK-RESERVE`). */
	reserved: number;
	lowStockLevel: number | null;
	variantCount: number;
}

export interface StockLayerRow {
	id: string;
	variantId: string;
	receivedAt: string;
	sourceType: string;
	sourceNumber: string | null;
	purchaseInvoiceId: string | null;
	sourceLineId: string | null;
	quantityReceived: number;
	quantityRemaining: number;
	unitCostINR: number;
}

export interface StockLedgerRow {
	id: string;
	variantId: string;
	productId: string;
	quantityDelta: number;
	heldDelta: number;
	balanceAfter: number;
	heldAfter: number;
	source: string;
	reasonCode: string | null;
	note: string | null;
	referenceType: string | null;
	referenceId: string | null;
	referenceNumber: string | null;
	actorUserId: string | null;
	approverUserId: string | null;
	createdAt: string;
}

/**
 * The read side of stock: item facts, search, list rows, layers, ledger history and the sums
 * reports need. Writes stay with the aggregate repositories and `StockMovementPort`.
 */
export interface StockReadRepository {
	items(variantIds: readonly string[]): Promise<Map<string, StockItemFacts>>;
	/** Variants of a product, base variant first (the variant grid). */
	variantsOfProduct(productId: string): Promise<StockItemFacts[]>;
	/** SKU, barcode or title words; whole-word prefix match, live and draft products first. */
	search(q: string, limit: number): Promise<StockItemFacts[]>;
	bySku(skus: readonly string[]): Promise<Map<string, StockItemFacts>>;
	list(filter: {
		q?: string;
		filter: 'all' | 'low' | 'out' | 'held' | 'older_180';
		categoryId?: string;
		page: number;
		pageSize: number;
		olderThan: string;
	}): Promise<{
		items: StockItemFacts[];
		total: number;
		counts: { low: number; out: number; held: number; older180: number };
	}>;
	totals(): Promise<{ pieces: number; metresTenths: number; low: number; out: number; held: number }>;
	openLayers(variantIds: readonly string[]): Promise<StockLayerRow[]>;
	layersOf(variantId: string): Promise<StockLayerRow[]>;
	layersForEntry(entryId: string): Promise<StockLayerRow[]>;
	ledger(filter: {
		variantId?: string;
		source?: string;
		from?: string;
		to?: string;
		actorId?: string;
		referenceIds?: readonly string[];
		page: number;
		pageSize: number;
	}): Promise<{ items: StockLedgerRow[]; total: number }>;
	/** Net units sold (orders placed less cancelled) per variant since an instant. */
	soldSince(variantIds: readonly string[] | null, since: string): Promise<Map<string, number>>;
	/** Net on-hand movement per variant since an instant, leaving out one reference (a count); at one location when named. */
	movedSince(
		variantIds: readonly string[],
		since: string,
		excludeReferenceId: string | null,
		locationId?: string | null,
	): Promise<Map<string, number>>;
	/** Variants with any ledger row at all (opening stock refuses them). */
	withMovements(variantIds: readonly string[]): Promise<Set<string>>;
	lastSoldOn(variantIds: readonly string[]): Promise<Map<string, string>>;
	/** Variants that have open layers older than an instant (ageing, "older than 180 days"). */
	variantsWithLayersBefore(
		before: string,
		page: number,
		pageSize: number,
	): Promise<{ variantIds: string[]; total: number }>;
	/**
	 * Value at cost and units per variant as they stood at the end of a day (valuation report).
	 * `uncostedUnits` are units no cost layer covers (stock typed in before the ledger existed).
	 */
	valuationAsOf(
		endOfDay: string,
	): Promise<Array<{ variantId: string; units: number; valueINR: number; uncostedUnits: number }>>;
	/** Product SKUs in a category (the next SKU for a draft product, p05). */
	productSkusInCategory(categoryId: string): Promise<string[]>;
	/** Variants in categories (stock counts by category), or every tracked variant. */
	variantIdsInScope(scope: { kind: 'all' | 'categories'; categoryIds: readonly string[] }): Promise<string[]>;
}
