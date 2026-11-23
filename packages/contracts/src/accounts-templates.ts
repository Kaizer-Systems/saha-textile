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
});
export type TaxRuleEntry = z.infer<typeof TaxRuleEntry>;

export const TaxRuleSetContent = z.object({ kind: z.literal('taxRules'), entries: z.array(TaxRuleEntry).default([]) });
export type TaxRuleSetContent = z.infer<typeof TaxRuleSetContent>;

/** A report's layout (filled in by the report builder, step T6). */
export const ReportTemplateContent = z.object({
	kind: z.literal('report'),
	lines: z.array(z.record(z.string(), z.unknown())).default([]),
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

export const AccountsTemplate = z.object({
	id: Id,
	code: TemplateCode,
	kind: TemplateKind,
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).default(''),
	appliesTo: AppliesTo,
	versions: z.array(TemplateVersion).min(1),
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
export const TemplateLibraryRow = AccountsTemplate.omit({ versions: true }).extend({
	latestVersion: z.number().int().positive(),
	locked: z.boolean(),
	lockReason: z.enum(['not_this_kind']).nullable(),
	installedVersion: z.number().int().positive().nullable(),
	updateAvailable: z.boolean(),
});
export type TemplateLibraryRow = z.infer<typeof TemplateLibraryRow>;
