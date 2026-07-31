import { z } from 'zod';

import { Id, IsoDateTime, PriceINR } from './common';

/**
 * Manual stock-adjustment reason codes (owner lock — the list is fixed, not free text).
 *
 * A note is OPTIONAL for the first nine and MANDATORY for `other`, so "other" can never
 * become an unexplained hole in the audit trail. `InventoryAdjustmentRequest` enforces it.
 */
export const InventoryReasonCode = z.enum([
	'damage',
	'lost_missing',
	'manual_recount_correction',
	'supplier_shortage',
	'return_restocked',
	'return_not_restocked',
	'internal_use_sample',
	'photoshoot_display_use',
	'system_migration_correction',
	'other',
]);
export type InventoryReasonCode = z.infer<typeof InventoryReasonCode>;

/** The one reason code that cannot stand without an explanation. */
export const REASON_CODE_REQUIRING_NOTE: InventoryReasonCode = 'other';

/**
 * What caused a stock movement. `manual_adjustment` carries a reason code; the rest are
 * system-generated provenance so every ledger row can be traced to its cause.
 */
export const InventoryMovementSource = z.enum([
	'manual_adjustment',
	'purchase_invoice',
	'order_placed',
	'order_cancelled',
	'return_restocked',
	'reservation',
	'reservation_released',
	'system_migration',
]);
export type InventoryMovementSource = z.infer<typeof InventoryMovementSource>;

/**
 * One append-only stock movement (`inventoryLedger`).
 *
 * Owner locks: stock lives on VARIANTS, movements are typed and audited, and the ledger
 * is the source of truth for how a quantity got where it is. `quantityDelta` is signed —
 * negative removes stock. Corrections are new compensating rows, never edits.
 */
export const InventoryLedgerEntry = z
	.object({
		id: Id,
		variantId: Id,
		productId: Id,
		quantityDelta: z.number().int(),
		/** Running balance AFTER this movement, recorded for audit and fast reads. */
		balanceAfter: z.number().int(),
		source: InventoryMovementSource,
		/** Required when `source` is `manual_adjustment`. */
		reasonCode: InventoryReasonCode.nullable().default(null),
		note: z.string().max(1000).nullable().default(null),
		/** Order / purchase-invoice / return id that caused a system movement. */
		referenceType: z.string().min(1).nullable().default(null),
		referenceId: Id.nullable().default(null),
		actorUserId: Id.nullable().default(null),
		createdAt: IsoDateTime,
	})
	.superRefine((entry, ctx) => {
		if (entry.source === 'manual_adjustment' && !entry.reasonCode) {
			ctx.addIssue({
				code: 'custom',
				message: 'a manual adjustment requires a reason code',
				path: ['reasonCode'],
			});
		}
		if (entry.reasonCode === REASON_CODE_REQUIRING_NOTE && !entry.note?.trim()) {
			ctx.addIssue({ code: 'custom', message: 'reason code `other` requires a note', path: ['note'] });
		}
		if (entry.quantityDelta === 0) {
			ctx.addIssue({ code: 'custom', message: 'a ledger row must move stock', path: ['quantityDelta'] });
		}
	});
export type InventoryLedgerEntry = z.infer<typeof InventoryLedgerEntry>;

/** `POST /admin/inventory/adjust` — the admin-facing manual adjustment. */
export const InventoryAdjustmentRequest = z
	.object({
		variantId: Id,
		quantityDelta: z.number().int(),
		reasonCode: InventoryReasonCode,
		note: z.string().max(1000).optional(),
	})
	.superRefine((request, ctx) => {
		if (request.quantityDelta === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'an adjustment must change the quantity',
				path: ['quantityDelta'],
			});
		}
		if (request.reasonCode === REASON_CODE_REQUIRING_NOTE && !request.note?.trim()) {
			ctx.addIssue({ code: 'custom', message: 'reason code `other` requires a note', path: ['note'] });
		}
	});
export type InventoryAdjustmentRequest = z.infer<typeof InventoryAdjustmentRequest>;

/**
 * A FIFO cost layer (`inventoryCostLayers`): a quantity bought at a unit cost, consumed
 * oldest-first.
 *
 * Owner lock: valuation is FIFO, and **FIFO/COGS detail is never customer-facing** —
 * this shape belongs to admin/reporting responses only and must never appear in a public
 * DTO.
 */
export const InventoryCostLayer = z
	.object({
		id: Id,
		variantId: Id,
		/** Purchase invoice that created the layer. */
		purchaseInvoiceId: Id.nullable().default(null),
		unitCostINR: PriceINR,
		quantityReceived: z.number().int().positive(),
		quantityRemaining: z.number().int().nonnegative(),
		receivedAt: IsoDateTime,
		createdAt: IsoDateTime.optional(),
	})
	.superRefine((layer, ctx) => {
		if (layer.quantityRemaining > layer.quantityReceived) {
			ctx.addIssue({
				code: 'custom',
				message: '`quantityRemaining` may not exceed `quantityReceived`',
				path: ['quantityRemaining'],
			});
		}
	});
export type InventoryCostLayer = z.infer<typeof InventoryCostLayer>;

/**
 * Current stock for one variant, as read by admin surfaces.
 *
 * `reserved` is a SEAM: reservation timing and TTL are `DEC-STOCK-RESERVE`, and whether
 * `available` may go negative at all is `DEC-BACKORDER`. The shape is stable; no
 * reservation engine reads it yet.
 */
export const VariantStockSnapshot = z.object({
	variantId: Id,
	onHand: z.number().int(),
	/** Seam — `DEC-STOCK-RESERVE`. */
	reserved: z.number().int().nonnegative().default(0),
	/** `onHand - reserved`; recomputed, never client-supplied. */
	available: z.number().int(),
	lowStockThreshold: z.number().int().nonnegative().nullable().default(null),
	updatedAt: IsoDateTime.optional(),
});
export type VariantStockSnapshot = z.infer<typeof VariantStockSnapshot>;
