import { AccountGroup, Ledger, type ChartOfAccounts, type ChartTemplateContent } from '@saha-textile/contracts';
import { chartInstallPlan, type GeneralLedgerRepository } from '@saha-textile/core-domain';

/**
 * Adds a chart template's groups and ledgers the books lack, by key (accounts templates AT7, and T3 setting up the
 * books over a chart read before the kind was chosen). Nothing of the company's is renamed, moved or removed. Returns
 * the names of what was added.
 */
export async function addChartItems(
	books: Pick<GeneralLedgerRepository, 'saveGroup' | 'saveLedger'>,
	content: ChartTemplateContent,
	chart: ChartOfAccounts,
	at: string,
): Promise<string[]> {
	const plan = chartInstallPlan(content, chart);
	const groupIds = new Map(chart.groups.map((group) => [String(group.systemKey), group.id]));
	const natures = new Map([
		...chart.groups.map((group) => [String(group.systemKey), group.nature] as const),
		...content.groups.map((group) => [group.key, group.nature] as const),
	]);
	for (const [index, group] of plan.groups.entries()) {
		const id = `grp_${group.key}`;
		await books.saveGroup(
			AccountGroup.parse({
				id,
				systemKey: group.key,
				name: group.name,
				parentId: group.parentKey ? (groupIds.get(group.parentKey) ?? `grp_${group.parentKey}`) : null,
				nature: group.nature,
				tradingAccount: group.tradingAccount,
				roles: group.roles,
				order: chart.groups.length + index,
				createdAt: at,
				updatedAt: at,
			}),
		);
		groupIds.set(group.key, id);
	}
	// A ledger's group is in the books or this content (publishing checks the chart is whole).
	for (const ledger of plan.ledgers)
		await books.saveLedger(
			Ledger.parse({
				id: `led_${ledger.key}`,
				systemKey: ledger.key,
				name: ledger.name,
				groupId: groupIds.get(ledger.groupKey),
				nature: natures.get(ledger.groupKey),
				handPosting: ledger.handPosting,
				roles: ledger.roles,
				createdAt: at,
				updatedAt: at,
			}),
			null,
		);
	return [...plan.groups, ...plan.ledgers].map((item) => item.name);
}
