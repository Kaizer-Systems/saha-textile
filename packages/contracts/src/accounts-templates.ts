import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { BusinessKind } from './company';
import { AccountNature, RoleKey } from './ledger';
import { IsoDate } from './purchasing';

/**
 * Accounts templates (owner-approved 2026-11-24): charts of accounts, tax rule sets and report layouts are data made in a
 * builder, saved with a reference code and dated versions, and unlocked by the kind of company. Shared templates open for
 * every kind; exclusive ones only for theirs. Locked templates stay visible, greyed, with the reason (AT-D2).
 */

export const TemplateKind = z.enum(['chart', 'taxRules', 'report']);
export type TemplateKind = z.infer<typeof TemplateKind>;

/** CH-COMMON, CH-PROP, RS-RCM, RP-NCE-BS… */
export const TemplateCode = z.string().regex(/^[A-Z]{2}-[A-Z0-9-]{2,30}$/);
export type TemplateCode = z.infer<typeof TemplateCode>;

/** Shared (every kind) or exclusive to the kinds listed. */
export const AppliesTo = z.object({ all: z.boolean(), kinds: z.array(BusinessKind).default([]) });
export type AppliesTo = z.infer<typeof AppliesTo>;

const Key = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);

export const ChartTemplateGroup = z.object({
	key: Key,
	name: z.string().trim().min(1).max(120),
	parentKey: Key.nullable().default(null),
	nature: AccountNature,
	tradingAccount: z.boolean().default(false),
	roles: z.array(RoleKey).default([]),
});
export type ChartTemplateGroup = z.infer<typeof ChartTemplateGroup>;

export const ChartTemplateLedger = z.object({
	key: Key,
	name: z.string().trim().min(1).max(120),
	groupKey: Key,
	/** False: only documents post here. */
	handPosting: z.boolean().default(true),
	roles: z.array(RoleKey).default([]),
	/** A tax rule set this ledger follows (AT3's "Rule set link"), by its code. */
	ruleSetCode: TemplateCode.nullable().default(null),
	/** The law or guidance the ledger follows (AT3's "Source"). */
	source: z.string().trim().max(300).default(''),
});
export type ChartTemplateLedger = z.infer<typeof ChartTemplateLedger>;

export const ChartTemplateContent = z.object({
	kind: z.literal('chart'),
	groups: z.array(ChartTemplateGroup).default([]),
	ledgers: z.array(ChartTemplateLedger).default([]),
});
export type ChartTemplateContent = z.infer<typeof ChartTemplateContent>;

/** One entry of a tax rule set (the reverse-charge list, TDS sections…), dated and sourced. */
export const TaxRuleEntry = z.object({
	key: Key,
	name: z.string().trim().min(1).max(200),
	/** SAC or HSN, or a section number for TDS. */
	code: z.string().trim().max(20).default(''),
	ratePercent: z.number().min(0).max(100),
	/** The role the expense posts to (a self-invoice's expense ledger). */
	expenseRole: RoleKey.nullable().default(null),
	/** The kinds it applies to; null = every kind the rule set applies to. */
	kinds: z.array(BusinessKind).nullable().default(null),
	from: IsoDate,
	to: IsoDate.nullable().default(null),
	source: z.string().trim().max(300).default(''),
	/** AT5's "CA review" tag: every rule stays pending until the CA confirms it (AT-D6). */
	caReview: z.enum(['pending', 'reviewed']).default('pending'),
	/** TDS sections and limits (AT5b, AT5c): the amount in rupees, and what it counts (a payment, a month, a year). */
	limitINR: z.number().nonnegative().nullable().default(null),
	limitPer: z.enum(['payment', 'month', 'year']).nullable().default(null),
	/**
	 * Return due dates (RS-DUE): which return, under which scheme, for which States (none = all), due on `day` of the
	 * month `monthsAfter` the period. With `period`, a one-off extension for that month only, which wins over the rule.
	 */
	due: z
		.object({
			returnType: z.enum(['GSTR-1', 'GSTR-3B', 'GSTR-9']),
			scheme: z.enum(['monthly', 'qrmp']).nullable().default(null),
			day: z.number().int().min(1).max(31),
			monthsAfter: z.number().int().min(1).max(12).default(1),
			states: z.array(z.string().regex(/^\d{2}$/)).max(40).default([]),
			period: z
				.string()
				.regex(/^\d{4}-(0[1-9]|1[0-2])$/)
				.nullable()
				.default(null),
		})
		.nullable()
		.default(null),
});
export type TaxRuleEntry = z.infer<typeof TaxRuleEntry>;

/** What a tax rule set lists (AT5-D1): its columns follow it, and it is fixed once the set is published. */
export const TaxRuleList = z.enum(['reverseCharge', 'tds', 'limits', 'dueDates']);
export type TaxRuleList = z.infer<typeof TaxRuleList>;

