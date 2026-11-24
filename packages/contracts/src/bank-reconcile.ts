import { z } from 'zod';

import { BankLine } from './bank-statement';
import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Reconciling a bank account (accounts brief BA7, BA8, BA10): each statement line matched to entries in the books,
 * first as a draft the app suggests by its matching rules, final only when a person accepts it.
 */

/** BA10 "When the line": a reference the books hold, the amount and party, or words in the line. */
export const MatchWhen = z.enum(['gateway_ref', 'upi_ref', 'amount_party', 'words']);
export type MatchWhen = z.infer<typeof MatchWhen>;

/** BA10 "Then": match the entry, suggest it, make a bank-charge or interest entry, or leave it for a person. */
export const MatchThen = z.enum(['match', 'suggest', 'bank_charge', 'interest', 'leave']);
export type MatchThen = z.infer<typeof MatchThen>;

export const MatchRuleWrite = z.object({
	id: Id.nullable().default(null),
	when: MatchWhen,
	/** For "words": any of these in the line's description (case ignored). */
	words: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
	/** Only on money coming in (interest on a deposit). */
	onlyIn: z.boolean().default(false),
	then: MatchThen,
	/** A bank-charge entry's GST rate, included in the line's amount. */
	gstPercent: z.number().nonnegative().max(28).nullable().default(null),
	on: z.boolean().default(true),
});
export type MatchRuleWrite = z.infer<typeof MatchRuleWrite>;

export const MatchRule = MatchRuleWrite.extend({
	id: Id,
	/** Rules are tried in this order; the app's own rules come first and can be turned off, not removed. */
	order: z.number().int().nonnegative(),
	builtIn: z.boolean(),
	updatedAt: IsoDateTime,
});
export type MatchRule = z.infer<typeof MatchRule>;

/** An entry in the books a line is or could be matched to, as the reconcile screens show it. */
export const BookEntry = z.object({
	voucherId: Id,
	number: z.string(),
	date: IsoDate,
	narration: z.string(),
	/** Money into the bank (its debit) or out of it (its credit), in paise. */
	inPaise: z.number().int().nonnegative(),
	outPaise: z.number().int().nonnegative(),
});
export type BookEntry = z.infer<typeof BookEntry>;

export const ReconcileTab = z.enum(['suggested', 'unmatched', 'accepted']);
export type ReconcileTab = z.infer<typeof ReconcileTab>;

export const ReconcileQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	tab: ReconcileTab.default('suggested'),
});
export type ReconcileQuery = z.infer<typeof ReconcileQuery>;

export const ReconcileRow = BankLine.extend({ entries: z.array(BookEntry) });
export type ReconcileRow = z.infer<typeof ReconcileRow>;

export const ReconcileView = z.object({
	items: z.array(ReconcileRow),
	counts: z.record(ReconcileTab, z.number().int().nonnegative()),
	/** Suggestions marked sure, which "Accept all sure matches" takes. */
	sure: z.number().int().nonnegative(),
});
export type ReconcileView = z.infer<typeof ReconcileView>;

/** BA8: link a line to entries of the books (one, or several that add up to it). */
export const BankLineLink = z.object({ voucherIds: z.array(Id).min(1).max(50) });
export type BankLineLink = z.infer<typeof BankLineLink>;

/** BA8 "Find what it pays": entries on the account not matched yet, by words or amount. */
export const BookEntryQuery = z.object({ q: z.string().trim().max(80).default('') });
export type BookEntryQuery = z.infer<typeof BookEntryQuery>;

/** The period the person is looking at: Accept, Reject and Accept all act on the suggestions shown for it. */
export const ReconcilePeriod = z.object({ from: IsoDate, to: IsoDate });
export type ReconcilePeriod = z.infer<typeof ReconcilePeriod>;
