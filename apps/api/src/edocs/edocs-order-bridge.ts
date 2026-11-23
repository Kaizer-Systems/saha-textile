import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { EInvoiceRecord, EWayBillRecord, Order } from '@saha-textile/contracts';
import type { EDocumentOutcome, EInvoicePort, EWayBillPort } from '@saha-textile/core-domain';

import { EDocsService } from './edocs.service';

/**
 * The order page's Raise e-invoice / Raise e-way bill (orders brief seam) through the chosen path (addendum 2,
 * AE1, AE7): the by-hand path, untested keys or a connection that doesn't answer all return "notConnected", so the
 * same button opens the by-hand popup. An automatic path registers the order's tax invoice; tax invoices are issued
 * at dispatch from accounts brief D1, and until an order has one there is nothing to register, so it falls back too.
 */
@Injectable()
export class EDocsOrderBridge implements OnModuleInit {
	private status = { eInvoice: false, eWayBill: false };

	constructor(private readonly edocs: EDocsService) {}

	async onModuleInit(): Promise<void> {
		await this.refresh().catch(() => undefined);
	}

	/** Whether each document has a working automatic path (the order page's "Connected" label). */
	async refresh(): Promise<void> {
		this.status = {
			eInvoice: !!(await this.edocs.automatic('eInvoice')),
			eWayBill: !!(await this.edocs.automatic('eWayBill')),
		};
	}

	connected(kind: 'eInvoice' | 'eWayBill'): boolean {
		return this.status[kind];
	}

	async raise<T>(order: Order, kind: 'eInvoice' | 'eWayBill'): Promise<EDocumentOutcome<T>> {
		const auto = await this.edocs.automatic(kind);
		await this.refresh();
		if (!auto) return { kind: 'notConnected' };
		// No tax invoice number yet (D1): nothing to register; log why and open the by-hand popup.
		await this.edocs.log({
			gstin: auto.gstin,
			path: auto.path,
			action: 'generate',
			documentNumber: order.orderNumber,
			ok: false,
			code: 'invoice_not_issued',
			message: 'The tax invoice is issued at dispatch; entered by hand until then',
			durationMs: null,
			by: 'system',
		});
		return { kind: 'notConnected' };
	}
}

/** The two ports the orders service already uses, both answered by the bridge. */
export const eInvoicePortFrom = (bridge: EDocsOrderBridge): EInvoicePort => ({
	get connected() {
		return bridge.connected('eInvoice');
	},
	raise: (order) => bridge.raise<Omit<EInvoiceRecord, 'by' | 'at'>>(order, 'eInvoice'),
});
export const eWayBillPortFrom = (bridge: EDocsOrderBridge): EWayBillPort => ({
	get connected() {
		return bridge.connected('eWayBill');
	},
	raise: (order) => bridge.raise<Omit<EWayBillRecord, 'by' | 'at'>>(order, 'eWayBill'),
});