export const TaxRuleSetContent = z.object({
	kind: z.literal('taxRules'),
	list: TaxRuleList.default('reverseCharge'),
	entries: z.array(TaxRuleEntry).default([]),
});
export type TaxRuleSetContent = z.infer<typeof TaxRuleSetContent>;

/** What a report line adds up: the ledgers playing a role, every ledger under a group, or one ledger, by key. */
export const ReportSource = z.object({ kind: z.enum(['role', 'group', 'ledger']), key: Key });
export type ReportSource = z.infer<typeof ReportSource>;

/**
 * One line of a report (AT6 "Lines"): its own sources plus the lines under it. Income and expense ledgers count their
 * movement for the year, every other ledger its closing balance; a line holding any liability, equity or income reads
 * credit balances as positive.
 */
export const ReportLine = z.object({
	key: Key,
	label: z.string().trim().min(1).max(160),
	parentKey: Key.nullable().default(null),
	sources: z.array(ReportSource).default([]),
});
export type ReportLine = z.infer<typeof ReportLine>;

/** A report's layout (AT6): its lines and the drawn settings (columns, a note per line, the ICAI level). */
export const ReportTemplateContent = z.object({
	kind: z.literal('report'),
	columns: z.enum(['thisYear', 'thisAndLast']).default('thisAndLast'),
	/** "Notes: one per line": each line lists the ledgers behind it. */
	notes: z.boolean().default(false),
	/** Non-corporate statements' level (ICAI Level I–IV), or worked out from turnover and borrowings. */
	level: z.enum(['auto', 'I', 'II', 'III', 'IV']).nullable().default(null),
	lines: z.array(ReportLine).default([]),
});
export type ReportTemplateContent = z.infer<typeof ReportTemplateContent>;

export const TemplateContent = z.discriminatedUnion('kind', [
	ChartTemplateContent,
	TaxRuleSetContent,
	ReportTemplateContent,
]);
export type TemplateContent = z.infer<typeof TemplateContent>;

export const TemplateVersion = z.object({
	version: z.number().int().positive(),
	validFrom: IsoDate,
	validTo: IsoDate.nullable().default(null),
	/** The law or guidance it follows. */
	source: z.string().trim().max(500).default(''),
	caReview: z.enum(['pending', 'reviewed']).default('pending'),
	notes: z.string().trim().max(1000).default(''),
	content: TemplateContent,
	publishedAt: IsoDateTime,
	publishedBy: Id.nullable().default(null),
});
export type TemplateVersion = z.infer<typeof TemplateVersion>;

/** The builder's working copy (AT3 Save draft); Publish turns it into the next version. */
export const TemplateDraft = z.object({
	content: TemplateContent,
	validFrom: IsoDate,
	source: z.string().trim().max(500).default(''),
	notes: z.string().trim().max(1000).default(''),
	savedAt: IsoDateTime,
	savedBy: Id.nullable().default(null),
});
export type TemplateDraft = z.infer<typeof TemplateDraft>;

export const AccountsTemplate = z.object({
	id: Id,
	code: TemplateCode,
	kind: TemplateKind,
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).default(''),
	appliesTo: AppliesTo,
	/** Empty for a template made in the builder and not yet published: nothing uses it until it has a version. */
	versions: z.array(TemplateVersion),
	draft: TemplateDraft.nullable().default(null),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type AccountsTemplate = z.infer<typeof AccountsTemplate>;

/** Which version of a template the company's books were installed from. */
export const TemplateInstall = z.object({
	code: TemplateCode,
	version: z.number().int().positive(),
	installedAt: IsoDateTime,
	installedBy: Id.nullable().default(null),
});
export type TemplateInstall = z.infer<typeof TemplateInstall>;

/** Settings › Accounts templates (AT2): every template with whether this company's kind unlocks it. */
export const TemplateLibraryRow = AccountsTemplate.omit({ versions: true, draft: true }).extend({
	/** Null while the template has only a draft. */
	latestVersion: z.number().int().positive().nullable(),
	/** The newest version's first day and CA review state (AT2's Version column). */
	validFrom: IsoDate.nullable(),
	caReview: TemplateVersion.shape.caReview.nullable(),
	hasDraft: z.boolean(),
	locked: z.boolean(),
	lockReason: z.enum(['not_this_kind']).nullable(),
	installedVersion: z.number().int().positive().nullable(),
	updateAvailable: z.boolean(),
});
export type TemplateLibraryRow = z.infer<typeof TemplateLibraryRow>;

/** AT1: what the kind of company chosen at setup opens. */
export const TemplatesOpenQuery = z.object({ kind: BusinessKind });
export type TemplatesOpenQuery = z.infer<typeof TemplatesOpenQuery>;

const OpenTemplate = z.object({ code: TemplateCode, name: z.string(), version: z.number().int().positive() });

export const TemplatesOpen = z.object({
	charts: z.array(OpenTemplate),
	taxRules: z.array(OpenTemplate.extend({ entries: z.number().int().nonnegative() })),
	reports: z.array(OpenTemplate),
	/** Templates of other kinds, listed greyed. */
	locked: z.number().int().nonnegative(),
	/** The books are installed: the kind is changed only through Convert (AT-D3). */
	booksSetUp: z.boolean(),
});
export type TemplatesOpen = z.infer<typeof TemplatesOpen>;

/** AT2 New template: a code, a type, who it applies to, and optionally an existing template's newest version to start from. */
export const TemplateNew = z.object({
	code: TemplateCode,
	kind: TemplateKind,
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).default(''),
	appliesTo: AppliesTo,
	startFrom: TemplateCode.nullable().default(null),
	/** A tax rule set's list (AT5-D1), chosen here and fixed after; other types leave it. */
	list: TaxRuleList.default('reverseCharge'),
});
export type TemplateNew = z.infer<typeof TemplateNew>;

