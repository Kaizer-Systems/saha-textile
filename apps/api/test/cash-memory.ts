import type {
	CashBox,
	CashSettings,
	CashSheet,
	CashSheetLine,
	ChartOfAccounts,
	ExpenseClaim,
	JournalVoucher,
	PettyExpense,
} from '@saha-textile/contracts';
import { payeeKey, rolesOf, type CashRepository, type TransactionContext } from '@saha-textile/core-domain';

/**
 * Cash in memory for the API tests (accounts brief O): the repository, a chart with cash, bank, petty heads and every
 * role cash posts to, and a stand-in ledger that numbers vouchers, keeps balances and tells its listeners, as the
 * real one does.
 */

export const AT = '2026-11-23T04:32:00.000Z';

export class MemoryCash implements CashRepository {
	stored: CashSettings | null = null;
	boxMap = new Map<string, CashBox>();
	sheets = new Map<string, CashSheet>();
	lines: CashSheetLine[] = [];
	pettyRows: PettyExpense[] = [];
	claimMap = new Map<string, ExpenseClaim>();

	async settings() {
		return this.stored;
	}
	async saveSettings(settings: CashSettings) {
		this.stored = settings;
	}
	async boxes() {
		return [...this.boxMap.values()].sort((a, b) => a.name.localeCompare(b.name));
	}
	async box(id: string) {
		return this.boxMap.get(id) ?? null;
	}
	async saveBox(box: CashBox) {
		this.boxMap.set(box.id, box);
	}
	async sheet(id: string) {
		return this.sheets.get(id) ?? null;
	}
	async openSheet(boxId: string) {
		return [...this.sheets.values()].find((s) => s.boxId === boxId && s.status === 'open') ?? null;
	}
	async sheetOn(boxId: string, date: string) {
		return [...this.sheets.values()].find((s) => s.boxId === boxId && s.date === date) ?? null;
	}
	async unsettled(boxId: string) {
		return [...this.sheets.values()]
			.filter((s) => s.boxId === boxId && s.status === 'difference')
			.sort((a, b) => a.date.localeCompare(b.date));
	}
	async insertSheet(sheet: CashSheet) {
		this.sheets.set(sheet.id, sheet);
	}
	async saveSheet(sheet: CashSheet, expectedVersion: number) {
		if (this.sheets.get(sheet.id)?.version !== expectedVersion) throw new Error('cash_sheet_changed');
		const next = { ...sheet, version: expectedVersion + 1 };
		this.sheets.set(sheet.id, next);
		return next;
	}
	async listSheets(query: Parameters<CashRepository['listSheets']>[0]) {
		const base = [...this.sheets.values()].filter(
			(s) =>
				s.date >= query.from &&
				s.date <= query.to &&
				(!query.locationIds || query.locationIds.includes(s.locationId)) &&
				(!query.match ||
					(query.match.boxIds ?? []).includes(s.boxId) ||
					(query.match.people ?? []).includes(s.openedBy ?? '')),
		);
		const chip = (c: string) => base.filter((s) => c === 'all' || s.status === c);
		const items = chip(query.chip).sort((a, b) => b.date.localeCompare(a.date));
		return {
			items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
			total: items.length,
			counts: { all: chip('all').length, difference: chip('difference').length, open: chip('open').length },
		};
	}
	async suspenseDue(today: string) {
		return [...this.sheets.values()].filter(
			(s) =>
				s.settlement?.how === 'excess_suspense' &&
				(s.settlement.suspenseUntil ?? '9') <= today &&
				!s.settlement.releaseVoucherId,
		);
	}
	async unfinishedIn(month: string) {
		return [...this.sheets.values()].filter(
			(s) => s.date.startsWith(month) && (s.status === 'open' || s.status === 'difference'),
		);
	}
	async insertLine(line: CashSheetLine) {
		this.lines.push(line);
	}
	async linesOf(sheetId: string) {
		return this.lines.filter((l) => l.sheetId === sheetId);
	}
	async adoptLines(boxId: string, sheetId: string) {
		let n = 0;
		for (const line of this.lines)
			if (line.boxId === boxId && line.sheetId === null) {
				line.sheetId = sheetId;
				n += 1;
			}
		return n;
	}
	async sheetTotals(ids: readonly string[]) {
		const out: Record<string, { inPaise: number; outPaise: number }> = {};
		for (const line of this.lines)
			if (line.sheetId && ids.includes(line.sheetId)) {
				const row = (out[line.sheetId] ??= { inPaise: 0, outPaise: 0 });
				row.inPaise += line.inPaise;
				row.outPaise += line.outPaise;
			}
		return out;
	}
	async insertPetty(expense: PettyExpense) {
		this.pettyRows.push(expense);
	}
	async pettyPaidOn(date: string, paidTo: string) {
		return this.pettyRows
			.filter((p) => p.date === date && payeeKey(p.paidTo) === payeeKey(paidTo))
			.reduce((sum, p) => sum + p.amountPaise, 0);
	}
	async pettySinceRefill(boxId: string) {
		return this.pettyRows.filter((p) => p.boxId === boxId && !p.refillId);
	}
	async markRefilled(ids: readonly string[], refillId: string) {
		for (const p of this.pettyRows) if (ids.includes(p.id)) p.refillId = refillId;
	}
	async listPetty(query: Parameters<CashRepository['listPetty']>[0]) {
		const items = this.pettyRows.filter(
			(p) =>
				p.date >= query.from &&
				p.date <= query.to &&
				(!query.boxIds || query.boxIds.includes(p.boxId)) &&
				(!query.search || p.paidTo.includes(query.search)),
		);
		return { items, total: items.length, totalPaise: items.reduce((s, p) => s + p.amountPaise, 0) };
	}
	async insertClaim(claim: ExpenseClaim) {
		this.claimMap.set(claim.id, claim);
	}
	async claim(id: string) {
		return this.claimMap.get(id) ?? null;
	}
	async saveClaim(claim: ExpenseClaim, expectedVersion: number) {
		if (this.claimMap.get(claim.id)?.version !== expectedVersion) throw new Error('expense_claim_changed');
		const next = { ...claim, version: expectedVersion + 1 };
		this.claimMap.set(claim.id, next);
		return next;
	}
	async listClaims(query: Parameters<CashRepository['listClaims']>[0]) {
		const base = [...this.claimMap.values()].filter(
			(c) => !query.locationIds || query.locationIds.includes(c.locationId),
		);
		const chip = (c: string) => base.filter((x) => c === 'all' || x.status === c);
		return {
			items: chip(query.chip),
			total: chip(query.chip).length,
			counts: {
				all: base.length,
				waiting: chip('waiting').length,
				approved: chip('approved').length,
				paid: chip('paid').length,
				rejected: chip('rejected').length,
			},
		};
	}
	async claimsForPayroll(month: string) {
		return [...this.claimMap.values()].filter((c) => c.payrollMonth === month);
	}
}

