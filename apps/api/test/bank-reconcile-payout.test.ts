import type { BankLine } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ReconcileService } from '../src/banks/reconcile.service';

/** A payout's bank reference (UTR) lets reconciling match its bank line (accounts brief Q10, BA7). */

const at = '2026-11-28T06:00:00.000Z';
const period = { from: '2026-11-01', to: '2026-11-30' };

const line = (id: string, over: Partial<BankLine> = {}): BankLine => ({
	id,
	bankAccountId: 'bank_1',
	date: '2026-11-23',
	description: 'NEFT CR CCAVENUE PAYOUT',
	reference: '',
	outPaise: 0,
	inPaise: 146_460,
	balancePaise: null,
	key: `k_${id}`,
	importId: 'imp_1',
	status: 'unmatched',
	match: null,
	rejectedKeys: [],
	createdAt: at,
	...over,
});

interface Voucher {
	id: string;
	number: string;
	date: string;
	narration: string;
	source: { type: string; id: string; number: string | null } | null;
	lines: { ledgerId: string; debitPaise: number; creditPaise: number }[];
}
const voucher = (id: string, inPaise: number, over: Partial<Voucher> = {}): Voucher => ({
	id,
	number: `JV/${id}`,
	date: '2026-11-22',
	narration: 'CCAvenue payout AXISN2026112200123',
	source: null,
	lines: [
		{ ledgerId: 'led_bank', debitPaise: inPaise, creditPaise: 0 },
		{ ledgerId: 'led_clearing', debitPaise: 0, creditPaise: inPaise },
	],
	...over,
});

function build(lines: BankLine[], vouchers: Voucher[]) {
	const payments = { findById: vi.fn(async (_id: string) => null) };
	const service = new ReconcileService(
		{
			rules: async () => [],
			inPeriod: async (accountId: string, from: string, to: string) =>
				lines.filter((l) => l.bankAccountId === accountId && l.date >= from && l.date <= to),
			heldVoucherIds: async () => new Set<string>(),
		} as never,
		{
			get: async (id: string) => (id === 'bank_1' ? { id, ledgerId: 'led_bank', locationId: null } : null),
		} as never,
		{
			statementLines: async (ledgerId: string, from: string, to: string) =>
				vouchers
					.filter((v) => v.date >= from && v.date <= to)
					.flatMap((v) =>
						v.lines
							.filter((l) => l.ledgerId === ledgerId)
							.map((l) => ({
								voucherId: v.id,
								number: v.number,
								date: v.date,
								narration: v.narration,
								...l,
							})),
					),
			getVoucher: async (id: string) => vouchers.find((v) => v.id === id) ?? null,
			balanceBefore: async () => 0,
		} as never,
		payments as never,
		{ list: async () => [] } as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({}) } as never,
		{ append: vi.fn(async () => undefined) } as never,
		{ post: vi.fn() } as never,
	);
	return { service, payments };
}

describe('reconciling a payout’s bank line (Q10)', () => {
	it('matches the line carrying a payout’s UTR by the gateway reference rule; a payout with no number gives no reference', async () => {
		const { service, payments } = build(
			[
				line('l_payout', { reference: 'AXISN2026112200123' }),
				line('l_cod', { description: 'NEFT CR 7781 REMIT', inPaise: 5_000 }),
			],
			[
				voucher('jv_payout', 146_460, {
					source: { type: 'settlement', id: 'stl_1', number: 'AXISN2026112200123' },
				}),
				voucher('jv_cod', 5_000, {
					narration: 'Courier remittance',
					source: { type: 'settlement', id: 'stl_2', number: null },
				}),
			],
		);
		const suggested = await service.view('bank_1', { ...period, tab: 'suggested' });
		expect(suggested.counts).toEqual({ suggested: 1, unmatched: 1, accepted: 0 });
		expect(suggested.sure).toBe(1);
		expect(
			suggested.items.map((i) => [i.id, i.match?.why, i.match?.sure, i.entries.map((e) => e.voucherId)]),
		).toEqual([['l_payout', 'gateway_ref', true, ['jv_payout']]]);
		const unmatched = await service.view('bank_1', { ...period, tab: 'unmatched' });
		expect(unmatched.items.map((i) => i.id)).toEqual(['l_cod']);
		// A payout's reference is its own: no order payment is looked up for it.
		expect(payments.findById).not.toHaveBeenCalled();
	});
});
