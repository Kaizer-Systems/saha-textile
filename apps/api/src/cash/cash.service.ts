import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
	type OnModuleInit,
} from '@nestjs/common';
import {
	CashBox,
	CashSheetLine,
	DEFAULT_CASH_RULES,
	DEFAULT_DENOMINATIONS,
	type CarriedDifference,
	type CashMoveWrite,
	type CashChoices,
	type CashSettings,
	type CashSettlementHow,
	type CashSettingsView,
	type CashSettingsWrite,
	type CashSettleWrite,
	type CashSheet,
	type CashSheetList,
	type CashSheetListQuery,
	type CashSheetView,
	type CashCountWrite,
	type CloseCountResult,
	type JournalVoucher,
	type OpenSheetWrite,
	type TodaysSheet,
} from '@saha-textile/contracts';
import {
	cashMovePosting,
	closeOutcome,
	countOf,
	countingOrder,
	expectedInBox,
	istDay,
	lineKindOf,
	settlementPosting,
	settlementProblem,
	sheetRows,
	suspenseRelease,
	suspenseUntil,
	type AdminUserRepository,
	type CashPostingLine,
	type GeneralLedgerRepository,
	type CashRepository,
	type LocationRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	CASH_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { EditLogService } from '../ledger/edit-log';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';
import { cashGroup, isBank, ledgersUnder, personName } from './cash-books';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const conflict = (code: string) => new ConflictException(accountsRefusal(code));

/** How often an excess nobody could explain is checked for leaving suspense. */
export const CASH_SWEEP_MS = 60 * 60_000;

/** Who is asking, as cash sees it: where they may work, and whether they may see amounts and settle. */
export interface CashAccess {
	userId: string | null;
	all: boolean;
	locationIds: readonly string[];
	manager: boolean;
	superAdmin: boolean;
}

/**
 * Cash (accounts brief O1–O11, O14; owner-approved 2026-11-23): Settings › Cash boxes, each box's sheet opened by
 * counting the float, its lines written by the books themselves, the close counted blind, a difference settled by a
 * manager in one of ten ways, and an excess in suspense let go to other income once its days are up.
 */
@Injectable()
export class CashService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('CashService');
	private timer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(CASH_REPOSITORY) private readonly repo: CashRepository,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById' | 'list'>,
		@Inject(LOCATION_REPOSITORY) private readonly locationRepo: Pick<LocationRepository, 'list'>,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'balanceBefore'>,
		private readonly ledger: LedgerService,
		private readonly locations: LocationsService,
		private readonly log: EditLogService,
	) {}

	/** Every voucher that touches a box's ledger writes its line on that box's sheet, in the voucher's transaction. */
	onModuleInit(): void {
		this.ledger.onPosted((voucher, context) => this.voucherPosted(voucher, context));
	}

	/** Every hour, an excess held in suspense past its days goes to other income (safe to repeat: one key each). */
	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.sweep(), CASH_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async sweep(): Promise<void> {
		try {
			await this.releaseSuspense();
		} catch (error) {
			this.logger.warn(`Suspense release failed: ${error instanceof Error ? error.message : 'unknown'}`);
		}
	}

	/* ------------------------------------------------------------------ who and where */

	async access(principal: AuthenticatedPrincipal | undefined): Promise<CashAccess> {
		const [scope, superAdmin] = await Promise.all([
			this.locations.scope(principal),
			this.ledger.isSuperAdmin(principal),
		]);
		return {
			userId: principal?.userId ?? null,
			all: scope.all,
			locationIds: [...scope.ids],
			manager: superAdmin || !!principal?.permissions.includes('cash.manage'),
			superAdmin,
		};
	}

	private inScope(access: CashAccess, locationId: string): boolean {
		return access.all || access.locationIds.includes(locationId);
	}

	async boxIn(id: string, access: CashAccess, context?: TransactionContext): Promise<CashBox> {
		const box = await this.repo.box(id, context);
		if (!box) throw new NotFoundException(accountsRefusal('cash_box_not_found'));
		if (!this.inScope(access, box.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		return box;
	}

	async settings(): Promise<CashSettings> {
		return (
			(await this.repo.settings()) ?? {
				denominations: [...DEFAULT_DENOMINATIONS],
				rules: DEFAULT_CASH_RULES,
				updatedAt: null,
			}
		);
	}

	private async nameOf(id: string): Promise<string | null> {
		return personName(await this.admins.findById(id).catch(() => null));
	}

	/** People's names for a list of ids, in one go. */
	async names(ids: readonly (string | null)[]): Promise<(id: string | null) => string | null> {
		const unique = [...new Set(ids.filter((id): id is string => !!id))];
		const found = new Map(await Promise.all(unique.map(async (id) => [id, await this.nameOf(id)] as const)));
		return (id) => (id ? (found.get(id) ?? null) : null);
	}

	/** The box's ledger balance: what the books say is in it. */
	async bookOf(box: CashBox): Promise<number> {
		return this.books.balanceBefore(box.ledgerId, '9999-12-31', []);
	}

	/** What should physically be in the box now: the books, less every difference still carried. */
	async expectedNow(
		box: CashBox,
		context?: TransactionContext,
	): Promise<{ expected: number; carried: CarriedDifference[] }> {
		const [book, unsettled] = await Promise.all([this.bookOf(box), this.repo.unsettled(box.id, context)]);
		const carried = unsettled.map((s) => ({
			sheetId: s.id,
			date: s.date,
			differencePaise: s.differencePaise as number,
		}));
		return { expected: expectedInBox(book, carried), carried };
	}

	/** What the cash screens choose from, limited to where the person works. */
	async choices(principal: AuthenticatedPrincipal | undefined): Promise<CashChoices> {
		const access = await this.access(principal);
		const [boxes, places, chart, people] = await Promise.all([
			this.boxesFor(access),
			this.locationRepo.list(),
			this.ledger.chart(),
			this.admins.list({ page: 1, pageSize: 500 }),
		]);
		const placeName = new Map(places.map((p) => [p.id, p.name]));
		const pick = (rows: readonly { id: string; name: string }[]) => rows.map(({ id, name }) => ({ id, name }));
		const boxLedgers = new Set((await this.repo.boxes()).map((b) => b.ledgerId));
		return {
			boxes: boxes.map((b) => ({ ...b, locationName: placeName.get(b.locationId) ?? '' })),
			banks: pick([...ledgersUnder(chart, 'bank_accounts'), ...ledgersUnder(chart, 'bank_od')]),
			heads: pick(ledgersUnder(chart, 'petty_expenses')),
			ledgers: pick(chart.ledgers.filter((l) => l.active && !boxLedgers.has(l.id))),
			staff: people.items.flatMap((u) => {
				const name = personName(u);
				return name ? [{ id: u.id, name }] : [];
			}),
			locations: pick(places.filter((p) => p.active && this.inScope(access, p.id))),
			manager: access.manager,
			superAdmin: access.superAdmin,
			userId: access.userId,
		};
	}

	/* ------------------------------------------------------------------ Settings › Cash boxes (O1) */

	async settingsView(): Promise<CashSettingsView> {
		const [settings, boxes] = await Promise.all([this.settings(), this.repo.boxes()]);
		return { settings, boxes };
	}

	/** O1 Save: boxes (a new one gets its own ledger under Cash in hand), the notes and coins, and the rules. */
	async saveSettings(write: CashSettingsWrite, by: string | null, now = new Date()): Promise<CashSettingsView> {
		if (!write.denominations.some((d) => d.on)) throw refuse('cash_no_denomination_on');
		const at = now.toISOString();
		const [chart, existing, places] = await Promise.all([
			this.ledger.chart(),
			this.repo.boxes(),
			this.locationRepo.list(),
		]);
		const placeName = new Map(places.map((p) => [p.id, p.name]));
		const group = cashGroup(chart);
		for (const row of write.boxes) {
			const place = placeName.get(row.locationId);
			if (!place) throw refuse('location_unknown');
			const ledgerName = `${row.name} · ${place}`;
			const before = row.id ? existing.find((b) => b.id === row.id) : undefined;
			if (row.id && !before) throw new NotFoundException(accountsRefusal('cash_box_not_found'));
			if (before) {
				if (before.locationId !== row.locationId && (await this.repo.openSheet(before.id)))
					throw conflict('cash_box_has_open_sheet');
				const ledger = chart.ledgers.find((l) => l.id === before.ledgerId);
				if (ledger && (ledger.name !== ledgerName || ledger.active !== row.active))
					await this.ledger.saveLedger(
						ledger.id,
						{ name: ledgerName, groupId: ledger.groupId, active: row.active, expectedUpdatedAt: null },
						by,
					);
				await this.repo.saveBox(CashBox.parse({ ...before, ...row, id: before.id, updatedAt: at }));
				continue;
			}
			if (!group) throw refuse('voucher_problem:role_not_mapped:cash_in_hand');
			const ledger = await this.ledger.addLedger(
				{ name: ledgerName, groupId: group.id, active: true, expectedUpdatedAt: null },
				by,
			);
			await this.repo.saveBox(
				CashBox.parse({ ...row, id: `box_${randomUUID()}`, ledgerId: ledger.id, createdAt: at, updatedAt: at }),
			);
		}
		const before = await this.settings();
		await this.repo.saveSettings({ denominations: write.denominations, rules: write.rules, updatedAt: at });
		await this.log.append(by, 'cash.settings.save', 'cashSettings', 'cash', [
			{ field: 'rules', before: JSON.stringify(before.rules), after: JSON.stringify(write.rules) },
		]);
		return this.settingsView();
	}

	/* ------------------------------------------------------------------ today's sheet (O2, O3, O9, O14) */

	/** The boxes a person may count: active, at their locations. */
	private async boxesFor(access: CashAccess): Promise<CashBox[]> {
		return (await this.repo.boxes()).filter((b) => b.active && this.inScope(access, b.locationId));
	}

	async today(
		boxId: string | null,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<TodaysSheet> {
		const access = await this.access(principal);
		const boxes = await this.boxesFor(access);
		const box = boxId ? await this.boxIn(boxId, access) : (boxes.find((b) => b.kind === 'day_sheet') ?? boxes[0]);
		if (!box) throw new NotFoundException(accountsRefusal('cash_box_none_here'));
		const today = istDay(now);
		const [open, unsettled, settings] = await Promise.all([
			this.repo.openSheet(box.id),
			this.repo.unsettled(box.id),
			this.settings(),
		]);
		const stillOpen =
			open && box.kind === 'day_sheet' && open.date < today ? { sheetId: open.id, date: open.date } : null;
		return {
			box,
			boxes,
			today,
			sheet: open ? await this.viewOf(open, box, access) : null,
			stillOpen,
			unsettled: unsettled.map((s) => ({
				sheetId: s.id,
				date: s.date,
				differencePaise: s.differencePaise as number,
			})),
			denominations: countingOrder(settings.denominations),
		};
	}

	/** O2: count the float; refused while an earlier sheet is open (O14), and while a difference waits unless carried (O9). */
	async open(
		write: OpenSheetWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CashSheetView> {
		const access = await this.access(principal);
		const box = await this.boxIn(write.boxId, access);
		if (!box.active) throw refuse('cash_box_switched_off');
		const settings = await this.settings();
		const count = this.counted(write.count, settings, now, access.userId);
		const today = istDay(now);
		const sheet = await this.tx.withTransaction(async (context) => {
			const open = await this.repo.openSheet(box.id, context);
			if (open) throw conflict(open.date < today ? 'cash_sheet_still_open' : 'cash_sheet_exists');
			if (await this.repo.sheetOn(box.id, today, context)) throw conflict('cash_sheet_exists');
			const { expected, carried } = await this.expectedNow(box, context);
			if (carried.length && !write.carryDifference) throw conflict('cash_difference_unsettled');
			const at = now.toISOString();
			const next: CashSheet = {
				id: `sh_${randomUUID()}`,
				boxId: box.id,
				locationId: box.locationId,
				date: today,
				status: 'open',
				openedAt: at,
				openedBy: access.userId,
				opening: count,
				openingExpectedPaise: expected,
				carried,
				counts: [],
				closedAt: null,
				closedBy: null,
				closedLate: false,
				expectedAtClosePaise: null,
				differencePaise: null,
				settlement: null,
				version: 0,
				updatedAt: at,
			};
			await this.repo.insertSheet(next, context);
			await this.repo.adoptLines(box.id, next.id, context);
			return next;
		});
		await this.log.append(access.userId, 'cash.sheet.open', 'cashSheet', sheet.id, [], {
			box: box.name,
			date: sheet.date,
			carried: sheet.carried.length,
		});
		return this.viewOf(sheet, box, access);
	}

	private counted(write: CashCountWrite, settings: CashSettings, now: Date, by: string | null) {
		try {
			return countOf(write, settings.denominations, now.toISOString(), by);
		} catch (error) {
			throw refuse((error as Error).message);
		}
	}

	/** A sheet the person may work on: at their location; a cashier closes only a sheet they opened. */
	private async sheetFor(
		id: string,
		access: CashAccess,
		context?: TransactionContext,
	): Promise<{ sheet: CashSheet; box: CashBox }> {
		const sheet = await this.repo.sheet(id, context);
		if (!sheet) throw new NotFoundException(accountsRefusal('cash_sheet_not_found'));
		const box = await this.boxIn(sheet.boxId, access, context);
		return { sheet, box };
	}

	/** O5–O7: a close count. The answer never says how much or which way. */
	async count(
		id: string,
		write: CashCountWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CloseCountResult> {
		const access = await this.access(principal);
		const settings = await this.settings();
		const count = this.counted(write, settings, now, access.userId);
		const result = await this.tx.withTransaction(async (context) => {
			const { sheet, box } = await this.sheetFor(id, access, context);
			if (sheet.status !== 'open') throw conflict('cash_sheet_not_open');
			if (sheet.openedBy !== access.userId && !access.manager)
				throw new ForbiddenException(accountsRefusal('cash_close_another'));
			const { expected } = await this.expectedNow(box, context);
			const counts = [...sheet.counts, count];
			const outcome = closeOutcome({
				countedPaise: count.totalPaise,
				expectedPaise: expected,
				attempt: counts.length,
				autoAcceptUpToPaise: settings.rules.autoAcceptUpToPaise,
			});
			let next: CashSheet = { ...sheet, counts, updatedAt: now.toISOString() };
			if (outcome === 'closed')
				next = await this.close(next, box, count.totalPaise, expected, access, now, context);
			await this.repo.saveSheet(next, sheet.version, context);
			return { result: outcome, attempt: counts.length };
		});
		await this.log.append(access.userId, 'cash.sheet.count', 'cashSheet', id, [], result);
		return result;
	}

	/** Closed as counted: matched, or within the auto-accept limit (that difference written off by the system). */
	private async close(
		sheet: CashSheet,
		box: CashBox,
		counted: number,
		expected: number,
		access: CashAccess,
		now: Date,
		context: TransactionContext,
	): Promise<CashSheet> {
		const difference = counted - expected;
		const closed: CashSheet = {
			...sheet,
			status: 'closed',
			closedAt: now.toISOString(),
			closedBy: access.userId,
			closedLate: sheet.date < istDay(now),
			expectedAtClosePaise: expected,
			differencePaise: difference,
		};
		if (difference === 0) return closed;
		const posting = settlementPosting({
			how: 'auto_accepted',
			differencePaise: difference,
			boxLedgerId: box.ledgerId,
			sheetDate: sheet.date,
			today: istDay(now),
			ledgerId: null,
			bankLedgerId: null,
			depositDate: null,
			staffUserId: null,
			repayBy: null,
			consent: false,
			policeReport: null,
			insured: false,
			recountPaise: null,
			expectedPaise: expected,
		});
		const voucher = await this.post(posting as { date: string; lines: CashPostingLine[] }, box, {
			narration: `Cash ${difference < 0 ? 'short' : 'over'} accepted · ${box.name} · ${sheet.date}`,
			source: { type: 'cashSettlement', id: sheet.id, number: null },
			key: `cashSettlement:${sheet.id}`,
			kind: 'journal',
			by: access.userId,
			context,
		});
		return {
			...closed,
			status: 'settled',
			settlement: this.settlement({ how: 'auto_accepted' }, access, now, voucher.id),
		};
	}

	/** O7: the second count (or a later one) still doesn't match; closed with the difference, for a manager. */
	async submitDifference(
		id: string,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CashSheetView> {
		const access = await this.access(principal);
		const { sheet, box } = await this.tx.withTransaction(async (context) => {
			const found = await this.sheetFor(id, access, context);
			const { sheet } = found;
			if (sheet.status !== 'open') throw conflict('cash_sheet_not_open');
			if (sheet.openedBy !== access.userId && !access.manager)
				throw new ForbiddenException(accountsRefusal('cash_close_another'));
			if (sheet.counts.length < 2) throw conflict('cash_count_twice_first');
			const { expected } = await this.expectedNow(found.box, context);
			const counted = (sheet.counts.at(-1) as { totalPaise: number }).totalPaise;
			if (counted === expected) throw conflict('cash_count_matches');
			const next: CashSheet = {
				...sheet,
				status: 'difference',
				closedAt: now.toISOString(),
				closedBy: access.userId,
				closedLate: sheet.date < istDay(now),
				expectedAtClosePaise: expected,
				differencePaise: counted - expected,
				updatedAt: now.toISOString(),
			};
			return { sheet: await this.repo.saveSheet(next, sheet.version, context), box: found.box };
		});
		await this.log.append(access.userId, 'cash.sheet.difference', 'cashSheet', id, [], {
			box: box.name,
			date: sheet.date,
		});
		return this.viewOf(sheet, box, access);
	}

	/* ------------------------------------------------------------------ typed on the sheet (O3) */

	/** A bank deposit, cash from the bank, or a move to another box: a contra, which writes its own lines. */
	async move(
		id: string,
		write: CashMoveWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CashSheetView> {
		const access = await this.access(principal);
		const { sheet, box } = await this.sheetFor(id, access);
		if (sheet.status !== 'open') throw conflict('cash_sheet_not_open');
		let other: string;
		if (write.kind === 'box_move') {
			const target = await this.boxIn(write.toId, access);
			if (target.id === box.id || !target.active) throw refuse('cash_move_same_box');
			other = target.ledgerId;
		} else {
			if (!isBank(await this.ledger.chart(), write.toId)) throw refuse('cash_move_needs_bank');
			other = write.toId;
		}
		const words = { bank_deposit: 'Bank deposit', bank_withdrawal: 'Cash from the bank', box_move: 'Cash moved' };
		const source = { bank_deposit: 'bankDeposit', bank_withdrawal: 'bankWithdrawal', box_move: 'cashMove' };
		await this.tx.withTransaction((context) =>
			this.post(
				{ date: istDay(now), lines: cashMovePosting(write.kind, write.amountPaise, box.ledgerId, other) },
				box,
				{
					narration: [words[write.kind], write.slip && `slip ${write.slip}`, write.note]
						.filter(Boolean)
						.join(' · '),
					source: { type: source[write.kind], id: `mv_${randomUUID()}`, number: write.slip || null },
					key: `cashMove:${randomUUID()}`,
					kind: 'contra',
					by: access.userId,
					context,
				},
			),
		);
		return this.view(id, principal);
	}

	/** Posts a cash voucher at the box's location (lines of other ledgers too). */
	async post(
		posting: { date: string; lines: readonly CashPostingLine[] },
		box: CashBox,
		meta: {
			narration: string;
			source: { type: string; id: string; number: string | null };
			key: string;
			kind: 'journal' | 'payment' | 'receipt' | 'contra';
			by: string | null;
			context: TransactionContext;
		},
	): Promise<JournalVoucher> {
		return this.ledger.post(
			{
				kind: meta.kind,
				date: posting.date,
				narration: meta.narration,
				lines: posting.lines.map((line) => ({ ...line, locationId: box.locationId })),
				source: meta.source,
				idempotencyKey: meta.key,
			},
			meta.context,
			meta.by,
		);
	}

	/* ------------------------------------------------------------------ the books write the sheet */

	/** Each box a voucher touches gets one line: on the sheet settled (a settlement), the open sheet, or none yet. */
	async voucherPosted(voucher: JournalVoucher, context: TransactionContext): Promise<void> {
		const boxes = new Map((await this.repo.boxes()).map((b) => [b.ledgerId, b]));
		const touched = new Map<string, { box: CashBox; inPaise: number; outPaise: number }>();
		for (const line of voucher.lines) {
			const box = boxes.get(line.ledgerId);
			if (!box) continue;
			const row = touched.get(box.id) ?? { box, inPaise: 0, outPaise: 0 };
			row.inPaise += line.debitPaise;
			row.outPaise += line.creditPaise;
			touched.set(box.id, row);
		}
		for (const { box, inPaise, outPaise } of touched.values()) {
			const settled = voucher.source?.type === 'cashSettlement' ? voucher.source.id : null;
			const sheetId = settled ?? (await this.repo.openSheet(box.id, context))?.id ?? null;
			await this.repo.insertLine(
				CashSheetLine.parse({
					id: `ln_${randomUUID()}`,
					sheetId,
					boxId: box.id,
					at: voucher.createdAt,
					date: voucher.date,
					kind: lineKindOf(voucher.source?.type ?? '', voucher.kind),
					what: voucher.narration.slice(0, 200),
					ref: (voucher.source?.number ?? voucher.number).slice(0, 60),
					by: voucher.createdBy,
					inPaise,
					outPaise,
					voucherId: voucher.id,
					addedOnReview: !!settled,
				}),
				context,
			);
		}
	}

	/* ------------------------------------------------------------------ seeing a sheet (O3, O8, O10) */

	async view(id: string, principal: AuthenticatedPrincipal | undefined): Promise<CashSheetView> {
		const access = await this.access(principal);
		const { sheet, box } = await this.sheetFor(id, access);
		return this.viewOf(sheet, box, access);
	}

	private async viewOf(sheet: CashSheet, box: CashBox, access: CashAccess): Promise<CashSheetView> {
		const amounts = access.manager || sheet.status !== 'open';
		const [lines, settings, places, unsettled] = await Promise.all([
			this.repo.linesOf(sheet.id),
			this.settings(),
			this.locationRepo.list(),
			this.repo.unsettled(box.id),
		]);
		const stillCarried = new Set(unsettled.map((s) => s.id));
		const carried = sheet.carried.filter((row) => stillCarried.has(row.sheetId));
		const expectedNow =
			sheet.status === 'open' ? (await this.expectedNow(box)).expected : (sheet.expectedAtClosePaise as number);
		const nameOf = await this.names([sheet.openedBy, sheet.closedBy, sheet.opening.by, ...lines.map((l) => l.by)]);
		return {
			sheet,
			box,
			locationName: places.find((p) => p.id === box.locationId)?.name ?? '',
			openedByName: nameOf(sheet.openedBy),
			closedByName: nameOf(sheet.closedBy),
			rows: sheetRows({
				sheet: { ...sheet, carried },
				lines,
				expectedNowPaise: expectedNow,
				amounts,
				nameOf,
				labels: { opening: 'opening', carried: (date) => date },
			}),
			amounts,
			expectedPaise: access.manager ? expectedNow : null,
			denominations: countingOrder(settings.denominations),
		};
	}

	/* ------------------------------------------------------------------ the list (O11) and differences */

	async list(query: CashSheetListQuery, principal: AuthenticatedPrincipal | undefined): Promise<CashSheetList> {
		const access = await this.access(principal);
		const [boxes, places] = await Promise.all([this.repo.boxes(), this.locationRepo.list()]);
		const placeName = new Map(places.map((p) => [p.id, p.name]));
		const locationIds = query.locationId
			? [query.locationId].filter((id) => this.inScope(access, id))
			: access.all
				? null
				: access.locationIds;
		let match = null;
		if (query.search) {
			const words = query.search.toLowerCase();
			const people = (await this.admins.list({ page: 1, pageSize: 500 })).items
				.filter((u) => (personName(u) ?? '').toLowerCase().includes(words))
				.map((u) => u.id);
			match = {
				boxIds: boxes
					.filter((b) => `${b.name} ${placeName.get(b.locationId) ?? ''}`.toLowerCase().includes(words))
					.map((b) => b.id),
				people,
			};
		}
		const page = await this.repo.listSheets({
			from: query.from,
			to: query.to,
			chip: query.chip,
			locationIds,
			match,
			page: query.page,
			pageSize: query.pageSize,
		});
		const totals = await this.repo.sheetTotals(page.items.map((s) => s.id));
		const nameOf = await this.names(page.items.map((s) => s.openedBy));
		const boxOf = new Map(boxes.map((b) => [b.id, b]));
		const shown = <T>(value: T) => (access.manager ? value : null);
		return {
			items: page.items.map((s) => ({
				id: s.id,
				date: s.date,
				boxName: boxOf.get(s.boxId)?.name ?? '',
				locationName: placeName.get(s.locationId) ?? '',
				status: s.status,
				openingPaise: shown(s.opening.totalPaise),
				inPaise: shown(totals[s.id]?.inPaise ?? 0),
				outPaise: shown(totals[s.id]?.outPaise ?? 0),
				countedPaise: shown(s.counts.at(-1)?.totalPaise ?? null),
				differencePaise: shown(s.differencePaise),
				openedBy: nameOf(s.openedBy),
			})),
			total: page.total,
			counts: page.counts,
			amounts: access.manager,
		};
	}

	/* ------------------------------------------------------------------ settling a difference (O8) */

	private settlement(
		write: Partial<Omit<CashSettleWrite, 'how'>> & { how: CashSettlementHow },
		access: CashAccess,
		now: Date,
		voucherId: string | null,
		extra: { recount?: CashSheet['opening'] | null; staffName?: string | null; suspenseUntil?: string | null } = {},
	): NonNullable<CashSheet['settlement']> {
		return {
			how: write.how,
			note: write.note ?? '',
			at: now.toISOString(),
			by: access.userId,
			voucherId,
			recount: extra.recount ?? null,
			ledgerId: write.ledgerId ?? null,
			bankLedgerId: write.bankLedgerId ?? null,
			depositSlip: write.depositSlip ?? null,
			depositDate: write.depositDate ?? null,
			staffUserId: write.staffUserId ?? null,
			staffName: extra.staffName ?? null,
			repayBy: write.repayBy ?? null,
			policeReport: write.policeReport ?? null,
			insured: write.insured ?? false,
			noteDetails: write.noteDetails ?? null,
			suspenseUntil: extra.suspenseUntil ?? null,
			releaseVoucherId: null,
		};
	}

	async settle(
		id: string,
		write: CashSettleWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CashSheetView> {
		const access = await this.access(principal);
		const settings = await this.settings();
		const recount = write.recount ? this.counted(write.recount, settings, now, access.userId) : null;
		const staffName = write.staffUserId ? await this.nameOf(write.staffUserId) : null;
		if (write.staffUserId && !staffName) throw refuse('staff_unknown');
		const { sheet, box } = await this.sheetFor(id, access);
		if (box.reviewedBy === 'owner' && !access.superAdmin)
			throw new ForbiddenException(accountsRefusal('cash_owner_settles'));
		if (sheet.status !== 'difference') throw conflict('cash_nothing_to_settle');
		if (write.bankLedgerId && !isBank(await this.ledger.chart(), write.bankLedgerId))
			throw refuse('cash_move_needs_bank');
		const today = istDay(now);
		const input = {
			how: write.how,
			differencePaise: sheet.differencePaise as number,
			boxLedgerId: box.ledgerId,
			sheetDate: sheet.date,
			today,
			ledgerId: write.ledgerId,
			bankLedgerId: write.bankLedgerId,
			depositDate: write.depositDate,
			staffUserId: write.staffUserId,
			repayBy: write.repayBy,
			consent: write.consent,
			policeReport: write.policeReport,
			insured: write.insured,
			recountPaise: recount?.totalPaise ?? null,
			expectedPaise: sheet.expectedAtClosePaise as number,
		};
		const problem = settlementProblem(input);
		if (problem) throw refuse(problem);
		const settled = await this.tx.withTransaction(async (context) => {
			const posting = settlementPosting(input);
			const voucher = posting
				? await this.post(posting, box, {
						narration: `Cash ${(sheet.differencePaise as number) < 0 ? 'short' : 'over'} settled · ${box.name} · ${sheet.date}${write.note ? ` · ${write.note}` : ''}`,
						source: { type: 'cashSettlement', id: sheet.id, number: null },
						key: `cashSettlement:${sheet.id}`,
						kind: 'journal',
						by: access.userId,
						context,
					})
				: null;
			const next: CashSheet = {
				...sheet,
				status: 'settled',
				settlement: this.settlement(write, access, now, voucher?.id ?? null, {
					recount,
					staffName,
					suspenseUntil:
						write.how === 'excess_suspense' ? suspenseUntil(today, settings.rules.suspenseDays) : null,
				}),
				updatedAt: now.toISOString(),
			};
			return this.repo.saveSheet(next, write.version, context).catch((error: unknown) => {
				if ((error as Error).message === 'cash_sheet_changed') throw conflict('cash_sheet_changed');
				throw error;
			});
		});
		await this.log.append(access.userId, 'cash.sheet.settle', 'cashSheet', id, [], {
			how: write.how,
			differencePaise: sheet.differencePaise,
			box: box.name,
			date: sheet.date,
		});
		return this.viewOf(settled, box, access);
	}

	/** An excess held in suspense becomes other income once its days are up; safe to run again. */
	async releaseSuspense(now = new Date()): Promise<number> {
		const today = istDay(now);
		const due = await this.repo.suspenseDue(today);
		for (const sheet of due) {
			const box = await this.repo.box(sheet.boxId);
			if (!box) continue;
			await this.tx.withTransaction(async (context) => {
				const voucher = await this.post(
					{ date: today, lines: suspenseRelease(sheet.differencePaise as number) },
					box,
					{
						narration: `Unexplained cash over · ${box.name} · ${sheet.date} · to other income`,
						source: { type: 'cashSuspenseRelease', id: sheet.id, number: null },
						key: `cashSuspenseRelease:${sheet.id}`,
						kind: 'journal',
						by: null,
						context,
					},
				);
				const settlement = sheet.settlement as NonNullable<CashSheet['settlement']>;
				await this.repo.saveSheet(
					{
						...sheet,
						settlement: { ...settlement, releaseVoucherId: voucher.id },
						updatedAt: now.toISOString(),
					},
					sheet.version,
					context,
				);
			});
		}
		return due.length;
	}
}
