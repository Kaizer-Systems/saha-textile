import type { AccountNature, BusinessKind } from '@saha-textile/contracts';

/**
 * The chart of accounts a new set of books starts with (accounts brief Q1, CT6; owner-approved 2026-11-23): the
 * usual Indian primary groups, the ledgers the posting rules need, and the owners' accounts the kind of business
 * calls for. Names are data the owner may rename; posting rules find ledgers by `systemKey`, never by name.
 */

export interface ChartGroupSeed {
	systemKey: string;
	name: string;
	parentKey: string | null;
	nature: AccountNature;
	tradingAccount?: boolean;
}

export interface ChartLedgerSeed {
	systemKey: string;
	name: string;
	groupKey: string;
	/** False: only documents post here (Q1: system ledgers can't be posted to by hand). */
	handPosting: boolean;
}

const OWNERS_GROUP: Record<BusinessKind, string> = {
	proprietorship: 'Capital account',
	partnership: "Partners' capital",
	llp: "Partners' contribution",
	private_limited_opc: 'Share capital',
	private_limited: 'Share capital',
};

const isCompany = (kind: BusinessKind): boolean => kind === 'private_limited' || kind === 'private_limited_opc';

export function defaultChart(kind: BusinessKind): { groups: ChartGroupSeed[]; ledgers: ChartLedgerSeed[] } {
	const groups: ChartGroupSeed[] = [
		{ systemKey: 'capital_account', name: OWNERS_GROUP[kind], parentKey: null, nature: 'equity' },
		...(isCompany(kind)
			? [
					{
						systemKey: 'reserves_and_surplus',
						name: 'Reserves and surplus',
						parentKey: null,
						nature: 'equity' as const,
					},
				]
			: []),
		...(kind === 'partnership' || kind === 'llp'
			? [
					{
						systemKey: 'partners_current',
						name: "Partners' current accounts",
						parentKey: null,
						nature: 'equity' as const,
					},
				]
			: []),
		{ systemKey: 'loans_liability', name: 'Loans', parentKey: null, nature: 'liability' },
		{ systemKey: 'secured_loans', name: 'Secured loans', parentKey: 'loans_liability', nature: 'liability' },
		{ systemKey: 'unsecured_loans', name: 'Unsecured loans', parentKey: 'loans_liability', nature: 'liability' },
		{
			systemKey: 'bank_od',
			name: 'Bank overdraft and cash credit',
			parentKey: 'loans_liability',
			nature: 'liability',
		},
		{ systemKey: 'current_liabilities', name: 'Current liabilities', parentKey: null, nature: 'liability' },
		{
			systemKey: 'duties_and_taxes',
			name: 'Duties and taxes',
			parentKey: 'current_liabilities',
			nature: 'liability',
		},
		{ systemKey: 'sundry_creditors', name: 'Suppliers', parentKey: 'current_liabilities', nature: 'liability' },
		{ systemKey: 'provisions', name: 'Provisions', parentKey: 'current_liabilities', nature: 'liability' },
		{ systemKey: 'fixed_assets', name: 'Fixed assets', parentKey: null, nature: 'asset' },
		{ systemKey: 'investments', name: 'Investments', parentKey: null, nature: 'asset' },
		{ systemKey: 'current_assets', name: 'Current assets', parentKey: null, nature: 'asset' },
		{ systemKey: 'cash_in_hand', name: 'Cash in hand', parentKey: 'current_assets', nature: 'asset' },
		{ systemKey: 'bank_accounts', name: 'Bank accounts', parentKey: 'current_assets', nature: 'asset' },
		{ systemKey: 'stock_in_hand', name: 'Stock in hand', parentKey: 'current_assets', nature: 'asset' },
		{ systemKey: 'sundry_debtors', name: 'Customers', parentKey: 'current_assets', nature: 'asset' },
		{ systemKey: 'loans_and_advances', name: 'Loans and advances', parentKey: 'current_assets', nature: 'asset' },
		{ systemKey: 'branch_divisions', name: 'Branches', parentKey: null, nature: 'asset' },
		{ systemKey: 'sales_accounts', name: 'Sales', parentKey: null, nature: 'income', tradingAccount: true },
		{
			systemKey: 'direct_incomes',
			name: 'Direct incomes',
			parentKey: null,
			nature: 'income',
			tradingAccount: true,
		},
		{
			systemKey: 'direct_expenses',
			name: 'Direct expenses',
			parentKey: null,
			nature: 'expense',
			tradingAccount: true,
		},
		{ systemKey: 'indirect_incomes', name: 'Indirect incomes', parentKey: null, nature: 'income' },
		{ systemKey: 'indirect_expenses', name: 'Indirect expenses', parentKey: null, nature: 'expense' },
		{ systemKey: 'suspense_account', name: 'Suspense', parentKey: null, nature: 'liability' },
	];

	const ledgers: ChartLedgerSeed[] = [
		{ systemKey: 'cash', name: 'Cash', groupKey: 'cash_in_hand', handPosting: true },
		{ systemKey: 'petty_cash', name: 'Petty cash', groupKey: 'cash_in_hand', handPosting: true },
		{
			systemKey: 'gateway_clearing',
			name: 'Payment gateway clearing',
			groupKey: 'current_assets',
			handPosting: false,
		},
		{
			systemKey: 'upi_card_clearing',
			name: 'UPI and card clearing',
			groupKey: 'current_assets',
			handPosting: false,
		},
		{
			systemKey: 'cod_receivable',
			name: 'Cash on delivery with couriers',
			groupKey: 'current_assets',
			handPosting: false,
		},
		{ systemKey: 'stock_in_hand', name: 'Stock in hand', groupKey: 'stock_in_hand', handPosting: false },
		{ systemKey: 'stock_in_transit', name: 'Stock in transit', groupKey: 'stock_in_hand', handPosting: false },
		{ systemKey: 'debtors_control', name: 'Customers', groupKey: 'sundry_debtors', handPosting: false },
		{ systemKey: 'staff_advance', name: 'Staff advances', groupKey: 'loans_and_advances', handPosting: true },
		{ systemKey: 'branch_account', name: 'Branch account', groupKey: 'branch_divisions', handPosting: false },
		{ systemKey: 'input_cgst', name: 'Input CGST', groupKey: 'duties_and_taxes', handPosting: false },
		{ systemKey: 'input_sgst', name: 'Input SGST', groupKey: 'duties_and_taxes', handPosting: false },
		{ systemKey: 'input_igst', name: 'Input IGST', groupKey: 'duties_and_taxes', handPosting: false },
		{
			systemKey: 'input_gst_rcm',
			name: 'Input GST (reverse charge)',
			groupKey: 'duties_and_taxes',
			handPosting: false,
		},
		{ systemKey: 'output_cgst', name: 'Output CGST', groupKey: 'duties_and_taxes', handPosting: false },
		{ systemKey: 'output_sgst', name: 'Output SGST', groupKey: 'duties_and_taxes', handPosting: false },
		{ systemKey: 'output_igst', name: 'Output IGST', groupKey: 'duties_and_taxes', handPosting: false },
		{
			systemKey: 'rcm_payable',
			name: 'GST payable on reverse charge',
			groupKey: 'duties_and_taxes',
			handPosting: false,
		},
		{ systemKey: 'gst_payable', name: 'GST payable', groupKey: 'duties_and_taxes', handPosting: false },
		{ systemKey: 'tds_payable', name: 'TDS payable', groupKey: 'duties_and_taxes', handPosting: true },
		{
			systemKey: 'customer_advances',
			name: 'Customer advances',
			groupKey: 'current_liabilities',
			handPosting: false,
		},
		{ systemKey: 'creditors_control', name: 'Suppliers', groupKey: 'sundry_creditors', handPosting: false },
		{ systemKey: 'sales', name: 'Sales', groupKey: 'sales_accounts', handPosting: false },
		{ systemKey: 'sales_returns', name: 'Sales returns', groupKey: 'sales_accounts', handPosting: false },
		{
			systemKey: 'branch_transfer_sales',
			name: 'Branch transfer sales',
			groupKey: 'sales_accounts',
			handPosting: false,
		},
		{
			systemKey: 'cost_of_goods_sold',
			name: 'Cost of goods sold',
			groupKey: 'direct_expenses',
			handPosting: false,
		},
		{ systemKey: 'courier_charges', name: 'Courier charges', groupKey: 'direct_expenses', handPosting: true },
		{
			systemKey: 'gateway_charges',
			name: 'Payment gateway charges',
			groupKey: 'indirect_expenses',
			handPosting: true,
		},
		{ systemKey: 'bank_charges', name: 'Bank charges', groupKey: 'indirect_expenses', handPosting: true },
		{ systemKey: 'rent', name: 'Rent', groupKey: 'indirect_expenses', handPosting: true },
		{ systemKey: 'salaries', name: 'Salaries', groupKey: 'indirect_expenses', handPosting: true },
		{ systemKey: 'depreciation', name: 'Depreciation', groupKey: 'indirect_expenses', handPosting: false },
		{
			systemKey: 'stock_loss',
			name: 'Stock lost, damaged and written off',
			groupKey: 'indirect_expenses',
			handPosting: false,
		},
		{
			systemKey: 'cash_short_over',
			name: 'Cash short and over',
			groupKey: 'indirect_expenses',
			handPosting: false,
		},
		{ systemKey: 'rounding_off', name: 'Rounding off', groupKey: 'indirect_expenses', handPosting: false },
		{
			systemKey: 'exchange_difference',
			name: 'Exchange gain or loss',
			groupKey: 'indirect_incomes',
			handPosting: false,
		},
		{ systemKey: 'other_income', name: 'Other income', groupKey: 'indirect_incomes', handPosting: true },
		{
			systemKey: 'cash_over_suspense',
			name: 'Cash over (suspense)',
			groupKey: 'suspense_account',
			handPosting: false,
		},
		{
			systemKey: 'profit_and_loss',
			name: 'Profit and loss account',
			groupKey: isCompany(kind) ? 'reserves_and_surplus' : 'capital_account',
			handPosting: false,
		},
		...(kind === 'proprietorship'
			? [
					{ systemKey: 'capital', name: 'Capital', groupKey: 'capital_account', handPosting: true },
					{ systemKey: 'drawings', name: 'Drawings', groupKey: 'capital_account', handPosting: true },
				]
			: []),
		...(isCompany(kind)
			? [
					{
						systemKey: 'share_capital',
						name: 'Equity share capital',
						groupKey: 'capital_account',
						handPosting: true,
					},
				]
			: []),
	];
	return { groups, ledgers };
}
