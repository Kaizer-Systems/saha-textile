import type { ChartOfAccounts, Ledger } from '@saha-textile/contracts';

const CASH_OR_BANK = ['cash_in_hand', 'bank_accounts', 'bank_od'];
const BANK = ['bank_accounts', 'bank_od'];

/** Active ledgers whose group, or a group above it, has one of these system keys. */
function ledgersUnder(chart: ChartOfAccounts | undefined, keys: readonly string[]): Ledger[] {
	if (!chart) return [];
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const isUnder = (groupId: string | null): boolean => {
		const group = groupId ? groups.get(groupId) : undefined;
		if (!group) return false;
		return keys.includes(group.systemKey ?? '') || isUnder(group.parentId);
	};
	return chart.ledgers.filter((l) => l.active && isUnder(l.groupId));
}

/** Money can be paid out of these: active ledgers whose group, or a group above it, is cash in hand or a bank. */
export function cashAndBankLedgers(chart: ChartOfAccounts | undefined): Ledger[] {
	return ledgersUnder(chart, CASH_OR_BANK);
}

/** A bank transfer, UPI or cheque is paid from one of these (D3's "Paid from" when the books have several). */
export function bankLedgers(chart: ChartOfAccounts | undefined): Ledger[] {
	return ledgersUnder(chart, BANK);
}
