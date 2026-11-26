import type { MoneyLanding, SettlementKind, SettlementRowWrite } from '@saha-textile/contracts';

import { receiptLanding, type LedgerRef, type MoneyRow } from '../ledger/money-postings';

/**
 * Settlements (accounts brief Q10, D27). Pure: a payout file's rows grouped into its payouts, and a payout's posting:
 * Bank for what reached it, the gateway's or courier's charges and the input GST on them, against what the gateway
 * (Gateway clearing) or the courier (COD receivable) was holding for the shop.
 */

/** A gateway payment no payout has paid this many days after it came in is flagged. */
export const UNSETTLED_AFTER_DAYS = 7;
/** How far back that check looks. */
export const UNSETTLED_LOOKBACK_DAYS = 90;

export interface Payout {
	payoutReference: string;
	date: string;
	rows: SettlementRowWrite[];
	grossPaise: number;
	chargesPaise: number;
	gstPaise: number;
	netPaise: number;
}

/** The file's rows as payouts, one per payout reference, dated by its latest row, oldest first. */
export function payoutsOf(rows: readonly SettlementRowWrite[]): Payout[] {
	const byReference = new Map<string, Payout>();
	for (const row of rows) {
		const payout = byReference.get(row.payoutReference) ?? {
			payoutReference: row.payoutReference,
			date: row.date,
			rows: [],
			grossPaise: 0,
			chargesPaise: 0,
			gstPaise: 0,
			netPaise: 0,
		};
		payout.rows.push(row);
		if (row.date > payout.date) payout.date = row.date;
		payout.grossPaise += row.grossPaise;
		payout.chargesPaise += row.chargesPaise;
		payout.gstPaise += row.gstPaise;
		payout.netPaise = payout.grossPaise - payout.chargesPaise - payout.gstPaise;
		byReference.set(row.payoutReference, payout);
	}
	return [...byReference.values()].sort(
		(a, b) => a.date.localeCompare(b.date) || a.payoutReference.localeCompare(b.payoutReference),
	);
}

/** Why a payout can't be posted: nothing in it, or more taken off than it held. */
export function payoutProblem(payout: Pick<Payout, 'grossPaise' | 'netPaise'>): string | null {
	if (payout.grossPaise <= 0) return 'settlement_empty';
	return payout.netPaise < 0 ? 'settlement_net_negative' : null;
}

/**
 * Q10's posting: Bank Dr (net) · charges Dr · input GST on charges Dr (IGST: gateways and couriers bill from another
 * State) · Gateway clearing or COD receivable Cr (gross), each where "Where money lands" put it.
 */
export function settlementRows(
	kind: SettlementKind,
	payout: Pick<Payout, 'grossPaise' | 'chargesPaise' | 'gstPaise' | 'netPaise'>,
	bank: LedgerRef,
	landing: MoneyLanding,
): MoneyRow[] {
	const held = receiptLanding(kind === 'gateway' ? 'gateway' : 'cashOnDelivery', landing) as LedgerRef;
	const rows: MoneyRow[] = [
		{ ledger: bank, debitPaise: payout.netPaise },
		{
			ledger: { role: kind === 'gateway' ? 'gateway_charges' : 'courier_charges' },
			debitPaise: payout.chargesPaise,
		},
		{ ledger: { role: 'input_igst' }, debitPaise: payout.gstPaise },
		{ ledger: held, creditPaise: payout.grossPaise },
	];
	return rows.filter((row) => (row.debitPaise ?? 0) + (row.creditPaise ?? 0) > 0);
}
