import { describe, expect, it } from 'vitest';

import { payoutProblem, payoutsOf, settlementRows } from '../src/settlements/settlement-rules';

/** Gateway payouts and courier COD remittances (accounts brief Q10). */

const row = (payoutReference: string, date: string, grossPaise: number, chargesPaise = 0, gstPaise = 0) => ({
	payoutReference,
	date,
	reference: `${payoutReference}-${grossPaise}`,
	grossPaise,
	chargesPaise,
	gstPaise,
});
const landing = {
	receivedByGateway: null,
	receivedByUpi: null,
	receivedByBank: null,
	cashOnDelivery: 'led_cod_shiprocket',
	paidByBank: null,
	paidInCash: null,
	updatedAt: null,
	updatedBy: null,
};

describe('a payout file’s payouts', () => {
	it('groups rows by payout, dated by the latest row, adds up the money, oldest first', () => {
		const payouts = payoutsOf([
			row('UTR22', '2026-11-22', 1_000_000, 17_500, 3_150),
			row('UTR18', '2026-11-18', 500_000, 9_000, 1_620),
			row('UTR22', '2026-11-23', 230_000, 4_000, 720),
		]);
		expect(payouts.map((p) => [p.payoutReference, p.date, p.rows.length, p.grossPaise, p.netPaise])).toEqual([
			['UTR18', '2026-11-18', 1, 500_000, 489_380],
			['UTR22', '2026-11-23', 2, 1_230_000, 1_204_630],
		]);
		expect(payoutsOf([row('A', '2026-11-22', 10), row('A', '2026-11-20', 10)])[0]?.date).toBe('2026-11-22');
		expect(
			payoutsOf([row('B', '2026-11-22', 10), row('A', '2026-11-22', 10)]).map((p) => p.payoutReference),
		).toEqual(['A', 'B']);
	});

	it('refuses an empty payout or one that takes off more than it held', () => {
		expect(payoutProblem({ grossPaise: 0, netPaise: 0 })).toBe('settlement_empty');
		expect(payoutProblem({ grossPaise: 100, netPaise: -1 })).toBe('settlement_net_negative');
		expect(payoutProblem({ grossPaise: 100, netPaise: 0 })).toBeNull();
	});
});

describe('a payout in the books', () => {
	it('posts Bank, charges and their input GST against what the gateway or courier held', () => {
		const payout = { grossPaise: 23_050_600, chargesPaise: 350_000, gstPaise: 63_000, netPaise: 22_637_600 };
		expect(settlementRows('gateway', payout, { id: 'led_hdfc' }, landing)).toEqual([
			{ ledger: { id: 'led_hdfc' }, debitPaise: 22_637_600 },
			{ ledger: { role: 'gateway_charges' }, debitPaise: 350_000 },
			{ ledger: { role: 'input_igst' }, debitPaise: 63_000 },
			{ ledger: { role: 'gateway_clearing' }, creditPaise: 23_050_600 },
		]);
		expect(
			settlementRows(
				'cod',
				{ grossPaise: 500_000, chargesPaise: 0, gstPaise: 0, netPaise: 500_000 },
				{ id: 'led_hdfc' },
				landing,
			),
		).toEqual([
			{ ledger: { id: 'led_hdfc' }, debitPaise: 500_000 },
			{ ledger: { id: 'led_cod_shiprocket' }, creditPaise: 500_000 },
		]);
		expect(
			settlementRows(
				'cod',
				{ grossPaise: 100, chargesPaise: 80, gstPaise: 20, netPaise: 0 },
				{ id: 'b' },
				landing,
			)[0],
		).toEqual({ ledger: { role: 'courier_charges' }, debitPaise: 80 });
	});
});
