import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	ChartTemplateGroup,
	ChartTemplateLedger,
	TemplateVersion,
} from '@saha-textile/contracts';

/** AT1, AT2: a template is open for a kind of company when it is shared or lists that kind; otherwise locked, with why. */
export function lockState(
	template: Pick<AccountsTemplate, 'appliesTo'>,
	kind: BusinessKind,
): { locked: boolean; lockReason: 'not_this_kind' | null } {
	const open = template.appliesTo.all || template.appliesTo.kinds.includes(kind);
	return open ? { locked: false, lockReason: null } : { locked: true, lockReason: 'not_this_kind' };
}

/** The newest version of a template. */
export function latestVersion(template: Pick<AccountsTemplate, 'versions'>): TemplateVersion {
	return template.versions.reduce((best, v) => (v.version > best.version ? v : best));
}

/** The version in force on a day (law changes are new dated versions; past documents keep theirs). */
export function versionOn(template: Pick<AccountsTemplate, 'versions'>, day: string): TemplateVersion | null {
	const inForce = template.versions.filter((v) => v.validFrom <= day && (v.validTo === null || v.validTo >= day));
	return inForce.length ? inForce.reduce((best, v) => (v.version > best.version ? v : best)) : null;
}

/** The templates a kind of company opens, in library order (shared first). */
export function unlockedFor<T extends Pick<AccountsTemplate, 'appliesTo'>>(
	templates: readonly T[],
	kind: BusinessKind,
): T[] {
	return [...templates]
		.filter((t) => !lockState(t, kind).locked)
		.sort((a, b) => Number(b.appliesTo.all) - Number(a.appliesTo.all));
}

/**
 * The chart a company's books start from: its shared and exclusive chart templates together. Refused with
 * `template_duplicate_key:<key>` when two templates define the same group or ledger, and with
 * `template_unknown_parent:<key>` / `template_unknown_group:<key>` when one points at a group none of them has.
 */
export function mergeCharts(contents: readonly ChartTemplateContent[]): {
	groups: ChartTemplateGroup[];
	ledgers: ChartTemplateLedger[];
} {
	const groups = contents.flatMap((c) => c.groups);
	const ledgers = contents.flatMap((c) => c.ledgers);
	const seen = new Set<string>();
	for (const key of [...groups.map((g) => `g:${g.key}`), ...ledgers.map((l) => `l:${l.key}`)]) {
		if (seen.has(key)) throw new Error(`template_duplicate_key:${key.slice(2)}`);
		seen.add(key);
	}
	const groupKeys = new Set(groups.map((g) => g.key));
	const orphan = groups.find((g) => g.parentKey !== null && !groupKeys.has(g.parentKey));
	if (orphan) throw new Error(`template_unknown_parent:${orphan.key}`);
	const lost = ledgers.find((l) => !groupKeys.has(l.groupKey));
	if (lost) throw new Error(`template_unknown_group:${lost.key}`);
	return { groups, ledgers };
}
