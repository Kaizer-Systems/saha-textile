import type { CashSheetLine, Denomination } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	CASH_LEDGERS,
	PETTY_GROUP,
	cashMovePosting,
	claimApprovalPosting,
	claimPaymentPosting,
	closeOutcome,
	countOf,
	countingOrder,
	expectedInBox,
	gstInside,
	lineKindOf,
	payeeKey,
	pettyPosting,
	refillOf,
	settlementPosting,
	settlementProblem,
	settlementsFor,
	sheetRows,
	suspenseRelease,
	suspenseUntil,
	withinCashLimit,
	type SettlementInput,
} from '../src/cash/cash-rules';

/** Cash (accounts brief O1–O14) as pure rules. */

const AT = '2026-11-23T04:32:00.000Z';
/** The contract's default grid (O1), repeated here: core tests import contract types only. */
const DEFAULT_DENOMINATIONS: Denomination[] = [
	{ valuePaise: 50_000, kind: 'note', on: true },
	{ valuePaise: 20_000, kind: 'note', on: true },
	{ valuePaise: 10_000, kind: 'note', on: true },
	{ valuePaise: 5_000, kind: 'note', on: true },
	{ valuePaise: 2_000, kind: 'note', on: true },
	{ valuePaise: 1_000, kind: 'note', on: true },
	{ valuePaise: 2_000, kind: 'coin', on: true },
	{ valuePaise: 1_000, kind: 'coin', on: true },
	{ valuePaise: 500, kind: 'coin', on: true },
	{ valuePaise: 200, kind: 'coin', on: true },
	{ valuePaise: 100, kind: 'coin', on: true },
	{ valuePaise: 200_000, kind: 'note', on: false },
	{ valuePaise: 500, kind: 'note', on: false },
	{ valuePaise: 200, kind: 'note', on: false },
	{ valuePaise: 100, kind: 'note', on: false },
];

describe('counting (O2, O5)', () => {
	it('asks for the notes and coins switched on, notes first, largest first', () => {
		const order = countingOrder(DEFAULT_DENOMINATIONS);
		expect(order.map((d) => `${d.kind}${d.valuePaise / 100}`)).toEqual([
			'note500',
			'note200',
			'note100',
			'note50',
			'note20',
			'note10',
			'coin20',
			'coin10',
			'coin5',
			'coin2',
			'coin1',
		]);
		// The comparison holds whichever way round two of a kind arrive.
		expect(
			countingOrder([
				{ valuePaise: 100, kind: 'coin', on: true },
				{ valuePaise: 500, kind: 'note', on: true },
			]).map((d) => d.kind),
		).toEqual(['note', 'coin']);
	});

	it('adds up the float O2 draws (₹2,312) and refuses notes that are switched off or typed twice', () => {
		const rows = [
			{ valuePaise: 50_000, kind: 'note' as const, count: 2 },
			{ valuePaise: 20_000, kind: 'note' as const, count: 2 },
			{ valuePaise: 10_000, kind: 'note' as const, count: 5 },
			{ valuePaise: 5_000, kind: 'note' as const, count: 4 },
			{ valuePaise: 2_000, kind: 'note' as const, count: 5 },
			{ valuePaise: 1_000, kind: 'note' as const, count: 8 },
			{ valuePaise: 2_000, kind: 'coin' as const, count: 0 },
			{ valuePaise: 1_000, kind: 'coin' as const, count: 2 },
			{ valuePaise: 500, kind: 'coin' as const, count: 1 },
			{ valuePaise: 200, kind: 'coin' as const, count: 3 },
			{ valuePaise: 100, kind: 'coin' as const, count: 1 },
			// A switched-off note typed as zero is simply left out.
			{ valuePaise: 200_000, kind: 'note' as const, count: 0 },
		];
		const count = countOf({ rows }, DEFAULT_DENOMINATIONS, AT, 'adm_priya');
		expect(count.totalPaise).toBe(231_200);
		expect(count.rows).toHaveLength(11);
		expect(count.by).toBe('adm_priya');
		expect(() =>
			countOf({ rows: [{ valuePaise: 200_000, kind: 'note', count: 1 }] }, DEFAULT_DENOMINATIONS, AT, null),
		).toThrow('count_unknown_denomination');
		expect(() =>
			countOf(
				{
					rows: [
						{ valuePaise: 50_000, kind: 'note', count: 1 },
						{ valuePaise: 50_000, kind: 'note', count: 2 },
					],
				},
				DEFAULT_DENOMINATIONS,
				AT,
				null,
			),
		).toThrow('count_repeats_a_denomination');
	});

	it('expects the books less every carried difference (O10: ₹2,300 less a ₹300 short)', () => {
		expect(expectedInBox(230_000, [{ sheetId: 's1', date: '2026-11-23', differencePaise: -30_000 }])).toBe(200_000);
		expect(expectedInBox(230_000, [])).toBe(230_000);
	});
});

