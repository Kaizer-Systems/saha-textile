import type { TaxInvoice } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Tax invoices (accounts brief D1): written in the dispatch's transaction; never edited, only cancelled. */
export interface TaxInvoiceRepository {
	/** Refused with `duplicate_tax_invoice` for a number already used under the same GSTIN, or a second invoice for a shipment. */
	insert(invoice: TaxInvoice, context?: TransactionContext): Promise<void>;
	get(id: string): Promise<TaxInvoice | null>;
	listForOrder(orderId: string): Promise<TaxInvoice[]>;
	findByShipment(shipmentId: string, context?: TransactionContext): Promise<TaxInvoice | null>;
	/** Ties an invoice issued before dispatch (for its e-way bill or e-invoice) to the parcel that carried it. */
	linkShipment(id: string, shipmentId: string, context?: TransactionContext): Promise<void>;
	list(query: { from: string; to: string; search: string; page: number; pageSize: number }): Promise<{
		items: TaxInvoice[];
		total: number;
	}>;
	cancel(
		id: string,
		cancellation: NonNullable<TaxInvoice['cancellation']>,
		context?: TransactionContext,
	): Promise<void>;
}
