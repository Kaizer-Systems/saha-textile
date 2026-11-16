import type {
	AdjustmentRequest,
	InventorySettings,
	PurchaseEntry,
	PurchaseOrder,
	PurchaseReturn,
	StockCount,
	Supplier,
	SupplierPayment,
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
}

export interface StockHoldRecord {
	id: string;
	variantId: string;
	productId: string;
	quantity: number;
	reason: 'waiting_for_supplier' | 'photoshoot' | 'store_display' | 'quality_check';
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
	save(request: AdjustmentRequest, context?: TransactionContext): Promise<void>;
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

/** Document numbers: one counter per series and financial year, allocated in a transaction. */
export interface NumberAllocatorPort {
	next(series: string, fiscalYear: string, context?: TransactionContext): Promise<number>;
}

export interface InventorySettingsRepository {
	get(): Promise<InventorySettings>;
	save(settings: InventorySettings): Promise<void>;
}

/**
 * Stock movements beyond the plain ledger: held pieces, cost layers drawn from a named layer
 * (a return goes back at its own entry's cost) and FIFO, and the read sides the screens need.
 */
export interface StockMovementPort {
	/**
	 * Atomically moves on-hand and held for a variant and appends one ledger row. A decrement
	 * that would take on-hand below held + reserved, or held below 0, matches nothing and throws.
	 */
	move(
		input: {
			variantId: string;
			productId: string;
			quantityDelta: number;
			heldDelta: number;
			source: string;
			reasonCode: string | null;
			note: string | null;
			referenceType: string | null;
			referenceId: string | null;
			referenceNumber: string | null;
			actorUserId: string | null;
			approverUserId: string | null;
			at: string;
		},
		context?: TransactionContext,
	): Promise<{ ledgerId: string; onHandAfter: number; heldAfter: number }>;
	/** Takes units out of one named layer; throws when the layer no longer holds them. */
	consumeLayer(layerId: string, quantity: number, context?: TransactionContext): Promise<void>;
}
