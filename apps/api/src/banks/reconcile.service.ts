import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	BankAccount,
	BankLine,
	BankLineLink,
	BookEntry,
	Brs,
	BrsItem,
	BrsRowKind,
	MatchRule,
	MatchRuleWrite,
	ReconcilePeriod,
	ReconcileQuery,
	ReconcileTab,
	ReconcileView,
} from '@saha-textile/contracts';
import {
	BUILT_IN_RULES,
	defaultStockLocation,
	istDay,
	normalText,
	ruleEntryRows,
	ruleProblem,
	suggestMatch,
	type AuditLogRepository,
	type BankRepository,
	type BankStatementRepository,
	type Candidate,
	type GeneralLedgerRepository,
	type LocationRepository,
	type OrderPaymentRepository,
	type Suggestion,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	AUDIT_LOG_REPOSITORY,
	BANK_REPOSITORY,
	BANK_STATEMENT_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/** Entries this many days either side of the period can match its lines (a cheque clears days after it is written). */
const WINDOW_DAYS = 7;
/** How far back "Find what it pays" looks. */
const SEARCH_DAYS = 180;
/** The app's own rules carry this date until someone changes them. */
const BUILT_IN_SINCE = '2026-11-24T00:00:00.000Z';

const shift = (day: string, days: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Found = Suggestion | { kind: 'entries'; voucherIds: string[]; why: string; sure: boolean; ruleId: null };

function matchOf(found: Found, by: string | null, at: string | null): NonNullable<BankLine['match']> {
	return found.kind === 'entries'
		? {
				voucherIds: found.voucherIds,
				why: found.why,
				sure: found.sure,
				by,
				at,
				entry: null,
				gstPercent: null,
				ruleId: found.ruleId,
			}
		: {
				voucherIds: [],
				why: found.why,
				sure: false,
				by,
				at,
				entry: found.entry,
				gstPercent: found.gstPercent,
				ruleId: found.ruleId,
			};
}

/**
 * Reconciling a bank account (accounts brief BA7, BA8, BA10). The matching rules suggest, for each statement line not
 * matched yet, an entry of the books on the account's ledger, or an entry to make (bank charges, interest). Suggestions
 * are worked out afresh on every look and nothing is written until a person accepts one, links a line by hand, or turns
 * a suggestion down. Every decision is in the edit log.
 */
@Injectable()
export class ReconcileService {
	constructor(
		@Inject(BANK_STATEMENT_REPOSITORY) private readonly repo: BankStatementRepository,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'get'>,
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'statementLines' | 'getVoucher' | 'balanceBefore'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'findById'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		private readonly ledger: LedgerService,
	) {}

	/** BA10: the app's rules (as changed, where they were), then the ones people added, in order. */
	async rules(): Promise<MatchRule[]> {
		const saved = await this.repo.rules();
		const builtIn = BUILT_IN_RULES.map(
			(rule) => saved.find((s) => s.id === rule.id) ?? { ...rule, updatedAt: BUILT_IN_SINCE },
		);
		return [...builtIn, ...saved.filter((s) => !s.builtIn)].sort((a, b) => a.order - b.order);
	}

	/** BA10 Add rule, or a change: the app's own rules keep what they look at and do; their switch, words and rate change. */
	async saveRule(write: MatchRuleWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const all = await this.rules();
		const existing = write.id ? all.find((r) => r.id === write.id) : undefined;
		if (write.id && !existing) throw refuse('match_rule_unknown');
		const at = now.toISOString();
		const rule: MatchRule = existing?.builtIn
			? { ...existing, on: write.on, words: write.words, gstPercent: write.gstPercent, updatedAt: at }
			: {
					...write,
					id: existing?.id ?? `mr_${randomUUID()}`,
					order: existing?.order ?? Math.max(...all.map((r) => r.order)) + 1,
					builtIn: false,
					updatedAt: at,
				};
		const problem = ruleProblem(rule);
		if (problem) throw refuse(problem);
		await this.repo.saveRule(rule);
		await this.log(principal?.userId ?? null, 'bank.rule.save', 'bankMatchRule', rule.id, {
			when: rule.when,
			then: rule.then,
			on: rule.on,
			words: rule.words.join(', '),
		});
		return rule;
	}

	private async account(id: string): Promise<BankAccount> {
		const account = await this.banks.get(id);
		if (!account) throw new NotFoundException(accountsRefusal('bank_account_not_found'));
		return account;
	}

	private async lineOf(bankAccountId: string, lineId: string, context?: TransactionContext): Promise<BankLine> {
		const line = await this.repo.line(lineId, context);
		if (!line || line.bankAccountId !== bankAccountId)
			throw new NotFoundException(accountsRefusal('bank_line_not_found'));
		return line;
	}

	/** The account's entries in the books between two days, one per voucher, as money in or out of the account. */
	private async entries(account: BankAccount, from: string, to: string): Promise<Map<string, BookEntry>> {
		const rows = await this.books.statementLines(account.ledgerId, from, to, []);
		const byVoucher = new Map<string, BookEntry>();
		for (const row of rows) {
			const entry = byVoucher.get(row.voucherId) ?? {
				voucherId: row.voucherId,
				number: row.number,
				date: row.date,
				narration: row.narration,
				inPaise: 0,
				outPaise: 0,
			};
			entry.inPaise += row.debitPaise;
			entry.outPaise += row.creditPaise;
			byVoucher.set(row.voucherId, entry);
		}
		// A voucher on both sides of the account comes to one side, net.
		for (const entry of byVoucher.values()) {
			const net = entry.inPaise - entry.outPaise;
			entry.inPaise = Math.max(0, net);
			entry.outPaise = Math.max(0, -net);
		}
		return byVoucher;
	}

	/** One voucher as an entry of the account, wherever its day falls; null when it isn't on the account. */
	private async entryOf(account: BankAccount, voucherId: string): Promise<BookEntry | null> {
		const voucher = await this.books.getVoucher(voucherId);
		const lines = voucher?.lines.filter((line) => line.ledgerId === account.ledgerId) ?? [];
		if (!voucher || !lines.length) return null;
		const net = lines.reduce((sum, line) => sum + line.debitPaise - line.creditPaise, 0);
		return {
			voucherId: voucher.id,
			number: voucher.number,
			date: voucher.date,
			narration: voucher.narration,
			inPaise: Math.max(0, net),
			outPaise: Math.max(0, -net),
		};
	}

	/** The references the books hold for a voucher: an order payment's UPI or bank reference. */
	private async references(voucherId: string): Promise<Candidate['references']> {
		const source = (await this.books.getVoucher(voucherId))?.source;
		// A payout carries its bank reference (UTR) as the settlement's number.
		if (source?.type === 'settlement') return source.number ? [{ kind: 'payout', value: source.number }] : [];
		if (source?.type !== 'orderPayment') return [];
		const payment = await this.payments.findById(source.id);
		return payment?.reference ? [{ kind: 'upi', value: payment.reference }] : [];
	}

	/** Every line of the period and the suggestion for each one not matched yet, in date order. */
	private async suggestions(account: BankAccount, period: ReconcilePeriod) {
		const lines = await this.repo.inPeriod(account.id, period.from, period.to);
		const open = lines.filter((line) => line.status !== 'accepted');
		const amounts = new Set(open.map((line) => line.inPaise || line.outPaise));
		const [entries, held, rules] = await Promise.all([
			this.entries(account, shift(period.from, -WINDOW_DAYS), shift(period.to, WINDOW_DAYS)),
			this.repo.heldVoucherIds(account.id, ['accepted']),
			this.rules(),
		]);
		const candidates: Candidate[] = [];
		for (const entry of entries.values()) {
			// References are looked up only for entries of an amount some line has.
			const references = amounts.has(entry.inPaise || entry.outPaise)
				? await this.references(entry.voucherId)
				: [];
			candidates.push({ ...entry, text: `${entry.number} ${entry.narration}`, references });
		}
		const taken = new Set(held);
		const found = new Map<string, Suggestion | null>();
		for (const line of open) {
			const suggestion = suggestMatch(line, candidates, rules, taken);
			if (suggestion?.kind === 'entries') suggestion.voucherIds.forEach((id) => taken.add(id));
			found.set(line.id, suggestion);
		}
		return { lines, found, entries };
	}

	/** BA7: the lines of the period in one tab (suggested, not matched, accepted), each with the entries it names. */
	async view(id: string, query: ReconcileQuery): Promise<ReconcileView> {
		const account = await this.account(id);
		const { lines, found, entries } = await this.suggestions(account, query);
		const rows = lines.map((line): { tab: ReconcileTab; line: BankLine } => {
			if (line.status === 'accepted') return { tab: 'accepted', line };
			const suggestion = found.get(line.id);
			return suggestion
				? { tab: 'suggested', line: { ...line, status: 'suggested', match: matchOf(suggestion, null, null) } }
				: { tab: 'unmatched', line };
		});
		const counts: Record<ReconcileTab, number> = { suggested: 0, unmatched: 0, accepted: 0 };
		rows.forEach((row) => (counts[row.tab] += 1));
		const items = await Promise.all(
			rows
				.filter((row) => row.tab === query.tab)
				.map(async ({ line }) => {
					const named = await Promise.all(
						(line.match?.voucherIds ?? []).map(
							async (v) => entries.get(v) ?? (await this.entryOf(account, v)),
						),
					);
					return { ...line, entries: named.filter((e): e is BookEntry => !!e) };
				}),
		);
		const sure = rows.filter((row) => row.tab === 'suggested' && row.line.match?.sure).length;
		return { items, counts, sure };
	}

	/** BA7 Accept: the suggestion shown for the line in the period becomes its match; a rule's entry is posted first. */
	async accept(id: string, lineId: string, period: ReconcilePeriod, principal: AuthenticatedPrincipal | undefined) {
		const account = await this.account(id);
		const line = await this.lineOf(id, lineId);
		if (line.status === 'accepted') throw refuse('bank_line_already_matched');
		const suggestion = (await this.suggestions(account, period)).found.get(lineId);
		if (!suggestion) throw refuse('bank_line_nothing_to_accept');
		return this.apply(account, line, suggestion, principal);
	}

	/** BA7 "Accept all sure matches": every sure suggestion of entries in the period; rule-made entries wait for a person. */
	async acceptSure(id: string, period: ReconcilePeriod, principal: AuthenticatedPrincipal | undefined) {
		const account = await this.account(id);
		const { lines, found } = await this.suggestions(account, period);
		let accepted = 0;
		for (const line of lines) {
			const suggestion = found.get(line.id);
			if (suggestion?.kind !== 'entries' || !suggestion.sure) continue;
			await this.apply(account, line, suggestion, principal);
			accepted += 1;
		}
		return { accepted };
	}

	/** BA7 Reject: the suggestion is turned down for this line and never offered to it again. */
	async reject(id: string, lineId: string, period: ReconcilePeriod, principal: AuthenticatedPrincipal | undefined) {
		const account = await this.account(id);
		const line = await this.lineOf(id, lineId);
		const suggestion = (await this.suggestions(account, period)).found.get(lineId);
		if (!suggestion) throw refuse('bank_line_nothing_to_reject');
		const key = suggestion.kind === 'entries' ? (suggestion.voucherIds[0] as string) : suggestion.ruleId;
		const next: BankLine = { ...line, status: 'unmatched', match: null, rejectedKeys: [...line.rejectedKeys, key] };
		const by = principal?.userId ?? null;
		return this.tx.withTransaction(async (context) => {
			await this.repo.saveLine(next, context);
			await this.log(
				by,
				'bank.line.reject',
				'bankLine',
				line.id,
				{ turnedDown: key, why: suggestion.why },
				context,
			);
			return next;
		});
	}

	/** BA8: a line linked by hand to one entry or several that come to its amount. */
	async link(id: string, lineId: string, write: BankLineLink, principal: AuthenticatedPrincipal | undefined) {
		const account = await this.account(id);
		const line = await this.lineOf(id, lineId);
		if (line.status === 'accepted') throw refuse('bank_line_already_matched');
		const voucherIds = [...new Set(write.voucherIds)];
		const held = await this.repo.heldVoucherIds(id, ['accepted']);
		if (voucherIds.some((v) => held.has(v))) throw refuse('bank_link_entry_taken');
		const entries = await Promise.all(voucherIds.map((v) => this.entryOf(account, v)));
		if (entries.some((e) => !e)) throw refuse('bank_link_entry_not_on_account');
		const net = (entries as BookEntry[]).reduce((sum, e) => sum + e.inPaise - e.outPaise, 0);
		if (net !== line.inPaise - line.outPaise) throw refuse(`bank_link_amount_differs:${net}`);
		return this.apply(
			account,
			line,
			{ kind: 'entries', voucherIds, why: 'linked', sure: true, ruleId: null },
			principal,
		);
	}

	/** BA8 "Break a match": an accepted line is free again; an entry a rule made stays in the books until reversed. */
	async unmatch(id: string, lineId: string, principal: AuthenticatedPrincipal | undefined) {
		await this.account(id);
		const line = await this.lineOf(id, lineId);
		if (line.status !== 'accepted') throw refuse('bank_line_not_matched');
		const next: BankLine = { ...line, status: 'unmatched', match: null };
		const by = principal?.userId ?? null;
		return this.tx.withTransaction(async (context) => {
			await this.repo.saveLine(next, context);
			await this.log(
				by,
				'bank.line.unmatch',
				'bankLine',
				line.id,
				// An accepted line always carries its match.
				{ voucherIds: (line.match as NonNullable<BankLine['match']>).voucherIds },
				context,
			);
			return next;
		});
	}

	/** BA8 "Find what it pays": the account's entries of the last six months not matched yet, by words or amount. */
	async findEntries(id: string, q: string, now = new Date()): Promise<BookEntry[]> {
		const account = await this.account(id);
		const to = istDay(now);
		const [entries, held] = await Promise.all([
			this.entries(account, shift(to, -SEARCH_DAYS), to),
			this.repo.heldVoucherIds(id, ['accepted']),
		]);
		const words = normalText(q);
		return [...entries.values()]
			.filter(
				(e) =>
					!held.has(e.voucherId) &&
					(e.inPaise || e.outPaise) > 0 &&
					normalText(`${e.number} ${e.narration} ${(e.inPaise || e.outPaise) / 100}`).includes(words),
			)
			.sort((a, b) => b.date.localeCompare(a.date))
			.slice(0, 50);
	}

	/**
	 * BA9: the bank reconciliation statement as at a day. From the balance in the books: entries not yet through the
	 * bank (paid out, or paid in), statement lines not yet in the books (money in, money out, bank charges), and any
	 * difference already there when the first imported statement starts; together they give the bank's balance, checked
	 * against the statements' own (their opening plus every line to the day).
	 */
	async brs(id: string, asAt: string): Promise<Brs> {
		const account = await this.account(id);
		const bookPaise = await this.books.balanceBefore(account.ledgerId, shift(asAt, 1), []);
		const first = await this.repo.earliestLine(id);
		if (!first || first.date > asAt)
			return {
				asAt,
				bookPaise,
				rows: [],
				computedPaise: bookPaise,
				statementPaise: null,
				startsOn: first?.date ?? null,
			};
		const start = first.date;
		const [{ lines, found }, entries, before, opening] = await Promise.all([
			this.suggestions(account, { from: start, to: asAt }),
			this.entries(account, start, asAt),
			this.books.balanceBefore(account.ledgerId, start, []),
			this.repo.importById(first.importId),
		]);
		// The account's opening voucher is the books' side of the statement's opening, never an item outstanding.
		let bookBefore = before;
		const openingEntry = account.openingVoucherId ? entries.get(account.openingVoucherId) : undefined;
		if (openingEntry) {
			bookBefore += openingEntry.inPaise - openingEntry.outPaise;
			entries.delete(openingEntry.voucherId);
		}
		const cleared = new Set(
			lines.flatMap((line) =>
				line.status === 'accepted' ? (line.match as NonNullable<BankLine['match']>).voucherIds : [],
			),
		);
		const outstanding = [...entries.values()].filter((e) => !cleared.has(e.voucherId) && (e.inPaise || e.outPaise));
		const open = lines.filter((line) => line.status !== 'accepted');
		const isCharge = (line: BankLine) => {
			const suggestion = found.get(line.id);
			return suggestion?.kind === 'new' && suggestion.entry === 'bank_charge';
		};
		const fromEntry = (e: BookEntry, paise: number): BrsItem => ({
			date: e.date,
			text: `${e.number} · ${e.narration}`,
			paise,
		});
		const fromLine = (line: BankLine, paise: number): BrsItem => ({
			date: line.date,
			text: line.description,
			paise,
		});
		const statementOpening = (opening as NonNullable<typeof opening>).openingPaise;
		const groups: [BrsRowKind, BrsItem[]][] = [
			['unpresented', outstanding.filter((e) => e.outPaise).map((e) => fromEntry(e, e.outPaise))],
			['uncredited', outstanding.filter((e) => e.inPaise).map((e) => fromEntry(e, -e.inPaise))],
			['bank_in', open.filter((l) => l.inPaise).map((l) => fromLine(l, l.inPaise))],
			['bank_out', open.filter((l) => l.outPaise && !isCharge(l)).map((l) => fromLine(l, -l.outPaise))],
			['bank_charges', open.filter(isCharge).map((l) => fromLine(l, -l.outPaise))],
			[
				'before_start',
				statementOpening === bookBefore
					? []
					: [{ date: start, text: '', paise: statementOpening - bookBefore }],
			],
		];
		const rows = groups.map(([kind, items]) => ({
			kind,
			items,
			paise: items.reduce((sum, i) => sum + i.paise, 0),
		}));
		return {
			asAt,
			bookPaise,
			rows,
			computedPaise: rows.reduce((sum, row) => sum + row.paise, bookPaise),
			statementPaise: lines.reduce((sum, line) => sum + line.inPaise - line.outPaise, statementOpening),
			startsOn: start,
		};
	}

	private async apply(
		account: BankAccount,
		line: BankLine,
		found: Found,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<BankLine> {
		const by = principal?.userId ?? null;
		const at = new Date().toISOString();
		const locationId = found.kind === 'new' ? await this.location(account) : null;
		return this.tx.withTransaction(async (context) => {
			let match = matchOf(found, by, at);
			if (found.kind === 'new') {
				const amount = line.inPaise || line.outPaise;
				const bank =
					found.entry === 'interest'
						? { ledger: { id: account.ledgerId }, debitPaise: amount }
						: { ledger: { id: account.ledgerId }, creditPaise: amount };
				const voucher = await this.ledger.post(
					{
						kind: found.entry === 'interest' ? 'receipt' : 'payment',
						date: line.date,
						narration: `${line.description} (bank statement)`,
						source: { type: 'bankLine', id: line.id, number: null },
						idempotencyKey: `bankLine:${line.id}`,
						lines: [bank, ...ruleEntryRows(found.entry, amount, found.gstPercent)].map((row) => ({
							...row,
							locationId: locationId as string,
						})),
					},
					context,
					by,
				);
				match = { ...match, voucherIds: [voucher.id] };
			}
			const next: BankLine = { ...line, status: 'accepted', match };
			await this.repo.saveLine(next, context);
			await this.log(
				by,
				'bank.line.accept',
				'bankLine',
				line.id,
				{ voucherIds: match.voucherIds, why: match.why },
				context,
			);
			return next;
		});
	}

	/** Where a rule's entry posts: the account's location, else where stock is kept by default. */
	private async location(account: BankAccount): Promise<string> {
		const locationId = account.locationId ?? defaultStockLocation(await this.locations.list());
		if (!locationId) throw refuse('books_need_a_location');
		return locationId;
	}

	private async log(
		by: string | null,
		action: string,
		entityType: string,
		entityId: string,
		metadata: Record<string, unknown>,
		context?: TransactionContext,
	) {
		await this.audit.append(
			{
				id: `aud_${randomUUID()}`,
				actorUserId: by,
				targetUserId: null,
				audience: 'admin',
				action,
				entityType,
				entityId,
				severity: 'info',
				retentionTier: 'books',
				diffs: [],
				metadata,
				requestId: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: new Date().toISOString(),
			},
			context,
		);
	}
}