describe('closing (O5–O7)', () => {
	const base = { expectedPaise: 671_200, autoAcceptUpToPaise: 0 };
	it('closes a count that matches, asks once more, then lets a difference be submitted', () => {
		expect(closeOutcome({ ...base, countedPaise: 671_200, attempt: 1 })).toBe('closed');
		expect(closeOutcome({ ...base, countedPaise: 641_200, attempt: 1 })).toBe('count_again');
		expect(closeOutcome({ ...base, countedPaise: 641_200, attempt: 2 })).toBe('still_off');
		expect(closeOutcome({ ...base, countedPaise: 641_200, attempt: 3 })).toBe('still_off');
	});

	it('closes a difference within the auto-accept limit, either way', () => {
		const loose = { expectedPaise: 100_000, autoAcceptUpToPaise: 500, attempt: 1 };
		expect(closeOutcome({ ...loose, countedPaise: 99_500 })).toBe('closed');
		expect(closeOutcome({ ...loose, countedPaise: 100_500 })).toBe('closed');
		expect(closeOutcome({ ...loose, countedPaise: 99_499 })).toBe('count_again');
	});
});

describe('settling a difference (O8)', () => {
	const input = (patch: Partial<SettlementInput>): SettlementInput => ({
		how: 'write_off',
		differencePaise: -30_000,
		boxLedgerId: 'led_till',
		sheetDate: '2026-11-23',
		today: '2026-11-25',
		ledgerId: null,
		bankLedgerId: null,
		depositDate: null,
		staffUserId: null,
		repayBy: null,
		consent: false,
		policeReport: null,
		insured: false,
		recountPaise: null,
		expectedPaise: 671_200,
		...patch,
	});

	it('offers the ways for a short or for an excess', () => {
		expect(settlementsFor(-1)).toContain('write_off');
		expect(settlementsFor(-1)).not.toContain('excess_suspense');
		expect(settlementsFor(1)).toEqual(['counting_mistake', 'missed_money_in', 'excess_suspense']);
	});

	it('refuses what can’t be settled as asked', () => {
		expect(settlementProblem(input({ differencePaise: 0 }))).toBe('nothing_to_settle');
		expect(settlementProblem(input({ how: 'excess_suspense' }))).toBe('settlement_wrong_direction');
		expect(settlementProblem(input({ how: 'counting_mistake' }))).toBe('recount_required');
		expect(settlementProblem(input({ how: 'counting_mistake', recountPaise: 641_200 }))).toBe(
			'recount_doesnt_match',
		);
		expect(settlementProblem(input({ how: 'counting_mistake', recountPaise: 671_200 }))).toBeNull();
		expect(settlementProblem(input({ how: 'missed_payment_out' }))).toBe('ledger_required');
		expect(settlementProblem(input({ how: 'missed_payment_out', ledgerId: 'led_debtors' }))).toBeNull();
		expect(settlementProblem(input({ how: 'missed_money_in', differencePaise: 500 }))).toBe('ledger_required');
		expect(settlementProblem(input({ how: 'banked_not_recorded' }))).toBe('bank_required');
		expect(settlementProblem(input({ how: 'banked_not_recorded', bankLedgerId: 'led_hdfc' }))).toBe(
			'deposit_date_required',
		);
		expect(
			settlementProblem(
				input({ how: 'banked_not_recorded', bankLedgerId: 'led_hdfc', depositDate: '2026-11-24' }),
			),
		).toBeNull();
		expect(settlementProblem(input({ how: 'recover_from_staff' }))).toBe('staff_required');
		expect(settlementProblem(input({ how: 'recover_from_staff', staffUserId: 'adm_rahul' }))).toBe(
			'repay_by_required',
		);
		expect(
			settlementProblem(input({ how: 'recover_from_staff', staffUserId: 'adm_rahul', repayBy: 'payroll' })),
		).toBe('consent_required');
		expect(
			settlementProblem(
				input({ how: 'recover_from_staff', staffUserId: 'adm_rahul', repayBy: 'payroll', consent: true }),
			),
		).toBeNull();
		expect(
			settlementProblem(input({ how: 'recover_from_staff', staffUserId: 'adm_rahul', repayBy: 'cash' })),
		).toBeNull();
		expect(settlementProblem(input({ how: 'theft' }))).toBe('police_report_required');
		expect(settlementProblem(input({ how: 'theft', policeReport: 'GRH/112/26' }))).toBeNull();
		expect(settlementProblem(input({ how: 'counterfeit' }))).toBeNull();
		expect(settlementProblem(input({ how: 'auto_accepted', differencePaise: 200 }))).toBeNull();
	});

	it('posts each way as the brief’s table says, on its day', () => {
		const box = { id: 'led_till' };
		expect(settlementPosting(input({ how: 'counting_mistake' }))).toBeNull();
		expect(settlementPosting(input({ how: 'cash_found' }))).toBeNull();
		expect(settlementPosting(input({ how: 'missed_payment_out', ledgerId: 'led_debtors' }))).toEqual({
			date: '2026-11-23',
			lines: [
				{ ledger: { id: 'led_debtors' }, debitPaise: 30_000, creditPaise: 0 },
				{ ledger: box, debitPaise: 0, creditPaise: 30_000 },
			],
		});
		expect(
			settlementPosting(input({ how: 'missed_money_in', differencePaise: 5_000, ledgerId: 'led_debtors' })),
		).toEqual({
			date: '2026-11-23',
			lines: [
				{ ledger: box, debitPaise: 5_000, creditPaise: 0 },
				{ ledger: { id: 'led_debtors' }, debitPaise: 0, creditPaise: 5_000 },
			],
		});
		expect(
			settlementPosting(
				input({ how: 'banked_not_recorded', bankLedgerId: 'led_hdfc', depositDate: '2026-11-24' }),
			),
		).toMatchObject({ date: '2026-11-24', lines: [{ ledger: { id: 'led_hdfc' } }, { ledger: box }] });
		const role = (how: SettlementInput['how'], patch: Partial<SettlementInput> = {}) =>
			settlementPosting(input({ how, ...patch }))?.lines[0]?.ledger;
		expect(role('recover_from_staff')).toEqual({ role: 'staff_advance' });
		expect(role('write_off')).toEqual({ role: 'cash_short_over' });
		expect(role('theft')).toEqual({ role: 'loss_by_theft' });
		expect(role('theft', { insured: true })).toEqual({ role: 'insurance_claim_receivable' });
		expect(role('counterfeit')).toEqual({ role: 'counterfeit_loss' });
		expect(settlementPosting(input({ how: 'excess_suspense', differencePaise: 5_000 }))).toEqual({
			date: '2026-11-25',
			lines: [
				{ ledger: box, debitPaise: 5_000, creditPaise: 0 },
				{ ledger: { role: 'cash_over_suspense' }, debitPaise: 0, creditPaise: 5_000 },
			],
		});
		expect(settlementPosting(input({ how: 'auto_accepted', differencePaise: -300 }))?.lines).toEqual([
			{ ledger: { role: 'cash_short_over' }, debitPaise: 300, creditPaise: 0 },
			{ ledger: box, debitPaise: 0, creditPaise: 300 },
		]);
		expect(settlementPosting(input({ how: 'auto_accepted', differencePaise: 300 }))?.lines).toEqual([
			{ ledger: box, debitPaise: 300, creditPaise: 0 },
			{ ledger: { role: 'cash_short_over' }, debitPaise: 0, creditPaise: 300 },
		]);
	});

	it('releases an excess from suspense to other income once its days are up', () => {
		expect(suspenseRelease(5_000)).toEqual([
			{ ledger: { role: 'cash_over_suspense' }, debitPaise: 5_000, creditPaise: 0 },
			{ ledger: { role: 'other_income' }, debitPaise: 0, creditPaise: 5_000 },
		]);
		expect(suspenseUntil('2026-11-25', 30)).toBe('2026-12-25');
		expect(suspenseUntil('2027-03-15', 30)).toBe('2027-04-14');
	});
});

