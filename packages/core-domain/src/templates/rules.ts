import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	ChartTemplateGroup,
	ChartTemplateLedger,
	TaxRuleEntry,
	TaxRuleSetContent,
	TemplateChanges,
	TemplateVersion,
} from '@saha-textile/contracts';

import { ROLE_REGISTRY, missingRoles, rolesOf } from '../ledger/roles';

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

/** Templates with at least one version: one only drafted in the builder is used by nothing yet. */
export function published<T extends Pick<AccountsTemplate, 'versions'>>(templates: readonly T[]): T[] {
	return templates.filter((t) => t.versions.length > 0);
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

/**
 * What the shipped starter templates add to a library: the templates it lacks, and newer starter versions of templates
 * no person has published a version of. A person's own versions are never mixed with shipped ones; a newer version is
 * only offered as an update and installed by a person (AT-D5).
 */
export function starterChanges(
	stored: readonly AccountsTemplate[],
	starters: readonly AccountsTemplate[],
): { inserts: AccountsTemplate[]; updates: { template: AccountsTemplate; expectedUpdatedAt: string }[] } {
	const byCode = new Map(stored.map((template) => [template.code, template]));
	const inserts = starters.filter((starter) => !byCode.has(starter.code));
	const updates = starters.flatMap((starter) => {
		const mine = byCode.get(starter.code);
		if (!mine || mine.versions.some((v) => v.publishedBy !== null)) return [];
		const newest = latestVersion(mine).version;
		const newer = starter.versions.filter((v) => v.version > newest);
		if (!newer.length) return [];
		return [
			{
				template: { ...mine, versions: [...mine.versions, ...newer], updatedAt: starter.updatedAt },
				expectedUpdatedAt: mine.updatedAt,
			},
		];
	});
	return { inserts, updates };
}

/** The entries of a tax rule set that apply to a kind of company on a day (each entry has its own kinds and dates). */
export function entriesOn(entries: readonly TaxRuleEntry[], kind: BusinessKind, day: string): TaxRuleEntry[] {
	return entries.filter(
		(entry) =>
			(entry.kinds === null || entry.kinds.includes(kind)) &&
			entry.from <= day &&
			(entry.to === null || entry.to >= day),
	);
}

/** AT1 "What opens": for a kind of company, the templates it unlocks by type, with the newest version of each. */
export interface WhatOpens {
	charts: { code: string; name: string; version: number }[];
	taxRules: { code: string; name: string; version: number; entries: number }[];
	reports: { code: string; name: string; version: number }[];
	/** Templates of other kinds that stay locked (listed greyed in Accounts templates). */
	locked: number;
}

export function whatOpens(templates: readonly AccountsTemplate[], kind: BusinessKind, day: string): WhatOpens {
	const opens: WhatOpens = { charts: [], taxRules: [], reports: [], locked: 0 };
	for (const template of published(templates)) {
		if (lockState(template, kind).locked) {
			opens.locked += 1;
			continue;
		}
		const latest = latestVersion(template);
		const row = { code: template.code, name: template.name, version: latest.version };
		if (latest.content.kind === 'taxRules')
			opens.taxRules.push({ ...row, entries: entriesOn(latest.content.entries, kind, day).length });
		else if (latest.content.kind === 'chart') opens.charts.push(row);
		else opens.reports.push(row);
	}
	return opens;
}

const KINDS: readonly BusinessKind[] = [
	'proprietorship',
	'partnership',
	'llp',
	'private_limited_opc',
	'private_limited',
];
const DOCUMENT_TYPES = [...new Set(ROLE_REGISTRY.flatMap((role) => role.neededBy))];

/** A chart template's groups and ledgers as role holders (a key plays its own role unless roles are listed). */
const holders = (items: readonly { key: string; roles: readonly string[] }[]) =>
	items.map((item) => ({ id: item.key, systemKey: item.key, roles: item.roles }));

/** The kinds of company a template is for. */
const kindsOf = (template: Pick<AccountsTemplate, 'appliesTo'>): readonly BusinessKind[] =>
	template.appliesTo.all ? KINDS : template.appliesTo.kinds;

/**
 * The chart a kind of company opens: every published chart template it unlocks except `code`, with `extra` added, as
 * role holders. Refused like `mergeCharts` when the charts don't fit together.
 */
function chartFor(
	kind: BusinessKind,
	library: readonly AccountsTemplate[],
	code: string,
	extra: readonly ChartTemplateContent[],
) {
	const others = published(unlockedFor(library, kind))
		.filter((t) => t.code !== code)
		.map((t) => latestVersion(t).content)
		.filter((c): c is ChartTemplateContent => c.kind === 'chart');
	const merged = mergeCharts([...others, ...extra]);
	return { groups: holders(merged.groups), ledgers: holders(merged.ledgers) };
}

/**
 * AT5's publishing checks for a tax rule set: entry keys are unique, no entry ends before it starts, an entry names only
 * kinds the set applies to, and every expense role an entry posts to has a ledger in the chart of each kind it applies to.
 */
export function ruleSetProblems(
	template: Pick<AccountsTemplate, 'code' | 'appliesTo'>,
	content: TaxRuleSetContent,
	library: readonly AccountsTemplate[],
): string[] {
	const problems = new Set<string>();
	const seen = new Set<string>();
	for (const entry of content.entries) {
		if (seen.has(entry.key)) problems.add(`template_duplicate_key:${entry.key}`);
		seen.add(entry.key);
		if (entry.to !== null && entry.to < entry.from) problems.add(`template_entry_dates:${entry.key}`);
		if (!template.appliesTo.all && entry.kinds?.some((kind) => !template.appliesTo.kinds.includes(kind)))
			problems.add(`template_entry_kind:${entry.key}`);
	}
	for (const kind of kindsOf(template)) {
		const roles = new Set(
			content.entries.flatMap((entry) =>
				entry.expenseRole && (entry.kinds === null || entry.kinds.includes(kind)) ? [entry.expenseRole] : [],
			),
		);
		if (!roles.size) continue;
		let chart: ReturnType<typeof chartFor>;
		try {
			chart = chartFor(kind, library, template.code, []);
		} catch (error) {
			problems.add((error as Error).message);
			continue;
		}
		const played = new Set(chart.ledgers.flatMap((ledger) => rolesOf(ledger)));
		for (const role of roles) if (!played.has(role)) problems.add(`template_role_missing:${role}:${kind}`);
	}
	return [...problems];
}

/**
 * AT3's publishing checks: the draft is of the template's type and starts after the newest version; for a chart, with
 * every other chart template each kind it applies to opens, the merged chart is whole, every role a document needs has a
 * ledger (or group), and no role is played twice; a tax rule set passes AT5's checks (`ruleSetProblems`). Codes the
 * admin puts in words.
 */
export function publishProblems(template: AccountsTemplate, library: readonly AccountsTemplate[]): string[] {
	const draft = template.draft;
	if (!draft) return ['template_no_draft'];
	const problems = new Set<string>();
	if (draft.content.kind !== template.kind) problems.add('template_wrong_kind');
	if (template.versions.length && draft.validFrom <= latestVersion(template).validFrom)
		problems.add('template_dates_overlap');
	if (draft.content.kind === 'taxRules') return [...problems, ...ruleSetProblems(template, draft.content, library)];
	if (draft.content.kind !== 'chart') return [...problems];
	const content = draft.content;
	for (const kind of kindsOf(template)) {
		let chart: ReturnType<typeof chartFor>;
		try {
			chart = chartFor(kind, library, template.code, [content]);
		} catch (error) {
			problems.add((error as Error).message);
			continue;
		}
		for (const type of DOCUMENT_TYPES)
			for (const role of missingRoles(chart, type)) problems.add(`template_role_missing:${role}:${kind}`);
		const played = new Map<string, number>();
		for (const role of chart.ledgers.flatMap((ledger) => rolesOf(ledger)))
			played.set(role, (played.get(role) ?? 0) + 1);
		for (const [role, count] of played) if (count > 1) problems.add(`template_role_ambiguous:${role}`);
	}
	return [...problems];
}

/** AT3 "Changes from vN": what the draft adds, removes and renames against the newest version, by key. */
export function chartChanges(before: ChartTemplateContent | null, after: ChartTemplateContent): TemplateChanges {
	const items = (c: ChartTemplateContent | null) =>
		new Map([...(c?.groups ?? []), ...(c?.ledgers ?? [])].map((item) => [item.key, item.name]));
	const old = items(before);
	const now = items(after);
	return {
		added: [...now].filter(([key]) => !old.has(key)).map(([, name]) => name),
		removed: [...old].filter(([key]) => !now.has(key)).map(([, name]) => name),
		renamed: [...now].filter(([key, name]) => old.has(key) && old.get(key) !== name).map(([, name]) => name),
		changed: [],
	};
}

/**
 * AT5 "Compare with vN": the rule set entries the draft adds, removes and renames against the newest version, by key,
 * and those whose code, rate, expense role, kinds, dates, source or CA review state changed.
 */
export function ruleSetChanges(before: TaxRuleSetContent | null, after: TaxRuleSetContent): TemplateChanges {
	const old = new Map((before?.entries ?? []).map((entry) => [entry.key, entry]));
	const facts = (entry: TaxRuleEntry) =>
		JSON.stringify([
			entry.code,
			entry.ratePercent,
			entry.expenseRole,
			entry.kinds,
			entry.from,
			entry.to,
			entry.source,
			entry.caReview,
		]);
	const kept = after.entries.filter((entry) => old.has(entry.key));
	const was = (entry: TaxRuleEntry) => old.get(entry.key) as TaxRuleEntry;
	return {
		added: after.entries.filter((entry) => !old.has(entry.key)).map((entry) => entry.name),
		removed: [...old.values()]
			.filter((entry) => !after.entries.some((now) => now.key === entry.key))
			.map((entry) => entry.name),
		renamed: kept.filter((entry) => was(entry).name !== entry.name).map((entry) => entry.name),
		changed: kept.filter((entry) => facts(was(entry)) !== facts(entry)).map((entry) => entry.name),
	};
}

/** AT3 Publish: the draft becomes the next version (pending CA review) and the draft is cleared. */
export function publishDraft(template: AccountsTemplate, by: string | null, now: string): AccountsTemplate {
	const draft = template.draft;
	if (!draft) return template;
	const next: TemplateVersion = {
		version: template.versions.length ? latestVersion(template).version + 1 : 1,
		validFrom: draft.validFrom,
		validTo: null,
		source: draft.source,
		caReview: 'pending',
		notes: draft.notes,
		content: draft.content,
		publishedAt: now,
		publishedBy: by,
	};
	const versions = template.versions.map((v) =>
		v.validTo === null && v.validFrom < draft.validFrom ? { ...v, validTo: dayBefore(draft.validFrom) } : v,
	);
	return { ...template, versions: [...versions, next], draft: null, updatedAt: now };
}

/** The day before a day: an older version ends the day before the newer one starts. */
function dayBefore(day: string): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