const group = (id: string, systemKey: string, parentId: string | null = null, roles: string[] = []) => ({
	id,
	name: id,
	systemKey,
	parentId,
	nature: 'asset' as const,
	roles,
	tradingAccount: false,
	active: true,
	createdAt: AT,
	updatedAt: AT,
	updatedBy: null,
});
const ledger = (id: string, groupId: string, systemKey: string | null = null, active = true) => ({
	id,
	name: id,
	groupId,
	systemKey,
	nature: 'asset' as const,
	roles: [],
	handPosting: true,
	active,
	createdAt: AT,
	updatedAt: AT,
	updatedBy: null,
});

/** A chart with cash, a bank and an overdraft, two petty heads, and every role cash posts to. */
export function cashChart(): ChartOfAccounts {
	return {
		groups: [
			group('g_cash', 'cash_in_hand'),
			group('g_bank', 'bank_accounts'),
			group('g_od', 'bank_od'),
			group('g_exp', 'indirect_expenses'),
			group('g_petty', 'petty_expenses', 'g_exp', ['petty_expenses']),
		],
		ledgers: [
			ledger('led_hdfc', 'g_bank'),
			ledger('led_od', 'g_od'),
			ledger('led_ref', 'g_petty'),
			ledger('led_conv', 'g_petty'),
			ledger('led_old_head', 'g_petty', null, false),
			ledger('led_debtors', 'g_exp', 'debtors_control'),
			ledger('led_staff', 'g_exp', 'staff_advance'),
			ledger('led_short', 'g_exp', 'cash_short_over'),
			ledger('led_susp', 'g_exp', 'cash_over_suspense'),
			ledger('led_other', 'g_exp', 'other_income'),
			ledger('led_theft', 'g_exp', 'loss_by_theft'),
			ledger('led_ins', 'g_exp', 'insurance_claim_receivable'),
			ledger('led_fake', 'g_exp', 'counterfeit_loss'),
			ledger('led_emp', 'g_exp', 'employee_payable'),
			ledger('led_icgst', 'g_exp', 'input_cgst'),
			ledger('led_isgst', 'g_exp', 'input_sgst'),
			ledger('led_iigst', 'g_exp', 'input_igst'),
		],
	} as unknown as ChartOfAccounts;
}

