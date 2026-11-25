import { describe, expect, it } from 'vitest';

import { cashFlowStatement, ratios } from '../src/reports/cash-flow';

/**
 * Cash flow by the indirect method (AS 3) and the usual ratios (accounts brief U1), from a small set of books worked by
 * hand: the lines always add up to the change in cash.
 */

const group = (id: string, nature: string, parentId: string | null = null, systemKey: string | null = id) => ({
	id,
	systemKey,
	parentId,
	nature,
});
const ledger = (id: string, groupId: string, systemKey: string | null = null) => ({ id, systemKey, groupId });

const chart = {
	groups: [
		group('capital_account', 'liability'),
		group('loans_liability', 'liability'),
		group('secured_loans', 'liability', 'loans_liability'),
		group('fixed_assets', 'asset'),
		group('current_assets', 'asset'),
		group('sundry_debtors', 'asset', 'current_assets'),
		group('stock_in_hand', 'asset', 'current_assets'),
		group('loans_and_advances', 'asset', 'current_assets'),
		group('bank_accounts', 'asset', 'current_assets'),
		group('cash_in_hand', 'asset', 'current_assets'),
		// The shop's own group of tills, under cash in hand: still cash.
		group('tills', 'asset', 'cash_in_hand', null),
		group('current_liabilities', 'liability'),
		group('sundry_creditors', 'liability', 'current_liabilities'),
		// A group of the company's own with nothing placed above it.
		group('misc_assets', 'asset', null, null),
		group('sales_accounts', 'income'),
		group('direct_expenses', 'expense'),
		group('indirect_expenses', 'expense'),
	],
	ledgers: [
		ledger('bank', 'bank_accounts'),
		ledger('till', 'tills'),
		ledger('capital', 'capital_account'),
		ledger('loan', 'secured_loans'),
		ledger('machinery', 'fixed_assets'),
		ledger('accumulated_depreciation', 'fixed_assets'),
		ledger('debtors', 'sundry_debtors'),
		ledger('stock', 'stock_in_hand'),
		ledger('advances', 'loans_and_advances'),
		ledger('creditors', 'sundry_creditors'),
		ledger('deposit', 'misc_assets'),
		// Its group was removed: read as an asset with no place.
		ledger('suspense', 'gone'),
		ledger('sales', 'sales_accounts'),
		ledger('cogs', 'direct_expenses', 'cost_of_goods_sold'),
		ledger('rent', 'indirect_expenses'),
		ledger('depreciation', 'indirect_expenses', 'depreciation'),
	],
};

// The year's opening balances (debit positive, paise), and the closing ones after: credit sales ₹10,000 and cash sales
// ₹300 into a till, ₹8,000 collected, ₹6,000 bought into stock on credit and ₹5,500 of it sold, ₹5,000 paid to
// suppliers, rent ₹1,000, depreciation ₹600, a ₹3,000 machine bought, a ₹2,500 loan taken, ₹500 more capital, a ₹200
// advance to a supplier, a ₹100 deposit, and ₹50 received into suspense.
const opening = {
	bank: 500_000,
	capital: -1_000_000,
	machinery: 400_000,
	accumulated_depreciation: -40_000,
	debtors: 100_000,
	stock: 200_000,
	creditors: -160_000,
};
const closing = {
	bank: 675_000,
	till: 30_000,
	capital: -1_050_000,
	loan: -250_000,
	machinery: 700_000,
	accumulated_depreciation: -100_000,
	debtors: 300_000,
	stock: 250_000,
	advances: 20_000,
	creditors: -260_000,
	deposit: 10_000,
	suspense: -5_000,
	sales: -1_030_000,
	cogs: 550_000,
	rent: 100_000,
	depreciation: 60_000,
};

