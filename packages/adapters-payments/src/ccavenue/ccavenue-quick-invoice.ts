import {
	PaymentGatewayError,
	type CreatedPaymentRequest,
	type CreatePaymentRequestInput,
	type PaymentRequestStatusReport,
} from '@saha-textile/core-domain';

import type { CcavenueMerchantApi } from './ccavenue-merchant-api';

/**
 * CCAvenue Quick Invoice (HDFC API document § 13 and § 15; orders brief "payment requests", owner
 * 2026-11-20): CCAvenue emails and texts the customer its own request and gives back a short link
 * (payit.cc/…) and an invoice id we check the status with. HDFC's document prints no call to cancel
 * a quick invoice, so a request we cancel simply stops being forwarded to and runs out by its
 * validity.
 */

/** Our reference as CCAvenue takes it: letters, digits, hyphen and underscore, 25 at most. */
export function ccavenueMerchantReference(reference: string): string {
	return reference.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 25);
}

/** Two decimals, from minor units. */
const amountText = (minor: number): string => (minor / 100).toFixed(2);

/** CCAvenue's own SMS wording placeholders are its own; ours fills only what is ours. */
const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

export async function generateQuickInvoice(
	api: CcavenueMerchantApi,
	input: CreatePaymentRequestInput,
): Promise<CreatedPaymentRequest> {
	if (input.currency !== 'INR')
		throw new PaymentGatewayError('invalid-request', 'CCAvenue quick invoices are sent in rupees here');
	const indianMobile =
		input.customer.mobile &&
		input.customer.mobile.countryCallingCode === '91' &&
		/^[6-9]\d{9}$/.test(input.customer.mobile.number)
			? input.customer.mobile.number
			: null;
	const email = input.customer.email;
	if (!email && !indianMobile)
		throw new PaymentGatewayError('invalid-request', 'CCAvenue needs an email or an Indian mobile number');
	const delivery = email && indianMobile ? 'BOTH' : email ? 'EMAIL' : 'SMS';
	const reference = ccavenueMerchantReference(input.reference);
	const request: Record<string, string> = {
		customer_name: clip(input.customer.name, 60),
		customer_email_id: email ?? '',
		customer_email_subject: clip(input.emailSubject, 100),
		customer_mobile_no: indianMobile ?? '',
		valid_for: String(input.validDays),
		valid_type: 'days',
		currency: 'INR',
		amount: amountText(input.amountMinor),
		invoice_description: clip(`Order ${input.orderNumber}`, 500),
		merchant_reference_no: reference,
		bill_delivery_type: delivery,
	};
	if (input.smsText && delivery !== 'EMAIL') request.sms_content = clip(input.smsText, 300);
	const result = await api.call('generateQuickInvoice', request);
	if (result.kind === 'no-record')
		throw new PaymentGatewayError('rejected', 'CCAvenue refused the quick invoice', result.code);
	const body = result.body as Record<string, unknown>;
	const invoiceId = String(body.invoice_id ?? '').trim();
	const url = String(body.tiny_url ?? '').trim();
	if (!invoiceId || !url || String(body.invoice_status ?? '0') !== '0') {
		throw new PaymentGatewayError(
			'rejected',
			'CCAvenue did not create the quick invoice',
			String(body.error_code ?? '') || null,
		);
	}
	return {
		gatewayRequestId: invoiceId,
		url: url.replace(/^http:\/\//, 'https://'),
		auditRecord: { invoice_id: invoiceId, merchant_reference_no: reference, bill_delivery_type: delivery },
	};
}

/** Order statuses that mean the money arrived, from the invoice's order records. */
const PAID_STATUSES = new Set(['Shipped', 'Successful', 'Success', 'Delivered']);

export async function quickInvoiceStatus(
	api: CcavenueMerchantApi,
	invoiceId: string,
): Promise<PaymentRequestStatusReport> {
	if (!/^\d{1,25}$/.test(invoiceId))
		throw new PaymentGatewayError('invalid-request', 'CCAvenue invoice id is not numeric');
	const result = await api.call('invoiceList', { invoice_id: invoiceId, invoice_type: 'quick', page_no: '1' });
	if (result.kind === 'no-record')
		return { gatewayRequestId: invoiceId, state: 'unknown', payments: [], auditRecord: { invoice_id: invoiceId } };
	const body = result.body as Record<string, unknown>;
	const records = (
		Array.isArray(body.invoice_List)
			? body.invoice_List
			: Array.isArray(body.order_Status_List)
				? body.order_Status_List
				: []
	) as Array<Record<string, unknown>>;
	const payments = records
		.filter((record) => PAID_STATUSES.has(String(record.order_status ?? '')))
		.map((record) => ({
			gatewayReference: String(record.reference_no ?? ''),
			amountMinor: Math.round(Number(record.order_amt ?? 0) * 100),
			currency: String(record.order_currncy ?? record.order_curr ?? 'INR'),
			at: String(record.order_date_time ?? ''),
			method: record.order_option_type ? String(record.order_option_type) : null,
		}))
		.filter((payment) => payment.gatewayReference);
	return {
		gatewayRequestId: invoiceId,
		state: payments.length ? 'paid' : 'open',
		payments,
		auditRecord: { invoice_id: invoiceId, records: String(records.length) },
	};
}
