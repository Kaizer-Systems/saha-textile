import type { OrderPayment } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	gatewayRefundReference,
	refundablePayments,
	refundStatusOf,
	refundVoucherPosting,
} from '../src/invoicing/refund-voucher-rules';

describe('refund vouchers (accounts brief C, Rule 51)', () => {
	it('makes a gateway refund reference of at most 30 letters and digits, the same every time', () => {
		expect(gatewayRefundReference('RF', 'pay_45a292d4-cfd2-41dd-928f-8e04704eb182')).toBe(
			'RFpay45a292d4cfd241dd928f8e047',
		);
		expect(gatewayRefundReference('CN', 'cn_1')).toBe('CNcn1');
	});

	it('reads the gateway’s answer as refunded, failed or waiting', () => {
		expect(refundStatusOf('accepted')).toBe('refunded');
		expect(refundStatusOf('duplicate')).toBe('refunded');
		expect(refundStatusOf('refused')).toBe('failed');
		expect(refundStatusOf(null)).toBe('waiting_for_gateway');
	});

	it('gives back only received money with a receipt', () => {
		const payment = (patch: Partial<OrderPayment>) =>
			({ id: 'p', state: 'received', amountINR: 100, receiptNumber: 'RC/1', ...patch }) as OrderPayment;
		expect(
			refundablePayments([
				payment({ id: 'a' }),
				payment({ id: 'b', state: 'refunded' }),
				payment({ id: 'c', amountINR: 0 }),
				payment({ id: 'd', receiptNumber: null }),
			]).map((p) => p.id),
		).toEqual(['a']);
	});

	it('takes the advance off against the gateway or the bank', () => {
		expect(refundVoucherPosting(2_600, { systemKey: 'gateway_clearing' })).toEqual([
			{ ledger: { systemKey: 'customer_advances' }, debitPaise: 260_000 },
			{ ledger: { systemKey: 'gateway_clearing' }, creditPaise: 260_000 },
		]);
		expect(refundVoucherPosting(10.005, { id: 'led_hdfc' })[1]).toEqual({
			ledger: { id: 'led_hdfc' },
			creditPaise: 1_001,
		});
	});
});
