import { escapeHtml, pill, quantity, rupees, shortDate } from '@core/purchasing/purchasing-format';

import type { AccountsListRow, AccountsListTab } from '@saha-textile/contracts';

/** A list of Accounts › Vouchers (accounts brief A1–A9), or the Day book (A3). */
export type ListKind = AccountsListTab | 'dayBook';

export interface ListColumn {
	/** A translation key. */
	title: string;
	field: string;
	align?: 'end';
}

type Words = (key: string, params?: Record<string, unknown>) => string;

/** The columns each list draws, in the pictures' order. */
export const LIST_COLUMNS: Readonly<Record<ListKind, readonly ListColumn[]>> = {
	receipts: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_received_from', field: 'party' },
		{ title: 'al_col_against', field: 'against' },
		{ title: 'al_col_method', field: 'method' },
		{ title: 'al_col_reference', field: 'reference' },
		{ title: 'al_col_amount', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	paymentVouchers: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_paid_to', field: 'party' },
		{ title: 'al_col_against', field: 'against' },
		{ title: 'al_col_how', field: 'mode' },
		{ title: 'al_col_reference', field: 'reference' },
		{ title: 'al_col_amount', field: 'amount', align: 'end' },
		{ title: 'al_col_rcm_tax', field: 'rcmTax', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	contra: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_narration', field: 'reference' },
		{ title: 'al_col_amount', field: 'amount', align: 'end' },
		{ title: 'al_col_made_by', field: 'by' },
		{ title: 'al_col_status', field: 'status' },
	],
	journal: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_kind', field: 'journalKind' },
		{ title: 'al_col_accounts', field: 'accounts' },
		{ title: 'al_col_amount', field: 'amount', align: 'end' },
		{ title: 'al_col_made_by', field: 'by' },
		{ title: 'al_col_status', field: 'status' },
	],
	creditNotes: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_against_invoice', field: 'against' },
		{ title: 'al_col_order', field: 'orderNumber' },
		{ title: 'al_col_customer', field: 'party' },
		{ title: 'al_col_reason', field: 'reference' },
		{ title: 'al_col_total', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	debitNotes: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_against_credit_note', field: 'against' },
		{ title: 'al_col_order', field: 'orderNumber' },
		{ title: 'al_col_customer', field: 'party' },
		{ title: 'al_col_reason', field: 'reference' },
		{ title: 'al_col_total', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	refundVouchers: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_paid_to', field: 'party' },
		{ title: 'al_col_against_receipt', field: 'against' },
		{ title: 'al_col_order', field: 'orderNumber' },
		{ title: 'al_col_why', field: 'why' },
		{ title: 'al_col_how', field: 'how' },
		{ title: 'al_col_amount', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	selfInvoices: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_supplier', field: 'party' },
		{ title: 'al_col_what', field: 'against' },
		{ title: 'al_col_total', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	stockAdjustments: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_item', field: 'item' },
		{ title: 'al_col_change', field: 'stock', align: 'end' },
		{ title: 'al_col_reason', field: 'adjustReason' },
		{ title: 'al_col_value_at_cost', field: 'amount', align: 'end' },
		{ title: 'al_col_itc_reversed', field: 'itc', align: 'end' },
		{ title: 'al_col_by_approved', field: 'byApproved' },
		{ title: 'al_col_status', field: 'status' },
	],
	taxInvoices: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_party', field: 'party' },
		{ title: 'al_col_location', field: 'location' },
		{ title: 'al_col_taxable', field: 'taxable', align: 'end' },
		{ title: 'al_col_tax', field: 'tax', align: 'end' },
		{ title: 'al_col_edocs', field: 'edocs' },
		{ title: 'al_col_status', field: 'status' },
	],
	purchaseBills: [
		{ title: 'al_col_number', field: 'number' },
		{ title: 'date', field: 'date' },
		{ title: 'al_col_supplier', field: 'party' },
		{ title: 'al_col_their_bill', field: 'against' },
		{ title: 'al_col_taxable', field: 'taxable', align: 'end' },
		{ title: 'al_col_tax', field: 'tax', align: 'end' },
		{ title: 'al_col_total', field: 'amount', align: 'end' },
		{ title: 'al_col_status', field: 'status' },
	],
	dayBook: [
		{ title: 'date', field: 'date' },
		{ title: 'al_col_voucher', field: 'voucher' },
		{ title: 'al_col_number', field: 'number' },
		{ title: 'al_col_party', field: 'party' },
		{ title: 'al_col_against', field: 'against' },
		{ title: 'al_col_money_in', field: 'moneyIn', align: 'end' },
		{ title: 'al_col_money_out', field: 'moneyOut', align: 'end' },
		{ title: 'al_col_stock', field: 'stock', align: 'end' },
		{ title: 'al_col_by', field: 'by' },
		{ title: 'al_col_status', field: 'status' },
	],
};

/** The pill each state wears: done green, waiting amber, undone red (a refunded receipt is money gone back). */
export function statusKind(row: Pick<AccountsListRow, 'tab' | 'status'>): string {
	if (row.status === 'refunded') return row.tab === 'refundVouchers' ? 'completed' : 'cancelled';
	if (
		['draft', 'pending', 'waiting_for_buyer', 'waiting_for_gateway', 'part_refunded', 'part_credited'].includes(
			row.status,
		)
	)
		return 'pending';
	if (['cancelled', 'failed', 'reversed', 'credited'].includes(row.status)) return 'cancelled';
	return 'completed';
}

const dash = '<span class="text-muted">—</span>';
const textCell = (value: string | null): string => (value ? escapeHtml(value) : dash);
const money = (value: number | null): string => (value === null ? dash : escapeHtml(rupees(value)));
const signed = (stock: number, soldBy: AccountsListRow['soldBy']): string =>
	`${stock > 0 ? '+' : '−'}${quantity(Math.abs(stock), soldBy ?? 'piece')}`;
const extraText = (row: AccountsListRow, key: string): string | null => {
	const value = row.extra[key];
	return typeof value === 'string' ? value : null;
};
const extraMoney = (row: AccountsListRow, key: string): number | null => {
	const value = row.extra[key];
	return typeof value === 'number' ? value : null;
};

/** How a receipt's money came: the order's method, a business account, or a voucher made by hand. */
function method(row: AccountsListRow, t: Words): string {
	if (row.detail === 'on_account') return t('ord_method_onAccount');
	return row.detail === 'receipt' ? t('al_by_hand') : t(`ord_method_${row.detail}`);
}

/** One cell of a row as the table shows it (escaped HTML). */
export function listCell(row: AccountsListRow, field: string, t: Words): string {
	switch (field) {
		case 'number':
			return row.number
				? `<h6 class="mb-0">${escapeHtml(row.number)}</h6>`
				: `<span class="text-muted">${escapeHtml(t(row.status === 'draft' ? 'al_draft' : 'al_no_number'))}</span>`;
		case 'date':
			return escapeHtml(shortDate(row.date));
		case 'method':
			return escapeHtml(method(row, t));
		case 'mode':
			return escapeHtml(row.detail === 'payment' ? t('al_by_hand') : t(`payment_mode_${row.detail}`));
		case 'amount':
			return money(row.amountINR);
		case 'rcmTax':
			return money(extraMoney(row, 'reverseChargeTaxINR'));
		case 'by':
			return row.by ? escapeHtml(row.by) : escapeHtml(t('sa_system'));
		case 'journalKind':
			return escapeHtml(t(`al_jv_${row.detail}`));
		case 'accounts':
			return textCell(row.party ?? row.reference);
		case 'orderNumber':
			return textCell(extraText(row, 'orderNumber'));
		case 'why':
			return escapeHtml(t(`rf_reason_${row.detail}`));
		case 'how':
			return escapeHtml(t(`al_how_${extraText(row, 'how') ?? 'gateway'}`));
		case 'item':
			return `${escapeHtml(row.against ?? '')}<small class="d-block text-muted">${escapeHtml(row.reference ?? '')}</small>`;
		case 'stock':
			return row.stock === null ? '' : escapeHtml(signed(row.stock, row.soldBy));
		case 'adjustReason': {
			const outcome = extraText(row, 'outcome');
			const reason = row.detail ? t(`reason_code_${row.detail}`) : '';
			return escapeHtml(outcome ? `${reason}, ${t(`sa_outcome_${outcome}`)}` : reason);
		}
		case 'itc': {
			const amount = extraMoney(row, 'itcReversedINR');
			const journal = extraText(row, 'journalNumber');
			return amount
				? `${money(amount)}<small class="d-block text-muted">${escapeHtml(journal ?? '')}</small>`
				: dash;
		}
		case 'byApproved': {
			const by = row.by ?? extraText(row, 'requestedByName') ?? t('sa_system');
			const approved = row.approvedBy ?? extraText(row, 'decidedByName');
			const second =
				row.status === 'pending'
					? t('al_waiting')
					: approved
						? t('approved_by', { name: approved })
						: t('al_no_approval');
			return `${escapeHtml(by)}<small class="d-block text-muted">${escapeHtml(second)}</small>`;
		}
		case 'voucher':
			return escapeHtml(t(`al_voucher_${row.tab}`));
		case 'location':
			return textCell(extraText(row, 'location'));
		case 'taxable':
			return money(extraMoney(row, 'taxableINR'));
		case 'tax':
			return money(extraMoney(row, 'taxINR'));
		case 'edocs': {
			const irn = extraText(row, 'irn');
			const ewb = extraText(row, 'eWayBill');
			const parts = [irn ? t('al_irn_done') : null, ewb ? t('al_ewb', { number: ewb }) : null].filter(Boolean);
			return parts.length ? escapeHtml(parts.join(' · ')) : dash;
		}
		case 'moneyIn':
			return row.moneyInINR === null ? '' : escapeHtml(rupees(row.moneyInINR));
		case 'moneyOut':
			return row.moneyOutINR === null ? '' : escapeHtml(rupees(row.moneyOutINR));
		case 'status':
			return pill(statusKind(row), t(`al_status_${row.status}`));
		default:
			return textCell((row as unknown as Record<string, string | null>)[field] ?? null);
	}
}

/** Where a row opens: its own page, its order, or none (a debit note prints only). */
export function viewLink(row: AccountsListRow): string[] | null {
	const orderId = extraText(row, 'orderId');
	const businessId = extraText(row, 'businessId');
	switch (row.tab) {
		case 'receipts':
			if (orderId) return ['/order', 'details', orderId];
			return businessId ? ['/businesses', businessId] : ['/accounts/vouchers', row.id];
		case 'paymentVouchers':
			return row.extra['againstKind'] ? ['/accounts/payment-vouchers', row.id] : ['/accounts/vouchers', row.id];
		case 'contra':
			return ['/accounts/vouchers', row.id];
		case 'journal':
			return businessId ? ['/businesses', businessId] : ['/accounts/vouchers', row.id];
		case 'creditNotes':
			return ['/accounts/credit-notes', row.id];
		case 'refundVouchers':
			return ['/accounts/refund-vouchers', row.id];
		case 'selfInvoices':
			return ['/accounts/self-invoices', row.id];
		case 'stockAdjustments':
			return ['/stock/adjustments', row.id];
		case 'taxInvoices':
			return ['/accounts/invoices', row.id];
		case 'purchaseBills':
			return ['/purchase-entries', row.id];
		default:
			return null;
	}
}