describe('the cash flow statement', () => {
	const total = (balances: Record<string, number>) => Object.values(balances).reduce((s, v) => s + v, 0);
	const flow = cashFlowStatement(chart, opening, closing);

	it('starts from books that balance', () => {
		expect(total(opening)).toBe(0);
		expect(total(closing)).toBe(0);
	});

	it('adds profit, depreciation back and each working-capital change; the machine bought; owners’ money and the loan', () => {
		expect(flow.lines).toEqual([
			{ section: 'operating', key: 'profit', paise: 320_000 },
			{ section: 'operating', key: 'depreciation', paise: 60_000 },
			{ section: 'operating', key: 'sundry_debtors', paise: -200_000 },
			{ section: 'operating', key: 'stock_in_hand', paise: -50_000 },
			{ section: 'operating', key: 'loans_and_advances', paise: -20_000 },
			{ section: 'operating', key: 'sundry_creditors', paise: 100_000 },
			// The deposit out (−10,000) and the suspense in (+5,000), neither placed.
			{ section: 'operating', key: 'other', paise: -5_000 },
			// The machine bought, net of the depreciation already added back.
			{ section: 'investing', key: 'fixed_assets', paise: -300_000 },
			{ section: 'financing', key: 'capital_account', paise: 50_000 },
			{ section: 'financing', key: 'secured_loans', paise: 250_000 },
		]);
	});

	it('adds up to the change in cash, the till counted as cash', () => {
		expect(flow.sections).toEqual({ operating: 205_000, investing: -300_000, financing: 300_000 });
		expect(flow.netChange).toBe(205_000);
		expect(flow.openingCash).toBe(500_000);
		expect(flow.closingCash).toBe(705_000);
		expect(flow.openingCash + flow.netChange).toBe(flow.closingCash);
	});

	it('nets depreciation booked straight against the asset the same way', () => {
		const direct = {
			...closing,
			machinery: closing.machinery + closing.accumulated_depreciation - opening.accumulated_depreciation,
			accumulated_depreciation: opening.accumulated_depreciation,
		};
		const statement = cashFlowStatement(chart, opening, direct);
		expect(statement.lines.find((l) => l.key === 'fixed_assets')?.paise).toBe(-300_000);
		expect(statement.openingCash + statement.netChange).toBe(statement.closingCash);
	});

	it('keeps the profit line for books that did not move, and nothing else', () => {
		expect(cashFlowStatement(chart, opening, opening)).toEqual({
			lines: [{ section: 'operating', key: 'profit', paise: 0 }],
			sections: { operating: 0, investing: 0, financing: 0 },
			netChange: 0,
			openingCash: 500_000,
			closingCash: 500_000,
		});
		expect(cashFlowStatement({ groups: [], ledgers: [] }, {}, {})).toEqual({
			lines: [{ section: 'operating', key: 'profit', paise: 0 }],
			sections: { operating: 0, investing: 0, financing: 0 },
			netChange: 0,
			openingCash: 0,
			closingCash: 0,
		});
	});

	it('shows investments bought, and a loss', () => {
		const books = {
			groups: [
				group('investments', 'asset'),
				group('bank_accounts', 'asset'),
				group('indirect_expenses', 'expense'),
			],
			ledgers: [
				ledger('fd', 'investments'),
				ledger('bank', 'bank_accounts'),
				ledger('fees', 'indirect_expenses'),
			],
		};
		const statement = cashFlowStatement(books, { bank: 10_000 }, { bank: 2_000, fd: 7_000, fees: 1_000 });
		expect(statement.lines).toEqual([
			{ section: 'operating', key: 'profit', paise: -1_000 },
			{ section: 'investing', key: 'investments', paise: -7_000 },
		]);
		expect(statement.netChange).toBe(-8_000);
	});
});

