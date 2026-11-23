import type {
	PaymentVoucher,
	PaymentVoucherList,
	PaymentVoucherListQuery,
	SelfInvoice,
	SelfInvoiceList,
	SelfInvoiceListQuery,
} from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Self-invoices (accounts brief D): drafts are saved by version; once issued, only payment and cancellation move on. */
export interface SelfInvoiceRepository {
	get(id: string, context?: TransactionContext): Promise<SelfInvoice | null>;
	insert(invoice: SelfInvoice, context?: TransactionContext): Promise<void>;
	/** Refused with `self_invoice_changed` when someone saved it since `expectedVersion`; the stored version goes up by one. */
	save(invoice: SelfInvoice, expectedVersion: number, context?: TransactionContext): Promise<SelfInvoice>;
	/** Drafts only. */
	removeDraft(id: string): Promise<boolean>;
	forSupplier(supplierId: string): Promise<SelfInvoice[]>;
	/** A7: one page and every chip's count; `dueSoonFrom` is the earliest day received still inside the 30 days. */
	list(query: SelfInvoiceListQuery & { dueSoonFrom: string }): Promise<SelfInvoiceList>;
}

/** Payment vouchers (decision D5): made with the payment, never edited. */
export interface PaymentVoucherRepository {
	get(id: string, context?: TransactionContext): Promise<PaymentVoucher | null>;
	/** Refused with `duplicate_payment_voucher` when the supplier payment already has one. */
	insert(voucher: PaymentVoucher, context?: TransactionContext): Promise<void>;
	forDocument(kind: PaymentVoucher['against']['kind'], id: string): Promise<PaymentVoucher[]>;
	/** Saves a cancelled voucher over the paid one; refused with `payment_voucher_changed` when it is no longer paid. */
	cancel(voucher: PaymentVoucher, context?: TransactionContext): Promise<void>;
	/** A6: one page and every chip's count. */
	list(query: PaymentVoucherListQuery): Promise<PaymentVoucherList>;
}
