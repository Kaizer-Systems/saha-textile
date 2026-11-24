import type { AccountGroup, ChartOfAccounts, Ledger } from '@saha-textile/contracts';
import { rolesOf } from '@saha-textile/core-domain';

/**
 * Where cash meets the chart of accounts: the group a box's ledger lives under, the bank ledgers money moves to and
 * from, and the petty expense heads (accounts brief O). Each is found by the role its group plays, never by name.
 */

/** Whether a group, or any group above it, plays a role. */
export function groupPlays(groups: readonly AccountGroup[], groupId: string, role: string): boolean {
	const byId = new Map(groups.map((g) => [g.id, g]));
	const seen = new Set<string>();
	for (let at = byId.get(groupId); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
		seen.add(at.id);
		if (rolesOf(at).includes(role)) return true;
	}
	return false;
}

/** The active ledgers under groups playing a role. */
export function ledgersUnder(chart: ChartOfAccounts, role: string): Ledger[] {
	return chart.ledgers.filter((l) => l.active && groupPlays(chart.groups, l.groupId, role));
}

/** A bank or overdraft ledger. */
export function isBank(chart: ChartOfAccounts, ledgerId: string): boolean {
	return [...ledgersUnder(chart, 'bank_accounts'), ...ledgersUnder(chart, 'bank_od')].some((l) => l.id === ledgerId);
}

/** The group a new box's ledger goes under: the one playing "cash in hand". */
export function cashGroup(chart: ChartOfAccounts): AccountGroup | null {
	return chart.groups.find((g) => rolesOf(g).includes('cash_in_hand')) ?? null;
}

/** A person's name as the admin shows it, or null for someone it no longer knows. */
export function personName(
	user: { displayName?: string | null; email?: string | null; username?: string | null } | null,
): string | null {
	return user?.displayName || user?.email || user?.username || null;
}

/** The two-digit State code of a GSTIN. */
export const stateOf = (gstin: string): string => gstin.slice(0, 2);