type Listener = (voucher: JournalVoucher, context: TransactionContext) => Promise<void>;
interface PostLine {
	ledger: { id: string } | { role: string };
	locationId: string;
	debitPaise?: number;
	creditPaise?: number;
}

/** The ledger as cash uses it: posts (resolving roles), keeps balances, tells listeners, adds and renames ledgers. */
export class MemoryLedger {
	chartNow = cashChart();
	vouchers: JournalVoucher[] = [];
	listeners: Listener[] = [];
	superAdmins = new Set<string>(['adm_owner']);
	refuse: string | null = null;
	saved: unknown[] = [];

	onPosted(listener: Listener) {
		this.listeners.push(listener);
	}
	async chart() {
		return this.chartNow;
	}
	async isSuperAdmin(principal: { userId: string } | undefined) {
		return !!principal && this.superAdmins.has(principal.userId);
	}
	async addLedger(write: { name: string; groupId: string }) {
		const id = `led_box${this.chartNow.ledgers.length}`;
		this.chartNow.ledgers.push(ledger(id, write.groupId) as never);
		return { id, name: write.name };
	}
	async saveLedger(id: string, write: { name: string; active: boolean }) {
		this.saved.push([id, write.name, write.active]);
		const found = this.chartNow.ledgers.find((l) => l.id === id) as { name: string; active: boolean };
		found.name = write.name;
		found.active = write.active;
	}
	async post(
		request: {
			kind?: string;
			date: string;
			narration: string;
			lines: readonly PostLine[];
			source: { type: string; id: string; number?: string | null };
			idempotencyKey: string;
		},
		context: TransactionContext,
		by: string | null = null,
	) {
		if (this.refuse) throw new Error(this.refuse);
		const lines = request.lines.map((line) => {
			const target =
				'id' in line.ledger
					? line.ledger.id
					: (this.chartNow.ledgers.find((l) => rolesOf(l).includes((line.ledger as { role: string }).role))
							?.id ?? `missing:${(line.ledger as { role: string }).role}`);
			return {
				ledgerId: target,
				locationId: line.locationId,
				debitPaise: line.debitPaise ?? 0,
				creditPaise: line.creditPaise ?? 0,
				narration: '',
				gstRegistrationId: null,
			};
		});
		const voucher = {
			id: `jv_${this.vouchers.length + 1}`,
			number: `JV/26-27/${String(this.vouchers.length + 1).padStart(6, '0')}`,
			kind: request.kind ?? 'document',
			date: request.date,
			narration: request.narration,
			lines,
			source: { number: null, ...request.source },
			createdBy: by,
			createdAt: AT,
		} as unknown as JournalVoucher;
		this.vouchers.push(voucher);
		for (const listener of this.listeners) await listener(voucher, context);
		return voucher;
	}
	/** Debit less credit of a ledger over every voucher. */
	balance(ledgerId: string) {
		return this.vouchers
			.flatMap((v) => v.lines)
			.filter((l) => l.ledgerId === ledgerId)
			.reduce((sum, l) => sum + l.debitPaise - l.creditPaise, 0);
	}
}