/** AT3 Save draft. */
export const TemplateDraftWrite = TemplateDraft.pick({
	content: true,
	validFrom: true,
	source: true,
	notes: true,
}).extend({
	expectedUpdatedAt: IsoDateTime,
});
export type TemplateDraftWrite = z.infer<typeof TemplateDraftWrite>;

/** AT3 Publish vN. */
export const TemplatePublish = z.object({ expectedUpdatedAt: IsoDateTime });
export type TemplatePublish = z.infer<typeof TemplatePublish>;

/** AT3 "Changes from vN": keys added, removed and renamed between the newest version and the draft. */
export const TemplateChanges = z.object({
	added: z.array(z.string()),
	removed: z.array(z.string()),
	renamed: z.array(z.string()),
	/** AT5 "Compare with vN": rule set entries whose code, rate, role, kinds, dates, source or review state changed. */
	changed: z.array(z.string()).default([]),
});
export type TemplateChanges = z.infer<typeof TemplateChanges>;

/** AT4: a role the engine posts to, who plays it in this company's books, and the template that set it. */
export const RoleRow = z.object({
	key: RoleKey,
	target: z.enum(['ledger', 'group']),
	usedBy: z.array(z.string()),
	holderId: Id.nullable(),
	holderName: z.string().nullable(),
	fromTemplate: z.string().nullable(),
	problem: z.enum(['missing', 'ambiguous']).nullable(),
});
export type RoleRow = z.infer<typeof RoleRow>;

/** AT4: a super admin points a ledger role at another ledger. */
export const RolePoint = z.object({ ledgerId: Id });
export type RolePoint = z.infer<typeof RolePoint>;

/** AT6 "Preview with this company": the report as the books stand on a day, with the year before beside it. */
export const ReportPreviewQuery = z.object({ asAt: IsoDate.optional() });
export type ReportPreviewQuery = z.infer<typeof ReportPreviewQuery>;

const PreviewFigure = z.object({ thisYearPaise: z.number().int(), lastYearPaise: z.number().int().nullable() });

export const ReportPreviewRow = PreviewFigure.extend({
	key: Key,
	label: z.string(),
	depth: z.number().int().nonnegative(),
	side: z.enum(['debit', 'credit']),
	/** The ledgers behind the line, when the report has a note per line. */
	ledgers: z.array(PreviewFigure.extend({ name: z.string() })),
});
export type ReportPreviewRow = z.infer<typeof ReportPreviewRow>;

export const ReportPreview = z.object({
	asAt: IsoDate,
	/** The last column's day, or null when the report shows this year only. */
	lastAsAt: IsoDate.nullable(),
	rows: z.array(ReportPreviewRow),
	/** Sources the books don't have, as `report_source_unknown:<kind>:<key>`. */
	problems: z.array(z.string()),
});
export type ReportPreview = z.infer<typeof ReportPreview>;

/** AT7 "Your own change kept": a name the company changed, or a role it gave to a ledger of its own. */
export const KeptChange = z.object({
	kind: z.enum(['name', 'role']),
	/** The template's item, or the rule set entry whose expense goes elsewhere. */
	label: z.string(),
	/** What the company's books have. */
	ours: z.string(),
	/** What the template has. */
	theirs: z.string(),
});
export type KeptChange = z.infer<typeof KeptChange>;

/** AT7 "Update available": a newer version than the one installed, what it changes and what of the company's is kept. */
export const TemplateUpdate = z.object({
	code: TemplateCode,
	name: z.string(),
	kind: TemplateKind,
	installedVersion: z.number().int().positive(),
	version: z.number().int().positive(),
	/** The day the newer version applies from ("Install from 1 Dec 2026"); documents dated before keep theirs. */
	validFrom: IsoDate,
	changes: TemplateChanges,
	kept: z.array(KeptChange),
});
export type TemplateUpdate = z.infer<typeof TemplateUpdate>;

/** AT7 Install: the version the person saw, so a newer one published meanwhile is never installed unseen. */
export const TemplateInstallWrite = z.object({ version: z.number().int().positive() });
export type TemplateInstallWrite = z.infer<typeof TemplateInstallWrite>;
