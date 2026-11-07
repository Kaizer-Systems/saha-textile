import { z } from 'zod';

import { parseAmount, presentOrNull } from './ccavenue-wire';

/**
 * A merchant order id, which here is the payment attempt id. CCAvenue prints three different
 * character sets for this field: request (hyphen, slash, underscore), response (hash, slash,
 * hyphen) and Status API (hyphen, underscore). Letters, digits and hyphen pass all three.
 */
export const AttemptId = z.string().regex(/^[A-Za-z0-9-]{1,30}$/);

/** CCAvenue's own reference: `tracking_id` in a callback, `reference_no` in the merchant API. */
export const GatewayReference = z.string().regex(/^\d{1,25}$/);

/** Printed as AlphaNumeric (30); error 51086 allows only letters and numbers. */
export const RefundReference = z.string().regex(/^[A-Za-z0-9]{1,30}$/);

const Currency = z.string().regex(/^[A-Z]{3}$/);

/** The merchant API sends some fields as JSON numbers and some as strings. */
const Scalar = z.union([z.string(), z.number()]).transform((value) => String(value).trim());

const RawAmount = z.union([z.string(), z.number()]);

function toAmountMinor(value: string | number, context: z.RefinementCtx): number {
	const amountMinor = parseAmount(value);
	if (amountMinor === null) {
		context.addIssue({ code: 'custom', message: 'not an amount' });
		return z.NEVER;
	}
	return amountMinor;
}

const Amount = RawAmount.transform(toAmountMinor);

/** The form CCAvenue makes the browser post. Anything else in it is ignored. */
export const CallbackForm = z.object({
	encResp: z.string().min(1).max(65_536),
	orderNo: z.string().max(30).optional(),
});

/**
 * The decrypted callback. The response table prints `Amount` and the samples print `amount`.
 * Either is accepted, and both together is refused, because only injected text would cause it.
 */
export const HostedResponse = z
	.looseObject({
		order_id: AttemptId,
		tracking_id: z.string().optional().transform(presentOrNull).pipe(GatewayReference.nullable()),
		order_status: z.string(),
		failure_message: z.string().optional(),
		currency: Currency,
		amount: Amount.optional(),
		Amount: Amount.optional(),
	})
	.transform((response, context) => {
		const amountMinor = response.amount ?? response.Amount;
		if (amountMinor === undefined || (response.amount !== undefined && response.Amount !== undefined)) {
			context.addIssue({ code: 'custom', message: 'expected exactly one amount' });
			return z.NEVER;
		}
		return { ...response, amountMinor };
	});

/** The merchant API's reply around the encrypted body. */
export const MerchantApiEnvelope = z.object({
	status: z.enum(['0', '1']),
	enc_response: z.string().optional(),
	enc_error_code: z.string().optional(),
});

/**
 * Every decrypted merchant API body may report an error in these fields instead of its data.
 * Fields that do not decide the outcome may be null. Order id, reference, amount, currency and
 * status stay strict below.
 */
export const MerchantApiFailure = z.looseObject({
	error_code: Scalar.nullish(),
	status: Scalar.nullish(),
});

/**
 * The Status API order record. The field table prints `order_curr` and the samples print
 * `order_currncy`, so both are read and must agree when both appear.
 */
export const OrderStatusRecord = z
	.looseObject({
		reference_no: Scalar.pipe(GatewayReference),
		order_no: Scalar.pipe(AttemptId),
		order_status: z.string(),
		order_amt: Amount,
		order_currncy: Currency.optional(),
		order_curr: Currency.optional(),
		order_fraud_status: z.string().nullish(),
		order_bank_response: z.string().nullish(),
	})
	.transform((record, context) => {
		const currency = record.order_currncy ?? record.order_curr;
		const agree = !record.order_currncy || !record.order_curr || record.order_currncy === record.order_curr;
		if (!currency || !agree) {
			context.addIssue({ code: 'custom', message: 'expected one currency' });
			return z.NEVER;
		}
		return { ...record, currency };
	});

export const RefundResponse = z.looseObject({
	refund_status: Scalar.pipe(z.enum(['0', '1'])),
	reason: z.string().nullish(),
	error_code: Scalar.nullish(),
});

export const RefundDetails = z.looseObject({
	reference_no: Scalar.pipe(GatewayReference),
	refund_list: z
		.array(
			z
				.looseObject({
					refund_amt: RawAmount,
					refund_status: z.string(),
					refund_mer_ref_no: z.string().nullish(),
				})
				// A separate field, so the audit record keeps the amount as CCAvenue wrote it.
				.transform((refund, context) => ({
					...refund,
					amountMinor: toAmountMinor(refund.refund_amt, context),
				})),
		)
		.default([]),
});