describe('moving cash, petty expenses, refills and claims', () => {
	it('posts a bank deposit, cash from the bank and a move to another box as contras', () => {
		expect(cashMovePosting('bank_deposit', 300_000, 'led_till', 'led_hdfc')).toEqual([
			{ ledger: { id: 'led_hdfc' }, debitPaise: 300_000, creditPaise: 0 },
			{ ledger: { id: 'led_till' }, debitPaise: 0, creditPaise: 300_000 },
		]);
		expect(cashMovePosting('bank_withdrawal', 100_000, 'led_till', 'led_hdfc')).toEqual([
			{ ledger: { id: 'led_till' }, debitPaise: 100_000, creditPaise: 0 },
			{ ledger: { id: 'led_hdfc' }, debitPaise: 0, creditPaise: 100_000 },
		]);
		expect(cashMovePosting('box_move', 50_000, 'led_till', 'led_petty')[0]?.ledger).toEqual({ id: 'led_petty' });
	});

	it('takes the GST out of a bill’s total, within the State or across', () => {
		expect(gstInside(11_800, 18, false)).toEqual({
			taxablePaise: 10_000,
			cgstPaise: 900,
			sgstPaise: 900,
			igstPaise: 0,
		});
		expect(gstInside(11_800, 18, true)).toEqual({
			taxablePaise: 10_000,
			cgstPaise: 0,
			sgstPaise: 0,
			igstPaise: 1_800,
		});
		// An odd paisa of tax goes to SGST.
		expect(gstInside(21, 5, false)).toEqual({ taxablePaise: 20, cgstPaise: 0, sgstPaise: 1, igstPaise: 0 });
		expect(gstInside(1_000, 0, false)).toEqual({ taxablePaise: 1_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
	});

	it('posts a petty expense to its head, with input GST on a GST bill', () => {
		expect(pettyPosting({ headLedgerId: 'led_conv', amountPaise: 12_000, gst: null }, 'led_till')).toEqual([
			{ ledger: { id: 'led_conv' }, debitPaise: 12_000, creditPaise: 0 },
			{ ledger: { id: 'led_till' }, debitPaise: 0, creditPaise: 12_000 },
		]);
		const bill = {
			supplierGstin: '19AAAAA0000A1Z5',
			supplierName: 'Paper House',
			billNumber: 'PH/88',
			billDate: '2026-11-23',
			ratePercent: 18,
		};
		const within = pettyPosting(
			{ headLedgerId: 'led_stat', amountPaise: 11_800, gst: { ...bill, ...gstInside(11_800, 18, false) } },
			'led_till',
		);
		expect(within.map((l) => [l.ledger, l.debitPaise, l.creditPaise])).toEqual([
			[{ id: 'led_stat' }, 10_000, 0],
			[{ role: 'input_cgst' }, 900, 0],
			[{ role: 'input_sgst' }, 900, 0],
			[{ id: 'led_till' }, 0, 11_800],
		]);
		const across = pettyPosting(
			{ headLedgerId: 'led_stat', amountPaise: 11_800, gst: { ...bill, ...gstInside(11_800, 18, true) } },
			'led_till',
		);
		expect(across.map((l) => l.ledger)).toEqual([{ id: 'led_stat' }, { role: 'input_igst' }, { id: 'led_till' }]);
	});

	it('checks the cash limit to one payee in a day, matching names loosely', () => {
		expect(payeeKey('  Bike  Courier Rider ')).toBe('bike courier rider');
		expect(withinCashLimit(0, 12_000, 1_000_000)).toBe(true);
		expect(withinCashLimit(990_000, 12_000, 1_000_000)).toBe(false);
		expect(withinCashLimit(990_000, 10_000, 1_000_000)).toBe(true);
		expect(withinCashLimit(5_000_000, 1, null)).toBe(true);
	});

	it('refills a fixed float back to its amount, with what was spent by head (O13)', () => {
		const spent = [
			{ headLedgerId: 'led_ref', headName: 'Refreshments and staff welfare', amountPaise: 142_000 },
			{ headLedgerId: 'led_conv', headName: 'Local delivery and conveyance', amountPaise: 104_000 },
			{ headLedgerId: 'led_ref', headName: 'Refreshments and staff welfare', amountPaise: 0 },
		];
		const refill = refillOf(500_000, 254_000, spent);
		expect(refill.spentPaise).toBe(246_000);
		expect(refill.refillPaise).toBe(246_000);
		expect(refill.heads).toEqual([
			{ headLedgerId: 'led_ref', name: 'Refreshments and staff welfare', entries: 2, spentPaise: 142_000 },
			{ headLedgerId: 'led_conv', name: 'Local delivery and conveyance', entries: 1, spentPaise: 104_000 },
		]);
		// A box holding more than its float needs nothing.
		expect(refillOf(500_000, 600_000, []).refillPaise).toBe(0);
	});

	it('posts a claim on approval and when it is paid back (O12)', () => {
		expect(claimApprovalPosting('led_conv', 45_000)).toEqual([
			{ ledger: { id: 'led_conv' }, debitPaise: 45_000, creditPaise: 0 },
			{ ledger: { role: 'employee_payable' }, debitPaise: 0, creditPaise: 45_000 },
		]);
		expect(claimPaymentPosting('led_petty', 45_000)).toEqual([
			{ ledger: { role: 'employee_payable' }, debitPaise: 45_000, creditPaise: 0 },
			{ ledger: { id: 'led_petty' }, debitPaise: 0, creditPaise: 45_000 },
		]);
	});
});

describe('the sheet as people see it (O3, O10)', () => {
	const line = (patch: Partial<CashSheetLine>): CashSheetLine => ({
		id: 'ln_1',
		sheetId: 'sh_25',
		boxId: 'box_till',
		at: '2026-11-25T06:50:00.000Z',
		date: '2026-11-25',
		kind: 'counter_sale',
		what: 'Counter sale',
		ref: 'TI/26-27/000160',
		by: 'adm_priya',
		inPaise: 468_000,
		outPaise: 0,
		voucherId: 'jv_1',
		addedOnReview: false,
		...patch,
	});
	const sheet = {
		id: 'sh_25',
		openedAt: '2026-11-25T04:30:00.000Z',
		opening: { rows: [], totalPaise: 200_000, at: '2026-11-25T04:30:00.000Z', by: 'adm_priya' },
		carried: [{ sheetId: 'sh_23', date: '2026-11-23', differencePaise: -30_000 }],
	};
	const labels = { opening: 'Opening float counted', carried: (date: string) => `Carried difference from ${date}` };
	const nameOf = (id: string | null) => (id === 'adm_priya' ? 'Priya Sen' : null);

	it('shows a manager the expected after every row, as O10 draws', () => {
		const rows = sheetRows({ sheet, lines: [line({})], expectedNowPaise: 668_000, amounts: true, nameOf, labels });
		expect(rows.map((r) => [r.kind, r.expectedPaise])).toEqual([
			['opening', 230_000],
			['carried', -30_000],
			['counter_sale', 668_000],
		]);
		expect(rows[0]?.by).toBe('Priya Sen');
		expect(rows[1]?.what).toBe('Carried difference from 2026-11-23');
		expect(rows[2]?.inPaise).toBe(468_000);
	});

	it('shows a cashier what happened and who, never an amount, in time order', () => {
		const rows = sheetRows({
			sheet: { ...sheet, carried: [] },
			lines: [
				line({
					id: 'ln_2',
					at: '2026-11-25T09:00:00.000Z',
					kind: 'petty_expense',
					inPaise: 0,
					outPaise: 12_000,
				}),
				line({ id: 'ln_1' }),
				line({ id: 'ln_0', at: '2026-11-25T09:00:00.000Z', by: 'adm_gone', inPaise: 100 }),
			],
			expectedNowPaise: 0,
			amounts: false,
			nameOf,
			labels,
		});
		expect(rows.map((r) => r.id)).toEqual(['sh_25:opening', 'ln_1', 'ln_0', 'ln_2']);
		expect(rows.every((r) => r.inPaise === null && r.outPaise === null && r.expectedPaise === null)).toBe(true);
		expect(rows[2]?.by).toBeNull();
	});

	it('names each line by what posted it', () => {
		expect(lineKindOf('counterSale', 'document')).toBe('counter_sale');
		expect(lineKindOf('pettyExpense', 'document')).toBe('petty_expense');
		expect(lineKindOf('something', 'receipt')).toBe('receipt');
		expect(lineKindOf('something', 'payment')).toBe('payment');
		expect(lineKindOf('something', 'contra')).toBe('box_move');
		expect(lineKindOf('something', 'journal')).toBe('journal');
	});
});

describe('the ledgers cash needs', () => {
	it('ships the petty heads under their own group, and a ledger for every role a settlement or claim posts to', () => {
		expect(PETTY_GROUP).toMatchObject({
			key: 'petty_expenses',
			parentKey: 'indirect_expenses',
			roles: ['petty_expenses'],
		});
		const heads = CASH_LEDGERS.filter((l) => l.groupKey === 'petty_expenses').map((l) => l.name);
		expect(heads).toContain('Stationery and printing');
		expect(heads).toHaveLength(8);
		const roles = CASH_LEDGERS.flatMap((l) => l.roles);
		expect(roles).toEqual(['loss_by_theft', 'counterfeit_loss', 'insurance_claim_receivable', 'employee_payable']);
	});
});
