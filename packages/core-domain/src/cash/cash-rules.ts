import type {
	CarriedDifference,
	CashCount,
	CashCountWrite,
	CashLineKind,
	CashSettlementHow,
	CashSheet,
	CashSheetLine,
	CashSheetRow,
	ChartTemplateGroup,
	ChartTemplateLedger,
	Denomination,
	PettyExpense,
} from '@saha-textile/contracts';

/**
 * Cash (accounts brief O1–O14, the posting rules "Petty expense", "Cash deposited", "Cash short written off / excess",
 * and the ten ways to settle a difference). Pure rules: what a count adds up to, what a close count answers, what each
 * settlement posts, petty GST splits and refills. The cash ledger always holds the expected amount; a count is what is
 * physically there; a carried line is the gap between them until a manager settles it.
 */

/** A ledger posted to by id (a box, a bank, a head) or by the role it plays. */
export type CashLedgerRef = { id: string } | { role: string };

export interface CashPostingLine {
	ledger: CashLedgerRef;
	debitPaise: number;
	creditPaise: number;
}

const dr = (ledger: CashLedgerRef, paise: number): CashPostingLine => ({ ledger, debitPaise: paise, creditPaise: 0 });
const cr = (ledger: CashLedgerRef, paise: number): CashPostingLine => ({ ledger, debitPaise: 0, creditPaise: paise });

/* ------------------------------------------------------------------ counting */

/** The notes and coins a count asks for, in O1's order with notes before coins, largest first. */
export function countingOrder(denominations: readonly Denomination[]): Denomination[] {
	return denominations
		.filter((d) => d.on)
		.sort((a, b) => (a.kind === b.kind ? b.valuePaise - a.valuePaise : a.kind === 'note' ? -1 : 1));
}

/**
 * A count as typed, checked against the notes and coins switched on (refused with `count_unknown_denomination`), with
 * its total worked out here rather than trusted from the page.
 */
export function countOf(
	write: CashCountWrite,
	denominations: readonly Denomination[],
	at: string,
	by: string | null,
): CashCount {
	const allowed = new Set(countingOrder(denominations).map((d) => `${d.kind}:${d.valuePaise}`));
	const rows = write.rows.filter((row) => row.count > 0 || allowed.has(`${row.kind}:${row.valuePaise}`));
	if (rows.some((row) => !allowed.has(`${row.kind}:${row.valuePaise}`)))
		throw new Error('count_unknown_denomination');
	const seen = new Set<string>();
	for (const row of rows) {
		const key = `${row.kind}:${row.valuePaise}`;
		if (seen.has(key)) throw new Error('count_repeats_a_denomination');
		seen.add(key);
	}
	return { rows, totalPaise: rows.reduce((sum, row) => sum + row.valuePaise * row.count, 0), at, by };
}

/** What should physically be in the box: the books, less every difference still carried (a short is negative). */
export function expectedInBox(bookPaise: number, carried: readonly CarriedDifference[]): number {
	return carried.reduce((sum, row) => sum + row.differencePaise, bookPaise);
}

/**
 * O5–O7: a close count's answer, never an amount or a direction. A count that matches (or is within the auto-accept
 * limit) closes the sheet; the first that doesn't asks for a count again; later ones may be submitted with a difference.
 */
export function closeOutcome(input: {
	countedPaise: number;
	expectedPaise: number;
	attempt: number;
	autoAcceptUpToPaise: number;
}): 'closed' | 'count_again' | 'still_off' {
	const gap = Math.abs(input.countedPaise - input.expectedPaise);
	if (gap === 0 || gap <= input.autoAcceptUpToPaise) return 'closed';
	return input.attempt <= 1 ? 'count_again' : 'still_off';
}

/* ------------------------------------------------------------------ settling a difference (O8) */

/** The ways a manager may choose for a short (less cash than expected) and for an excess. */
export const SHORT_SETTLEMENTS: readonly CashSettlementHow[] = [
	'counting_mistake',
	'missed_payment_out',
	'cash_found',
	'banked_not_recorded',
	'recover_from_staff',
	'write_off',
	'theft',
	'counterfeit',
];
export const EXCESS_SETTLEMENTS: readonly CashSettlementHow[] = ['counting_mistake', 'missed_money_in', 'excess_suspense'];

/** The ways a manager may settle this difference: those for a short, or those for an excess. */
export function settlementsFor(differencePaise: number): readonly CashSettlementHow[] {
	return differencePaise < 0 ? SHORT_SETTLEMENTS : EXCESS_SETTLEMENTS;
}

