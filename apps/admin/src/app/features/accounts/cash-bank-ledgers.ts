import type { ChartOfAccounts, Ledger } from '@saha-textile/contracts';

const CASH_OR_BANK = ['cash_in_hand', 'bank_accounts', 'bank_od'];

/** Money can be paid out of these: active ledgers whose group, or a group above it, is cash in hand or a bank. */
export function cashAndBankLedgers(chart: ChartOfAccounts | undefined): Ledger[] {
	if (!chart) return [];
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const isCashOrBank = (groupId: string | null): boolean => {
		const group = groupId ? groups.get(groupId) : undefined;
		if (!group) return false;
		return CASH_OR_BANK.includes(group.systemKey ?? '') || isCashOrBank(group.parentId);
	};
	return chart.ledgers.filter((l) => l.active && isCashOrBank(l.groupId));
}
