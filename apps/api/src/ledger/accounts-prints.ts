import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountsListTab, DocumentKind } from '@saha-textile/contracts';
import type {
	AdjustmentRequestRepository,
	AdminOrderRepository,
	CreditNoteRepository,
	DebitNoteRepository,
	OrderPaymentRepository,
	PaymentVoucherRepository,
	RefundVoucherRepository,
	SelfInvoiceRepository,
} from '@saha-textile/core-domain';

import { creditNoteData, debitNoteData } from '../documents/credit-note-print';
import type { DocumentData } from '../documents/document-data';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { orderReceiptData } from '../documents/record-prints';
import { refundVoucherData } from '../documents/refund-voucher-print';
import { paymentVoucherData, selfInvoiceData } from '../documents/self-invoice-print';
import {
	ADJUSTMENT_REQUEST_REPOSITORY,
	ADMIN_ORDER_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	DEBIT_NOTE_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	PAYMENT_VOUCHER_REPOSITORY,
	REFUND_VOUCHER_REPOSITORY,
	SELF_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { stockAdjustmentData } from '../purchasing/stock-adjustment-pages';
import { accountsRefusal } from './accounts-refusal';

type Seller = DocumentData['seller'];

/** The document format each tab prints on; journal and contra vouchers have no print of their own. */
const KINDS: Partial<Record<AccountsListTab, DocumentKind>> = {
	receipts: 'receipt',
	paymentVouchers: 'paymentVoucher',
	creditNotes: 'creditNote',
	debitNotes: 'debitNote',
	refundVouchers: 'refundVoucher',
	selfInvoices: 'selfInvoice',
	stockAdjustments: 'stockAdjustment',
};

/**
 * The picks bar's Print (accounts brief A1): the picked documents of one tab in one PDF, each from a new page, in the
 * order picked, on the tab's document format. A pick with no print (a draft, a request still waiting, a receipt made
 * by hand) is left out; when nothing is left the request is refused.
 */
@Injectable()
export class AccountsPrints {
	constructor(
		@Inject(DocumentFormatsService)
		private readonly formats: Pick<DocumentFormatsService, 'seller' | 'renderActiveCopies'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'findById'>,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'findById'>,
		@Inject(PAYMENT_VOUCHER_REPOSITORY) private readonly paymentVouchers: Pick<PaymentVoucherRepository, 'get'>,
		@Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: Pick<CreditNoteRepository, 'get'>,
		@Inject(DEBIT_NOTE_REPOSITORY) private readonly debitNotes: Pick<DebitNoteRepository, 'get'>,
		@Inject(REFUND_VOUCHER_REPOSITORY) private readonly refunds: Pick<RefundVoucherRepository, 'get'>,
		@Inject(SELF_INVOICE_REPOSITORY) private readonly selfInvoices: Pick<SelfInvoiceRepository, 'get'>,
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY)
		private readonly adjustments: Pick<AdjustmentRequestRepository, 'findById'>,
	) {}

	async picked(tab: AccountsListTab, ids: readonly string[]): Promise<{ fileName: string; data: Uint8Array }> {
		const kind = KINDS[tab];
		if (!kind) throw new BadRequestException(accountsRefusal('list_has_no_print'));
		const seller = await this.formats.seller(previewDocument(kind).seller);
		const pages = (await Promise.all(ids.map((id) => this.dataOf(tab, id, seller)))).filter(
			(page): page is DocumentData => page !== null,
		);
		const [first, ...rest] = pages;
		if (!first) throw new NotFoundException(accountsRefusal('nothing_to_print'));
		return {
			fileName: `${tab}-${pages.length}.pdf`,
			data: await this.formats.renderActiveCopies(kind, [first, ...rest]),
		};
	}

	private async dataOf(tab: AccountsListTab, id: string, seller: Seller): Promise<DocumentData | null> {
		switch (tab) {
			case 'receipts': {
				const payment = await this.payments.findById(id);
				const order = payment?.receiptNumber ? await this.orders.findById(payment.orderId) : null;
				return payment && order ? orderReceiptData(order, payment, seller) : null;
			}
			case 'paymentVouchers': {
				const voucher = await this.paymentVouchers.get(id);
				return voucher ? paymentVoucherData(voucher, seller) : null;
			}
			case 'creditNotes': {
				const note = await this.creditNotes.get(id);
				return note?.number ? creditNoteData(note, seller) : null;
			}
			case 'debitNotes': {
				const note = await this.debitNotes.get(id);
				return note ? debitNoteData(note, seller) : null;
			}
			case 'refundVouchers': {
				const voucher = await this.refunds.get(id);
				return voucher ? refundVoucherData(voucher, seller) : null;
			}
			case 'selfInvoices': {
				const invoice = await this.selfInvoices.get(id);
				return invoice?.number ? selfInvoiceData(invoice, seller) : null;
			}
			default: {
				// Only stock adjustments are left: the tabs without a format were refused above.
				const adjustment = await this.adjustments.findById(id);
				return adjustment?.number && adjustment.kind === 'adjustment'
					? stockAdjustmentData(adjustment, seller)
					: null;
			}
		}
	}
}
