import type { CreditNote, DebitNote, OrderReturn, RefundVoucher } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Returns (accounts brief B2, B3): changed only through their steps; a save that lost a race is refused. */
export interface OrderReturnRepository {
	insert(entry: OrderReturn, context?: TransactionContext): Promise<void>;
	get(id: string, context?: TransactionContext): Promise<OrderReturn | null>;
	listForOrder(orderId: string): Promise<OrderReturn[]>;
	/** Refused with `return_changed` when someone saved it since `expectedUpdatedAt`. */
	save(entry: OrderReturn, expectedUpdatedAt: string, context?: TransactionContext): Promise<void>;
}

export interface CreditNoteListQuery {
	from: string;
	to: string;
	search: string;
	status: CreditNote['status'] | null;
	page: number;
	pageSize: number;
}

/** Credit notes (B4–B11): drafts are edited by version; issued ones change only by cancelling or refunding. */
export interface CreditNoteRepository {
	insert(note: CreditNote, context?: TransactionContext): Promise<void>;
	get(id: string, context?: TransactionContext): Promise<CreditNote | null>;
	listForOrder(orderId: string): Promise<CreditNote[]>;
	listForInvoice(invoiceId: string, context?: TransactionContext): Promise<CreditNote[]>;
	list(query: CreditNoteListQuery): Promise<{ items: CreditNote[]; total: number }>;
	/** Refused with `credit_note_changed` when its version moved on; the saved note carries version + 1. */
	save(note: CreditNote, expectedVersion: number, context?: TransactionContext): Promise<CreditNote>;
	/** Deletes a draft; refused with `credit_note_not_draft` for an issued one. */
	deleteDraft(id: string): Promise<void>;
}

/** Debit notes (B5, B9): never edited. */
export interface DebitNoteRepository {
	insert(note: DebitNote, context?: TransactionContext): Promise<void>;
	get(id: string): Promise<DebitNote | null>;
	listForOrder(orderId: string): Promise<DebitNote[]>;
}

export interface RefundVoucherListQuery {
	from: string;
	to: string;
	search: string;
	status: RefundVoucher['status'] | null;
	page: number;
	pageSize: number;
}

/** Refund vouchers (C): made with the refund; only their status moves on (a retry, or paid by bank transfer). */
export interface RefundVoucherRepository {
	/** Refused with `duplicate_refund_voucher` when the payment already has one. */
	insert(voucher: RefundVoucher, context?: TransactionContext): Promise<void>;
	get(id: string, context?: TransactionContext): Promise<RefundVoucher | null>;
	listForOrder(orderId: string): Promise<RefundVoucher[]>;
	list(query: RefundVoucherListQuery): Promise<{ items: RefundVoucher[]; total: number }>;
	/** Refused with `refund_voucher_changed` when someone saved it since `expectedUpdatedAt`. */
	save(voucher: RefundVoucher, expectedUpdatedAt: string, context?: TransactionContext): Promise<void>;
}
