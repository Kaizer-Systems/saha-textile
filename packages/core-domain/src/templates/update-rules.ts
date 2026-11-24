import type {
	ChartTemplateContent,
	ChartTemplateGroup,
	ChartTemplateLedger,
	KeptChange,
	ReportLine,
	ReportTemplateContent,
	TemplateChanges,
	TemplateContent,
} from '@saha-textile/contracts';

import { PLAYS_NO_ROLE, rolesOf } from '../ledger/roles';
import { chartChanges, ruleSetChanges } from './rules';

import type { ReportBooks } from './report-rules';

/** A chart as the templates the company's kind opens make it (names included). */
export interface TemplateChart {
	groups: readonly ChartTemplateGroup[];
	ledgers: readonly ChartTemplateLedger[];
}

/** AT7: what a report's newer version changes: lines added, removed, renamed, and lines whose place or sources changed. */
export function reportChanges(before: ReportTemplateContent | null, after: ReportTemplateContent): TemplateChanges {
	const old = new Map((before?.lines ?? []).map((line) => [line.key, line]));
	const kept = after.lines.filter((line) => old.has(line.key));
	const was = (line: ReportLine) => old.get(line.key) as ReportLine;
	const facts = (line: ReportLine) => JSON.stringify([line.parentKey, line.sources]);
	return {
		added: after.lines.filter((line) => !old.has(line.key)).map((line) => line.label),
		removed: [...old.values()]
			.filter((line) => !after.lines.some((now) => now.key === line.key))
			.map((line) => line.label),
		renamed: kept.filter((line) => was(line).label !== line.label).map((line) => line.label),
		changed: kept.filter((line) => facts(was(line)) !== facts(line)).map((line) => line.label),
	};
}

/** AT7: what one version changes against another, whatever the template holds. */
export function versionChanges(before: TemplateContent | null, after: TemplateContent): TemplateChanges {
	if (after.kind === 'chart') return chartChanges(before?.kind === 'chart' ? before : null, after);
	if (after.kind === 'taxRules') return ruleSetChanges(before?.kind === 'taxRules' ? before : null, after);
	return reportChanges(before?.kind === 'report' ? before : null, after);
}

/**
 * AT7 "Your own change kept": against a newer version, the names the company changed in its books and the roles it
 * gave to a ledger other than the template's (for a rule set, each entry whose expense goes to the company's own
 * ledger). An update never overrides them.
 */
export function keptChanges(content: TemplateContent, books: ReportBooks, chart: TemplateChart): KeptChange[] {
	const kept: KeptChange[] = [];
	const roleKept = (label: string, role: string): void => {
		const ours = books.ledgers.find((ledger) => rolesOf(ledger).includes(role));
		const theirs = chart.ledgers.find((ledger) =>
			rolesOf({ systemKey: ledger.key, roles: ledger.roles }).includes(role),
		);
		if (ours && ours.systemKey !== (theirs?.key ?? role))
			kept.push({ kind: 'role', label, ours: ours.name, theirs: theirs?.name ?? role });
	};
	if (content.kind === 'chart') {
		const mine = new Map([...books.groups, ...books.ledgers].map((item) => [item.systemKey, item.name]));
		for (const item of [...content.groups, ...content.ledgers]) {
			const name = mine.get(item.key);
			if (name !== undefined && name !== item.name)
				kept.push({ kind: 'name', label: item.name, ours: name, theirs: item.name });
		}
		for (const ledger of content.ledgers)
			for (const role of rolesOf({ systemKey: ledger.key, roles: ledger.roles })) roleKept(ledger.name, role);
	}
	if (content.kind === 'taxRules')
		for (const entry of content.entries) if (entry.expenseRole) roleKept(entry.name, entry.expenseRole);
	return kept;
}

/**
 * AT7 Install for a chart: the groups and ledgers the books don't have yet, by key. Nothing the company has is renamed,
 * moved or removed; a new ledger gives up any role the books already have someone playing (it plays none if that was
 * all it had), so the company's own choices stand.
 */
export function chartInstallPlan(
	content: ChartTemplateContent,
	books: ReportBooks,
): { groups: ChartTemplateGroup[]; ledgers: ChartTemplateLedger[] } {
	const groups = new Set(books.groups.map((group) => group.systemKey));
	const ledgers = new Set(books.ledgers.map((ledger) => ledger.systemKey));
	const played = new Set(books.ledgers.flatMap((ledger) => rolesOf(ledger)));
	return {
		groups: content.groups.filter((group) => !groups.has(group.key)),
		ledgers: content.ledgers
			.filter((ledger) => !ledgers.has(ledger.key))
			.map((ledger) => {
				const wanted = rolesOf({ systemKey: ledger.key, roles: ledger.roles });
				const free = wanted.filter((role) => !played.has(role));
				return free.length === wanted.length
					? ledger
					: { ...ledger, roles: free.length ? free : [PLAYS_NO_ROLE] };
			}),
	};
}