export interface SettlementInput {
	how: CashSettlementHow;
	/** Counted less expected: negative = short. */
	differencePaise: number;
	boxLedgerId: string;
	/** The sheet's own day (missed entries are dated there). */
	sheetDate: string;
	/** Today (most settlements are dated the day they are settled). */
	today: string;
	ledgerId: string | null;
	bankLedgerId: string | null;
	depositDate: string | null;
	staffUserId: string | null;
	repayBy: 'cash' | 'payroll' | null;
	consent: boolean;
	policeReport: string | null;
	insured: boolean;
	recountPaise: number | null;
	/** What the books expected at close; a counting mistake's recount must match it. */
	expectedPaise: number;
}

/** Refusal codes for a settlement that can't be made as asked. */
export function settlementProblem(input: SettlementInput): string | null {
	if (input.differencePaise === 0) return 'nothing_to_settle';
	if (input.how !== 'auto_accepted' && !settlementsFor(input.differencePaise).includes(input.how))
		return 'settlement_wrong_direction';
	switch (input.how) {
		case 'counting_mistake':
			if (input.recountPaise === null) return 'recount_required';
			return input.recountPaise === input.expectedPaise ? null : 'recount_doesnt_match';
		case 'missed_payment_out':
		case 'missed_money_in':
			return input.ledgerId ? null : 'ledger_required';
		case 'banked_not_recorded':
			if (!input.bankLedgerId) return 'bank_required';
			return input.depositDate ? null : 'deposit_date_required';
		case 'recover_from_staff':
			if (!input.staffUserId) return 'staff_required';
			if (!input.repayBy) return 'repay_by_required';
			return input.repayBy === 'payroll' && !input.consent ? 'consent_required' : null;
		case 'theft':
			return input.policeReport ? null : 'police_report_required';
		default:
			return null;
	}
}

/**
 * What a settlement posts and on which day (the brief's "ten ways to settle" table). A counting mistake and cash that
 * turned up post nothing: the cash and the books agree again.
 */
export function settlementPosting(input: SettlementInput): { date: string; lines: CashPostingLine[] } | null {
	const amount = Math.abs(input.differencePaise);
	const box = { id: input.boxLedgerId };
	const short = input.differencePaise < 0;
	switch (input.how) {
		case 'counting_mistake':
		case 'cash_found':
			return null;
		case 'missed_payment_out':
			return { date: input.sheetDate, lines: [dr({ id: input.ledgerId as string }, amount), cr(box, amount)] };
		case 'missed_money_in':
			return { date: input.sheetDate, lines: [dr(box, amount), cr({ id: input.ledgerId as string }, amount)] };
		case 'banked_not_recorded':
			return {
				date: input.depositDate as string,
				lines: [dr({ id: input.bankLedgerId as string }, amount), cr(box, amount)],
			};
		case 'recover_from_staff':
			return { date: input.today, lines: [dr({ role: 'staff_advance' }, amount), cr(box, amount)] };
		case 'write_off':
			return { date: input.today, lines: [dr({ role: 'cash_short_over' }, amount), cr(box, amount)] };
		case 'theft':
			return {
				date: input.today,
				lines: [
					dr({ role: input.insured ? 'insurance_claim_receivable' : 'loss_by_theft' }, amount),
					cr(box, amount),
				],
			};
		case 'counterfeit':
			return { date: input.today, lines: [dr({ role: 'counterfeit_loss' }, amount), cr(box, amount)] };
		case 'excess_suspense':
			return { date: input.today, lines: [dr(box, amount), cr({ role: 'cash_over_suspense' }, amount)] };
		default:
			// auto_accepted: a small difference written off (or taken in) by the system.
			return {
				date: input.today,
				lines: short
					? [dr({ role: 'cash_short_over' }, amount), cr(box, amount)]
					: [dr(box, amount), cr({ role: 'cash_short_over' }, amount)],
			};
	}
}

/** An excess held in suspense becomes other income once its days are up. */
export function suspenseRelease(amountPaise: number): CashPostingLine[] {
	return [dr({ role: 'cash_over_suspense' }, amountPaise), cr({ role: 'other_income' }, amountPaise)];
}