describe('ratios', () => {
	const ratioChart = {
		groups: [
			group('current_assets', 'asset'),
			group('sundry_debtors', 'asset', 'current_assets'),
			group('stock_in_hand', 'asset', 'current_assets'),
			group('bank_accounts', 'asset', 'current_assets'),
			group('current_liabilities', 'liability'),
			group('sundry_creditors', 'liability', 'current_liabilities'),
			group('duties_and_taxes', 'liability', 'current_liabilities'),
			group('sales_accounts', 'income'),
			group('direct_incomes', 'income'),
			group('direct_expenses', 'expense'),
			group('indirect_incomes', 'income'),
			group('indirect_expenses', 'expense'),
			group('purchase_accounts', 'expense', null, null),
			group('capital_account', 'liability'),
			group('reserves_and_surplus', 'liability'),
			group('loans_liability', 'liability'),
			group('secured_loans', 'liability', 'loans_liability'),
			group('unsecured_loans', 'liability', 'loans_liability'),
			group('bank_od', 'liability'),
		],
		ledgers: [
			ledger('debtors', 'sundry_debtors'),
			ledger('stock', 'stock_in_hand'),
			ledger('bank', 'bank_accounts'),
			ledger('creditors', 'sundry_creditors'),
			ledger('gst', 'duties_and_taxes'),
			ledger('sales', 'sales_accounts'),
			ledger('packing', 'direct_incomes'),
			ledger('cogs', 'direct_expenses', 'cost_of_goods_sold'),
			ledger('interest', 'indirect_incomes'),
			ledger('rent', 'indirect_expenses'),
			ledger('capital', 'capital_account'),
			ledger('reserves', 'reserves_and_surplus'),
			ledger('secured', 'secured_loans'),
			ledger('unsecured', 'unsecured_loans'),
			ledger('od', 'bank_od'),
		],
	};
	const open = { stock: 200_000 };
	const close = {
		debtors: 300_000,
		stock: 250_000,
		bank: 450_000,
		creditors: -260_000,
		gst: -40_000,
		sales: -1_000_000,
		packing: -20_000,
		cogs: 600_000,
		interest: -10_000,
		rent: 100_000,
		capital: -500_000,
		reserves: -100_000,
		secured: -150_000,
		unsecured: -50_000,
		od: 0,
	};

	it('works each ratio out from the year’s figures', () => {
		expect(ratios(ratioChart, open, close, 365)).toMatchObject({
			// ₹10,000 current assets for ₹3,000 owed; without stock ₹7,500.
			currentRatio: 3.33,
			quickRatio: 2.5,
			// Gross ₹4,200 (sales ₹10,000 + packing ₹200 − cost ₹6,000); net ₹3,300 after interest and rent.
			grossMargin: 42,
			netMargin: 33,
			debtorDays: 109.5,
			// No purchases ledger moved: the cost of what was sold stands in.
			creditorDays: 158.17,
			// Cost ₹6,000 over average stock ₹2,250.
			stockTurnover: 2.67,
		});
	});

	it('weighs loans against capital and reserves', () => {
		// Each kind of loan in a group of its own: ₹2,000 of loans against ₹6,000.
		const flat = {
			groups: ratioChart.groups.map((g) => (g.parentId === 'loans_liability' ? { ...g, parentId: null } : g)),
			ledgers: ratioChart.ledgers,
		};
		expect(ratios(flat, open, close, 365).debtEquity).toBe(0.33);
	});

	it('counts a loan once when its group sits inside another loan group, as the default chart nests them', () => {
		// Secured and unsecured loans inside Loans: still ₹2,000 against ₹6,000.
		expect(ratios(ratioChart, open, close, 365).debtEquity).toBe(0.33);
		// Bank overdraft moved inside Loans too, with ₹600 drawn: ₹2,600 against ₹6,000.
		const odInside = {
			groups: ratioChart.groups.map((g) => (g.id === 'bank_od' ? { ...g, parentId: 'loans_liability' } : g)),
			ledgers: ratioChart.ledgers,
		};
		expect(ratios(odInside, open, { ...close, od: -60_000 }, 365).debtEquity).toBe(0.43);
		// Reserves kept inside the owners' group count once as well.
		const reservesInside = {
			groups: ratioChart.groups.map((g) =>
				g.id === 'reserves_and_surplus' ? { ...g, parentId: 'capital_account' } : g,
			),
			ledgers: ratioChart.ledgers,
		};
		expect(ratios(reservesInside, open, close, 365).debtEquity).toBe(0.33);
	});

	it('reads creditor days against purchases when a purchases ledger moved', () => {
		const withPurchases = {
			groups: ratioChart.groups,
			ledgers: [...ratioChart.ledgers, ledger('purchases', 'purchase_accounts', 'purchases')],
		};
		expect(ratios(withPurchases, open, { ...close, purchases: 650_000 }, 365).creditorDays).toBe(146);
	});

	it('leaves a ratio empty when what it divides by is nothing', () => {
		expect(ratios({ groups: [], ledgers: [] }, {}, {}, 365)).toEqual({
			currentRatio: null,
			quickRatio: null,
			grossMargin: null,
			netMargin: null,
			debtorDays: null,
			creditorDays: null,
			stockTurnover: null,
			debtEquity: null,
		});
		const noLiabilities = { ...close, creditors: 0, gst: 0 };
		expect(ratios(ratioChart, open, noLiabilities, 365)).toMatchObject({ currentRatio: null, quickRatio: null });
	});
});

describe('a firm’s sharing of profit (brief 25 YC3)', () => {
	// A firm sells ₹500 for cash; Year close credits the partner ₹120 interest and ₹380 share through the appropriation
	// ledgers (one kept in a sub-group of its own), and the partner draws ₹200 in cash.
	const firm = {
		groups: [
			group('capital_account', 'liability'),
			group('partners_current', 'liability'),
			group('bank_accounts', 'asset'),
			group('sales_accounts', 'income'),
			group('appropriation', 'expense'),
			group('partner_shares', 'expense', 'appropriation', null),
		],
		ledgers: [
			ledger('capital', 'capital_account'),
			ledger('current', 'partners_current'),
			ledger('bank', 'bank_accounts'),
			ledger('sales', 'sales_accounts'),
			ledger('interest_on_capital', 'appropriation'),
			ledger('share_of_profit', 'partner_shares'),
		],
	};
	const before = { bank: 100_000, capital: -100_000 };
	const after = {
		bank: 130_000,
		capital: -100_000,
		current: -30_000,
		sales: -50_000,
		interest_on_capital: 12_000,
		share_of_profit: 38_000,
	};

	it('keeps the profit before sharing and shows only the cash the partner drew as owners’ money', () => {
		const statement = cashFlowStatement(firm, before, after);
		expect(statement.lines).toEqual([
			{ section: 'operating', key: 'profit', paise: 50_000 },
			{ section: 'financing', key: 'partners_current', paise: -20_000 },
		]);
		expect(statement.netChange).toBe(30_000);
		expect(statement.openingCash + statement.netChange).toBe(statement.closingCash);
	});
});
