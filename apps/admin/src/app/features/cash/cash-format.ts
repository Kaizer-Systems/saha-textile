import { rupees } from '@features/accounts/ledger-helpers';

import type { CashSettlementHow, Denomination, DenominationKind } from '@saha-textile/contracts';

/**
 * Cash's words and numbers on the admin side (accounts brief O): note and coin names, rupees typed into paise, and
 * the ways a manager may settle a short or an excess. The settlement lists repeat the core's (the admin imports only
 * contract types; a spec holds them equal).
 */

/** "₹500 note", "₹20 coin". */
export function denominationLabel(d: { valuePaise: number; kind: DenominationKind }, word: string): string {
	return `₹${(d.valuePaise / 100).toLocaleString('en-IN')} ${word}`;
}

/** The notes and coins a count asks for, notes first, largest first (as O2 and O5 draw them). */
export function countingOrder(denominations: readonly Denomination[]): Denomination[] {
	return denominations
		.filter((d) => d.on)
		.sort((a, b) => (a.kind === b.kind ? b.valuePaise - a.valuePaise : a.kind === 'note' ? -1 : 1));
}

/** Rupees as typed ("1,20.50", "120") in paise; null when it isn't a positive amount. */
export function paiseOf(typed: string): number | null {
	const value = Number(typed.replace(/[,\s₹]/g, ''));
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.round(value * 100);
}

export const SHORT_SETTLEMENTS: readonly CashSettlementHow[] = [
	'counting_mistake',
	'missed_payment_out',
	'cash_found',
	'banked_not_recorded',
	'recover_from_staff',
	'write_off',
	'theft',
	'counterfeit',
];
export const EXCESS_SETTLEMENTS: readonly CashSettlementHow[] = [
	'counting_mistake',
	'missed_money_in',
	'excess_suspense',
];

/** O8 lists all ten in this order; those for the other direction are shown but can't be picked. */
export const ALL_SETTLEMENTS: readonly Exclude<CashSettlementHow, 'auto_accepted'>[] = [
	'counting_mistake',
	'missed_payment_out',
	'missed_money_in',
	'cash_found',
	'banked_not_recorded',
	'recover_from_staff',
	'write_off',
	'theft',
	'counterfeit',
	'excess_suspense',
];

export function settlementApplies(how: CashSettlementHow, differencePaise: number): boolean {
	return (differencePaise < 0 ? SHORT_SETTLEMENTS : EXCESS_SETTLEMENTS).includes(how);
}

/** The status pill class each sheet status takes (the theme's own pills). */
export const SHEET_PILL: Record<string, string> = {
	open: 'status-pending',
	closed: 'status-success',
	difference: 'status-danger',
	settled: 'status-success',
};

/** "10:02": a moment's time of day in India. */
export function istTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'Asia/Kolkata',
	});
}

/** "-₹300.00" for a short, as O10 and O11 draw it (the shared rupees() leaves the sign to its caller). */
export function signedRupees(paise: number): string {
	return paise < 0 ? `-${rupees(-paise)}` : rupees(paise);
}
