import type { BankAccountKind, ChartTemplateLedger } from '@saha-textile/contracts';

/**
 * Bank accounts (accounts brief BA1–BA3). Pure: where each kind sits in the chart, the opening balance's posting, the
 * bank an IFSC names, and a masked account number.
 */

/** A cash credit or an overdraft is money owed to the bank: it sits under the bank overdraft group (Loans). */
export function bankGroupFor(kind: BankAccountKind): 'bank_accounts' | 'bank_od' {
	return kind === 'cash_credit' || kind === 'overdraft' ? 'bank_od' : 'bank_accounts';
}

/**
 * The opening balance on its day: money in the account debits it, an overdrawn or borrowed balance credits it; the other
 * side is Opening balance difference, cleared when the rest of the opening balances are in.
 */
export function openingPosting(
	openingINR: number,
): Array<{ role: 'bank' | 'opening_balance_difference'; debitPaise?: number; creditPaise?: number }> {
	const paise = Math.round(Math.abs(openingINR) * 100);
	if (!paise) return [];
	return openingINR > 0
		? [
				{ role: 'bank', debitPaise: paise },
				{ role: 'opening_balance_difference', creditPaise: paise },
			]
		: [
				{ role: 'opening_balance_difference', debitPaise: paise },
				{ role: 'bank', creditPaise: paise },
			];
}

/** "•••• 4821". */
export function maskedNumber(number: string): string {
	return `•••• ${number.slice(-4)}`;
}

/** The banks most accounts are with, by the first four letters of their IFSC; anything else is typed. */
export const IFSC_BANKS: Readonly<Record<string, string>> = {
	SBIN: 'State Bank of India',
	HDFC: 'HDFC Bank',
	ICIC: 'ICICI Bank',
	UTIB: 'Axis Bank',
	KKBK: 'Kotak Mahindra Bank',
	PUNB: 'Punjab National Bank',
	BARB: 'Bank of Baroda',
	CNRB: 'Canara Bank',
	UBIN: 'Union Bank of India',
	BKID: 'Bank of India',
	IDIB: 'Indian Bank',
	IOBA: 'Indian Overseas Bank',
	UCBA: 'UCO Bank',
	CBIN: 'Central Bank of India',
	MAHB: 'Bank of Maharashtra',
	PSIB: 'Punjab & Sind Bank',
	YESB: 'Yes Bank',
	INDB: 'IndusInd Bank',
	IDFB: 'IDFC FIRST Bank',
	FDRL: 'Federal Bank',
	RATN: 'RBL Bank',
	BDBL: 'Bandhan Bank',
	AUBL: 'AU Small Finance Bank',
	DBSS: 'DBS Bank India',
	SCBL: 'Standard Chartered Bank',
	HSBC: 'HSBC',
	CITI: 'Citibank',
	KARB: 'Karnataka Bank',
	SIBL: 'South Indian Bank',
	CSBK: 'CSB Bank',
};

export function ifscBank(ifsc: string): string | null {
	return IFSC_BANKS[ifsc.trim().toUpperCase().slice(0, 4)] ?? null;
}

/** Shared chart v5: where a bank's interest goes, and the other side of opening balances typed in one by one. */
export const BANK_LEDGERS: ChartTemplateLedger[] = [
	{
		key: 'interest_received',
		name: 'Interest received',
		groupKey: 'indirect_incomes',
		handPosting: true,
		roles: ['interest_received'],
		ruleSetCode: null,
		source: '',
	},
	{
		key: 'opening_balance_difference',
		name: 'Opening balance difference',
		groupKey: 'suspense_account',
		handPosting: false,
		roles: ['opening_balance_difference'],
		ruleSetCode: null,
		source: '',
	},
];