/** The day an excess leaves suspense: the settlement day plus the days set in Settings › Cash boxes. */
export function suspenseUntil(today: string, days: number): string {
	const at = new Date(`${today}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + days);
	return at.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ moving cash (O3 "typed here") */

/** A bank deposit, cash from the bank, or a move to another box: always a contra between two money ledgers. */
export function cashMovePosting(
	kind: 'bank_deposit' | 'bank_withdrawal' | 'box_move',
	amountPaise: number,
	boxLedgerId: string,
	otherLedgerId: string,
): CashPostingLine[] {
	const box = { id: boxLedgerId };
	const other = { id: otherLedgerId };
	return kind === 'bank_withdrawal'
		? [dr(box, amountPaise), cr(other, amountPaise)]
		: [dr(other, amountPaise), cr(box, amountPaise)];
}

/* ------------------------------------------------------------------ petty expenses (O4) and refills (O13) */

/**
 * The GST inside a bill's total at a rate: the taxable value rounded to the paisa, the tax split half and half within
 * the State (the odd paisa to SGST) or all IGST across States.
 */
export function gstInside(
	totalPaise: number,
	ratePercent: number,
	interState: boolean,
): { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number } {
	const taxablePaise = Math.round((totalPaise * 100) / (100 + ratePercent));
	const tax = totalPaise - taxablePaise;
	if (interState) return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
	const cgstPaise = Math.floor(tax / 2);
	return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0 };
}

/** "Petty expense": the head (and input GST on a GST bill with our GSTIN) against the box. */
export function pettyPosting(
	expense: Pick<PettyExpense, 'headLedgerId' | 'amountPaise' | 'gst'>,
	boxLedgerId: string,
): CashPostingLine[] {
	const gst = expense.gst;
	const lines = [dr({ id: expense.headLedgerId }, gst ? gst.taxablePaise : expense.amountPaise)];
	if (gst) {
		if (gst.cgstPaise) lines.push(dr({ role: 'input_cgst' }, gst.cgstPaise));
		if (gst.sgstPaise) lines.push(dr({ role: 'input_sgst' }, gst.sgstPaise));
		if (gst.igstPaise) lines.push(dr({ role: 'input_igst' }, gst.igstPaise));
	}
	return [...lines, cr({ id: boxLedgerId }, expense.amountPaise)];
}

/**
 * Income-tax s.40A(3) (RS-LIMITS `cash_payment_one_person`): cash paid to one person in a day above the limit is not
 * allowed as an expense. Payees are matched by name, ignoring case and spaces.
 */
export function payeeKey(name: string): string {
	return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function withinCashLimit(paidTodayPaise: number, amountPaise: number, limitPaise: number | null): boolean {
	return limitPaise === null || paidTodayPaise + amountPaise <= limitPaise;
}

/** O13: what a fixed float spent since its last refill, by head, and what brings it back to its float. */
export function refillOf(
	floatPaise: number,
	bookPaise: number,
	expenses: readonly Pick<PettyExpense, 'headLedgerId' | 'headName' | 'amountPaise'>[],
): {
	spentPaise: number;
	refillPaise: number;
	heads: { headLedgerId: string; name: string; entries: number; spentPaise: number }[];
} {
	const heads = new Map<string, { headLedgerId: string; name: string; entries: number; spentPaise: number }>();
	for (const expense of expenses) {
		const head = heads.get(expense.headLedgerId) ?? {
			headLedgerId: expense.headLedgerId,
			name: expense.headName,
			entries: 0,
			spentPaise: 0,
		};
		head.entries += 1;
		head.spentPaise += expense.amountPaise;
		heads.set(expense.headLedgerId, head);
	}
	const spentPaise = expenses.reduce((sum, e) => sum + e.amountPaise, 0);
	return {
		spentPaise,
		refillPaise: Math.max(0, floatPaise - bookPaise),
		heads: [...heads.values()].sort((a, b) => b.spentPaise - a.spentPaise),
	};
}

/* ------------------------------------------------------------------ expense claims (O12) */

/** On approval: the head against what is owed to the staff member. */
export function claimApprovalPosting(headLedgerId: string, amountPaise: number): CashPostingLine[] {
	return [dr({ id: headLedgerId }, amountPaise), cr({ role: 'employee_payable' }, amountPaise)];
}

/** Paid back from a petty box or a bank. */
export function claimPaymentPosting(fromLedgerId: string, amountPaise: number): CashPostingLine[] {
	return [dr({ role: 'employee_payable' }, amountPaise), cr({ id: fromLedgerId }, amountPaise)];
}

/* ------------------------------------------------------------------ the sheet as people see it (O3, O10) */

/** Which line a voucher makes on a box's sheet, from what posted it. */
export function lineKindOf(sourceType: string, voucherKind: string): CashLineKind {
	const bySource: Record<string, CashLineKind> = {
		counterSale: 'counter_sale',
		creditNoteRefund: 'cash_refund',
		refundVoucher: 'cash_refund',
		codHandIn: 'cod_handed_in',
		orderPayment: 'receipt',
		businessReceipt: 'receipt',
		pettyExpense: 'petty_expense',
		cashMove: 'box_move',
		bankDeposit: 'bank_deposit',
		bankWithdrawal: 'bank_withdrawal',
		pettyRefill: 'refill',
		expenseClaimPayment: 'claim_paid',
		cashSettlement: 'settlement',
		supplierPayment: 'payment',
		paymentVoucher: 'payment',
	};
	const known = bySource[sourceType];
	if (known) return known;
	if (voucherKind === 'receipt') return 'receipt';
	if (voucherKind === 'payment') return 'payment';
	if (voucherKind === 'contra') return 'box_move';
	return 'journal';
}

/**
 * A sheet's rows: the opening count, every difference carried in, then its lines in time order. Managers see each
 * line's amount and the expected after it (a carried row shows its own amount, as O10 draws); a cashier sees what
 * happened and who did it, never an amount, while the sheet is open (O3).
 */
export function sheetRows(input: {
	sheet: Pick<CashSheet, 'id' | 'openedAt' | 'opening' | 'carried'>;
	lines: readonly CashSheetLine[];
	expectedNowPaise: number;
	amounts: boolean;
	nameOf: (id: string | null) => string | null;
	labels: { opening: string; carried: (date: string) => string };
}): CashSheetRow[] {
	const lines = [...input.lines].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
	const moved = lines.reduce((sum, line) => sum + line.inPaise - line.outPaise, 0);
	const carried = input.sheet.carried.reduce((sum, row) => sum + row.differencePaise, 0);
	let running = input.expectedNowPaise - moved - carried;
	const shown = (paise: number | null) => (input.amounts ? paise : null);
	const rows: CashSheetRow[] = [
		{
			id: `${input.sheet.id}:opening`,
			at: input.sheet.openedAt,
			kind: 'opening',
			what: input.labels.opening,
			ref: null,
			by: input.nameOf(input.sheet.opening.by),
			inPaise: null,
			outPaise: null,
			expectedPaise: shown(running),
			addedOnReview: false,
		},
	];
	for (const row of input.sheet.carried) {
		running += row.differencePaise;
		rows.push({
			id: `${input.sheet.id}:carried:${row.sheetId}`,
			at: input.sheet.openedAt,
			kind: 'carried',
			what: input.labels.carried(row.date),
			ref: null,
			by: null,
			inPaise: null,
			outPaise: null,
			expectedPaise: shown(row.differencePaise),
			addedOnReview: false,
		});
	}
	for (const line of lines) {
		running += line.inPaise - line.outPaise;
		rows.push({
			id: line.id,
			at: line.at,
			kind: line.kind,
			what: line.what,
			ref: line.ref,
			by: input.nameOf(line.by),
			inPaise: shown(line.inPaise),
			outPaise: shown(line.outPaise),
			expectedPaise: shown(running),
			addedOnReview: line.addedOnReview,
		});
	}
	return rows;
}

/* ------------------------------------------------------------------ the ledgers cash needs (CH-COMMON v3) */

const pettyHead = (key: string, name: string): ChartTemplateLedger => ({
	key,
	name,
	groupKey: 'petty_expenses',
	handPosting: true,
	roles: [],
	ruleSetCode: null,
	source: '',
});
const roleLedger = (key: string, name: string, groupKey: string): ChartTemplateLedger => ({
	key,
	name,
	groupKey,
	handPosting: false,
	roles: [key],
	ruleSetCode: null,
	source: '',
});

/** The petty expense heads (O4, O13): the ledgers of this group; more can be added on Accounts › Ledgers. */
export const PETTY_GROUP: ChartTemplateGroup = {
	key: 'petty_expenses',
	name: 'Petty expenses',
	parentKey: 'indirect_expenses',
	nature: 'expense',
	tradingAccount: false,
	roles: ['petty_expenses'],
};

export const CASH_LEDGERS: ChartTemplateLedger[] = [
	pettyHead('refreshments', 'Refreshments and staff welfare'),
	pettyHead('customer_hospitality', 'Customer hospitality'),
	pettyHead('local_conveyance', 'Local delivery and conveyance'),
	pettyHead('courier_postage', 'Courier and postage'),
	pettyHead('stationery', 'Stationery and printing'),
	pettyHead('cleaning', 'Cleaning and upkeep'),
	pettyHead('small_repairs', 'Small repairs'),
	pettyHead('miscellaneous', 'Miscellaneous expenses'),
	roleLedger('loss_by_theft', 'Loss by theft', 'indirect_expenses'),
	roleLedger('counterfeit_loss', 'Counterfeit note loss', 'indirect_expenses'),
	roleLedger('insurance_claim_receivable', 'Insurance claims receivable', 'loans_and_advances'),
	roleLedger('employee_payable', 'Staff reimbursements payable', 'current_liabilities'),
];
