import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { Paise } from './ledger';
import { IsoDate } from './purchasing';

/**
 * Cash (accounts brief O1–O14): cash boxes per location, the day's sheet a cashier opens by counting the float and
 * closes by counting the till blind, petty expenses paid from a box, refills of a fixed float, staff expense claims,
 * and the ten ways a manager settles a difference. Every amount is in paise. A box has its own ledger; every voucher
 * that touches it writes a line on its sheet, so the sheet and the books always agree.
 */

/** Signed paise (a difference, a carried line). */
export const SignedPaise = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export type SignedPaise = z.infer<typeof SignedPaise>;

/* ------------------------------------------------------------------ settings (O1) */

export const DenominationKind = z.enum(['note', 'coin']);
export type DenominationKind = z.infer<typeof DenominationKind>;

/** A note or coin the count asks for; `on` = in circulation here (O1). */
export const Denomination = z.object({
	valuePaise: z.number().int().positive(),
	kind: DenominationKind,
	on: z.boolean(),
});
export type Denomination = z.infer<typeof Denomination>;

/** O1's grid, in its order: what is in circulation today is on; the ₹2000 note and the rare small notes are off. */
export const DEFAULT_DENOMINATIONS: readonly Denomination[] = [
	{ valuePaise: 50_000, kind: 'note', on: true },
	{ valuePaise: 20_000, kind: 'note', on: true },
	{ valuePaise: 10_000, kind: 'note', on: true },
	{ valuePaise: 5_000, kind: 'note', on: true },
	{ valuePaise: 2_000, kind: 'note', on: true },
	{ valuePaise: 1_000, kind: 'note', on: true },
	{ valuePaise: 2_000, kind: 'coin', on: true },
	{ valuePaise: 1_000, kind: 'coin', on: true },
	{ valuePaise: 500, kind: 'coin', on: true },
	{ valuePaise: 200, kind: 'coin', on: true },
	{ valuePaise: 100, kind: 'coin', on: true },
	{ valuePaise: 200_000, kind: 'note', on: false },
	{ valuePaise: 500, kind: 'note', on: false },
	{ valuePaise: 200, kind: 'note', on: false },
	{ valuePaise: 100, kind: 'note', on: false },
];

/** A day sheet is opened and closed every day (a till); a fixed float is refilled back to its amount (petty cash). */
export const CashBoxKind = z.enum(['day_sheet', 'fixed_float']);
export type CashBoxKind = z.infer<typeof CashBoxKind>;

export const CashCounter = z.enum(['cashier', 'location_manager']);
export type CashCounter = z.infer<typeof CashCounter>;

/** Who settles its differences: a location manager (`cash.manage`) or the owner (the Administrator role). */
export const CashReviewer = z.enum(['location_manager', 'owner']);
export type CashReviewer = z.infer<typeof CashReviewer>;

export const CashBox = z.object({
	id: Id,
	name: z.string().trim().min(1).max(60),
	locationId: Id,
	kind: CashBoxKind,
	/** The float counted in each morning (day sheet) or refilled back to (fixed float). */
	floatPaise: Paise,
	countedBy: CashCounter,
	reviewedBy: CashReviewer,
	/** The box's own ledger, under Cash in hand. */
	ledgerId: Id,
	active: z.boolean(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type CashBox = z.infer<typeof CashBox>;

export const CashRules = z.object({
	/** A petty expense over this needs a bill or photo. */
	billPhotoOverPaise: Paise,
	/** An excess nobody can explain stays in suspense this many days, then becomes other income. */
	suspenseDays: z.number().int().min(1).max(365),
	/** A difference up to this closes the sheet and is written off by itself; 0 = every difference goes to a manager. */
	autoAcceptUpToPaise: Paise,
});
export type CashRules = z.infer<typeof CashRules>;

export const DEFAULT_CASH_RULES: CashRules = { billPhotoOverPaise: 50_000, suspenseDays: 30, autoAcceptUpToPaise: 0 };

export const CashSettings = z.object({
	denominations: z.array(Denomination).min(1),
	rules: CashRules,
	updatedAt: IsoDateTime.nullable(),
});
export type CashSettings = z.infer<typeof CashSettings>;

export const CashBoxWrite = z.object({
	/** Absent for a new box. */
	id: Id.optional(),
	name: z.string().trim().min(1).max(60),
	locationId: Id,
	kind: CashBoxKind,
	floatPaise: Paise,
	countedBy: CashCounter,
	reviewedBy: CashReviewer,
	active: z.boolean().default(true),
});
export type CashBoxWrite = z.infer<typeof CashBoxWrite>;

/** O1 Save: the boxes, the notes and coins, and the rules, in one go. */
export const CashSettingsWrite = z.object({
	boxes: z.array(CashBoxWrite).max(200),
	denominations: z.array(Denomination).min(1).max(30),
	rules: CashRules,
});
export type CashSettingsWrite = z.infer<typeof CashSettingsWrite>;

export const CashSettingsView = z.object({
	settings: CashSettings,
	boxes: z.array(CashBox),
});
export type CashSettingsView = z.infer<typeof CashSettingsView>;

/* ------------------------------------------------------------------ counts and sheets (O2–O11, O14) */

export const CountRow = z.object({
	valuePaise: z.number().int().positive(),
	kind: DenominationKind,
	count: z.number().int().min(0).max(1_000_000),
});
export type CountRow = z.infer<typeof CountRow>;

export const CashCount = z.object({
	rows: z.array(CountRow).max(30),
	totalPaise: Paise,
	at: IsoDateTime,
	by: Id.nullable(),
});
export type CashCount = z.infer<typeof CashCount>;

/** What a person types: how many of each; the total is worked out on the server. */
export const CashCountWrite = z.object({ rows: z.array(CountRow).min(1).max(30) });
export type CashCountWrite = z.infer<typeof CashCountWrite>;

/** open → closed (the count matched), or difference (submitted with one) → settled by a manager. */
export const CashSheetStatus = z.enum(['open', 'closed', 'difference', 'settled']);
export type CashSheetStatus = z.infer<typeof CashSheetStatus>;

/** A difference an earlier sheet closed with and nobody has settled yet, carried on every later sheet (O10). */
export const CarriedDifference = z.object({
	sheetId: Id,
	date: IsoDate,
	differencePaise: SignedPaise,
});
export type CarriedDifference = z.infer<typeof CarriedDifference>;

export const CashSettlementHow = z.enum([
	'counting_mistake',
	'missed_payment_out',
	'missed_money_in',
	'cash_found',
	'banked_not_recorded',
	'recover_from_staff',
	'write_off',
	'theft',
	'counterfeit',
	'excess_suspense',
	/** Within Settings › Cash boxes "Auto-accept a difference up to": written off by the system. */
	'auto_accepted',
]);
export type CashSettlementHow = z.infer<typeof CashSettlementHow>;

export const CashSettlement = z.object({
	how: CashSettlementHow,
	note: z.string().max(1000),
	at: IsoDateTime,
	by: Id.nullable(),
	/** The voucher it posted (none for a counting mistake or cash found). */
	voucherId: Id.nullable(),
	/** Counting mistake: the manager's own recount. */
	recount: CashCount.nullable(),
	/** Missed entries: the ledger the money went to or came from. */
	ledgerId: Id.nullable(),
	/** Banked but not recorded. */
	bankLedgerId: Id.nullable(),
	depositSlip: z.string().max(40).nullable(),
	depositDate: IsoDate.nullable(),
	/** Recover from a staff member. */
	staffUserId: Id.nullable(),
	staffName: z.string().max(120).nullable(),
	repayBy: z.enum(['cash', 'payroll']).nullable(),
	/** Theft: the police report number; insured → an insurance claim instead of a loss. */
	policeReport: z.string().max(60).nullable(),
	insured: z.boolean(),
	/** Counterfeit: the note's details for the report to the bank. */
	noteDetails: z.string().max(300).nullable(),
	/** Excess in suspense: the day it becomes other income, and that voucher once made. */
	suspenseUntil: IsoDate.nullable(),
	releaseVoucherId: Id.nullable(),
});
export type CashSettlement = z.infer<typeof CashSettlement>;

export const CashSheet = z.object({
	id: Id,
	boxId: Id,
	locationId: Id,
	/** The sheet's day (India). */
	date: IsoDate,
	status: CashSheetStatus,
	openedAt: IsoDateTime,
	openedBy: Id.nullable(),
	opening: CashCount,
	/** What the books held (with every carried difference) when it opened; the opening count is compared silently. */
	openingExpectedPaise: SignedPaise,
	carried: z.array(CarriedDifference),
	/** Every close count, in order (both are kept, O6). */
	counts: z.array(CashCount),
	closedAt: IsoDateTime.nullable(),
	closedBy: Id.nullable(),
	/** Closed after its day had ended (O14: "closed late"). */
	closedLate: z.boolean(),
	expectedAtClosePaise: SignedPaise.nullable(),
	/** Counted less expected at close: negative = short. */
	differencePaise: SignedPaise.nullable(),
	settlement: CashSettlement.nullable(),
	version: z.number().int().nonnegative(),
	updatedAt: IsoDateTime,
});
export type CashSheet = z.infer<typeof CashSheet>;

/** What arrived on the sheet: from counter sales, refunds, COD hand-ins, or typed here. */
export const CashLineKind = z.enum([
	'counter_sale',
	'cash_refund',
	'cod_handed_in',
	'receipt',
	'petty_expense',
	'bank_deposit',
	'bank_withdrawal',
	'box_move',
	'refill',
	'claim_paid',
	'settlement',
	'payment',
	'journal',
]);
export type CashLineKind = z.infer<typeof CashLineKind>;

export const CashSheetLine = z.object({
	id: Id,
	/** Null while no sheet of the box is open; the next sheet opened takes it. */
	sheetId: Id.nullable(),
	boxId: Id,
	at: IsoDateTime,
	date: IsoDate,
	kind: CashLineKind,
	what: z.string().max(200),
	ref: z.string().max(60).nullable(),
	by: Id.nullable(),
	inPaise: Paise,
	outPaise: Paise,
	voucherId: Id,
	/** Added by a manager settling a difference on an earlier sheet (O8). */
	addedOnReview: z.boolean(),
});
export type CashSheetLine = z.infer<typeof CashSheetLine>;

/** One row of a sheet as a person sees it: a cashier gets no amounts while the sheet is open (O3). */
export const CashSheetRow = z.object({
	id: Id,
	at: IsoDateTime,
	kind: z.union([CashLineKind, z.enum(['opening', 'carried'])]),
	what: z.string(),
	ref: z.string().nullable(),
	by: z.string().nullable(),
	inPaise: Paise.nullable(),
	outPaise: Paise.nullable(),
	/** The running expected after this row (a carried row: its own amount); managers only. */
	expectedPaise: SignedPaise.nullable(),
	addedOnReview: z.boolean(),
});
export type CashSheetRow = z.infer<typeof CashSheetRow>;

export const CashSheetView = z.object({
	sheet: CashSheet,
	box: CashBox,
	locationName: z.string(),
	openedByName: z.string().nullable(),
	closedByName: z.string().nullable(),
	rows: z.array(CashSheetRow),
	/** Whether this person sees amounts (a manager) or not (a cashier while it is open). */
	amounts: z.boolean(),
	/** Managers only: the expected now (open) or at close. */
	expectedPaise: SignedPaise.nullable(),
	/** The notes and coins to count, in order. */
	denominations: z.array(Denomination),
});
export type CashSheetView = z.infer<typeof CashSheetView>;

/**
 * Today's sheet for a box: open (with it), or what stands in the way of opening one: an earlier sheet still open
 * (O14), or one closed with a difference nobody has settled (O9, open anyway carries it).
 */
export const TodaysSheet = z.object({
	box: CashBox,
	boxes: z.array(CashBox),
	today: IsoDate,
	sheet: CashSheetView.nullable(),
	stillOpen: z.object({ sheetId: Id, date: IsoDate }).nullable(),
	unsettled: z.array(CarriedDifference),
	denominations: z.array(Denomination),
});
export type TodaysSheet = z.infer<typeof TodaysSheet>;

export const OpenSheetWrite = z.object({
	boxId: Id,
	count: CashCountWrite,
	/** O9: open although an earlier difference waits for a manager. */
	carryDifference: z.boolean().default(false),
});
export type OpenSheetWrite = z.infer<typeof OpenSheetWrite>;

/** The answer to a close count: never an amount or a direction (O6). */
export const CloseCountResult = z.object({
	result: z.enum(['closed', 'count_again', 'still_off']),
	/** 1-based. */
	attempt: z.number().int().positive(),
});
export type CloseCountResult = z.infer<typeof CloseCountResult>;

export const SubmitDifferenceWrite = z.object({ confirm: z.literal(true) });

/** Typed on the sheet: a bank deposit, cash from the bank, or a move to another box. */
export const CashMoveWrite = z.object({
	kind: z.enum(['bank_deposit', 'bank_withdrawal', 'box_move']),
	amountPaise: Paise.refine((value) => value > 0, { message: 'amount_required' }),
	/** A bank ledger (deposit, withdrawal) or another box (move). */
	toId: Id,
	slip: z.string().trim().max(40).default(''),
	note: z.string().trim().max(200).default(''),
});
export type CashMoveWrite = z.infer<typeof CashMoveWrite>;

export const CashSettleWrite = z.object({
	how: CashSettlementHow.exclude(['auto_accepted']),
	note: z.string().trim().max(1000).default(''),
	recount: CashCountWrite.nullable().default(null),
	ledgerId: Id.nullable().default(null),
	bankLedgerId: Id.nullable().default(null),
	depositSlip: z.string().trim().max(40).nullable().default(null),
	depositDate: IsoDate.nullable().default(null),
	staffUserId: Id.nullable().default(null),
	repayBy: z.enum(['cash', 'payroll']).nullable().default(null),
	/** Recovery through payroll needs the staff member's written consent. */
	consent: z.boolean().default(false),
	policeReport: z.string().trim().max(60).nullable().default(null),
	insured: z.boolean().default(false),
	noteDetails: z.string().trim().max(300).nullable().default(null),
	version: z.number().int().nonnegative(),
});
export type CashSettleWrite = z.infer<typeof CashSettleWrite>;

/* ------------------------------------------------------------------ the cash sheets list (O11) */

export const CASH_SHEET_CHIPS = ['all', 'difference', 'open'] as const;
export const CashSheetChip = z.enum(CASH_SHEET_CHIPS);

export const CashSheetListQuery = z
	.object({
		from: IsoDate,
		to: IsoDate,
		chip: CashSheetChip.default('all'),
		locationId: Id.nullable().default(null),
		search: z.string().trim().max(80).default(''),
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(25),
	})
	.refine((query) => query.from <= query.to, { message: 'period_backwards', path: ['from'] });
export type CashSheetListQuery = z.infer<typeof CashSheetListQuery>;

export const CashSheetListRow = z.object({
	id: Id,
	date: IsoDate,
	boxName: z.string(),
	locationName: z.string(),
	status: CashSheetStatus,
	openingPaise: Paise.nullable(),
	inPaise: Paise.nullable(),
	outPaise: Paise.nullable(),
	countedPaise: Paise.nullable(),
	differencePaise: SignedPaise.nullable(),
	openedBy: z.string().nullable(),
});
export type CashSheetListRow = z.infer<typeof CashSheetListRow>;

export const CashSheetList = z.object({
	items: z.array(CashSheetListRow),
	total: z.number().int().nonnegative(),
	counts: z.record(CashSheetChip, z.number().int().nonnegative()),
	amounts: z.boolean(),
});
export type CashSheetList = z.infer<typeof CashSheetList>;

/* ------------------------------------------------------------------ petty expenses and refills (O4, O13) */

export const PettyGstBill = z.object({
	supplierGstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, { message: 'gstin_shape' }),
	supplierName: z.string().trim().max(120).default(''),
	billNumber: z.string().trim().min(1).max(16),
	billDate: IsoDate,
	ratePercent: z.number().min(0).max(28),
	taxablePaise: Paise,
	cgstPaise: Paise,
	sgstPaise: Paise,
	igstPaise: Paise,
});
export type PettyGstBill = z.infer<typeof PettyGstBill>;

export const PettyExpense = z.object({
	id: Id,
	/** PC/26-27/000412 (the petty cash series in Settings › Document numbers). */
	number: z.string(),
	boxId: Id,
	sheetId: Id.nullable(),
	locationId: Id,
	date: IsoDate,
	headLedgerId: Id,
	headName: z.string(),
	amountPaise: Paise,
	paidTo: z.string().max(120),
	whatFor: z.string().max(300),
	billMediaId: Id.nullable(),
	gst: PettyGstBill.nullable(),
	voucherId: Id,
	/** The refill that put it back, once one has. */
	refillId: Id.nullable(),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
});
export type PettyExpense = z.infer<typeof PettyExpense>;

export const PettyExpenseWrite = z.object({
	boxId: Id,
	headLedgerId: Id,
	amountPaise: Paise.refine((value) => value > 0, { message: 'amount_required' }),
	paidTo: z.string().trim().min(1).max(120),
	whatFor: z.string().trim().min(1).max(300),
	billMediaId: Id.nullable().default(null),
	gst: z
		.object({
			supplierGstin: PettyGstBill.shape.supplierGstin,
			supplierName: z.string().trim().max(120).default(''),
			billNumber: z.string().trim().min(1).max(16),
			billDate: IsoDate,
			ratePercent: z.number().min(0).max(28),
		})
		.nullable()
		.default(null),
});
export type PettyExpenseWrite = z.infer<typeof PettyExpenseWrite>;

/** O4's checks before paying: the cash limit to one payee in a day, an open sheet, the bill photo. */
export const PettyCheck = z.object({
	paidTodayPaise: Paise,
	limitPaise: Paise.nullable(),
	withinLimit: z.boolean(),
	sheetOpen: z.boolean(),
	openedAt: IsoDateTime.nullable(),
	billNeeded: z.boolean(),
});
export type PettyCheck = z.infer<typeof PettyCheck>;

export const PettyListQuery = z
	.object({
		from: IsoDate,
		to: IsoDate,
		boxId: Id.nullable().default(null),
		search: z.string().trim().max(80).default(''),
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(25),
	})
	.refine((query) => query.from <= query.to, { message: 'period_backwards', path: ['from'] });
export type PettyListQuery = z.infer<typeof PettyListQuery>;

export const PettyList = z.object({
	items: z.array(PettyExpense.extend({ boxName: z.string(), byName: z.string().nullable() })),
	total: z.number().int().nonnegative(),
	totalPaise: Paise,
});
export type PettyList = z.infer<typeof PettyList>;

/** O13: what a fixed float spent since its last refill, by head. */
export const RefillPreview = z.object({
	box: CashBox,
	spentPaise: Paise,
	/** What brings the box back to its float. */
	refillPaise: Paise,
	heads: z.array(
		z.object({
			headLedgerId: Id,
			name: z.string(),
			entries: z.number().int().nonnegative(),
			spentPaise: Paise,
		}),
	),
});
export type RefillPreview = z.infer<typeof RefillPreview>;

export const RefillWrite = z.object({
	fromLedgerId: Id,
	amountPaise: Paise.refine((value) => value > 0, { message: 'amount_required' }),
});
export type RefillWrite = z.infer<typeof RefillWrite>;

/* ------------------------------------------------------------------ expense claims (O12) */

export const ExpenseClaimStatus = z.enum(['waiting', 'approved', 'rejected', 'paid']);
export type ExpenseClaimStatus = z.infer<typeof ExpenseClaimStatus>;

export const ClaimPayBack = z.enum(['petty', 'salary', 'bank']);
export type ClaimPayBack = z.infer<typeof ClaimPayBack>;

export const ExpenseClaim = z.object({
	id: Id,
	/** EC/26-27/000017. */
	number: z.string(),
	staffUserId: Id,
	staffName: z.string(),
	locationId: Id,
	headLedgerId: Id,
	headName: z.string(),
	amountPaise: Paise,
	whatFor: z.string().max(300),
	billMediaId: Id.nullable(),
	billName: z.string().nullable(),
	spentOn: IsoDate,
	status: ExpenseClaimStatus,
	payBack: ClaimPayBack.nullable(),
	/** Petty: the box it is paid from; bank: the bank ledger; salary: the payroll month (YYYY-MM). */
	payBoxId: Id.nullable(),
	bankLedgerId: Id.nullable(),
	payrollMonth: z.string().nullable(),
	decidedAt: IsoDateTime.nullable(),
	decidedBy: Id.nullable(),
	rejectReason: z.string().max(300).nullable(),
	approvalVoucherId: Id.nullable(),
	paymentVoucherId: Id.nullable(),
	paidAt: IsoDateTime.nullable(),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
	version: z.number().int().nonnegative(),
});
export type ExpenseClaim = z.infer<typeof ExpenseClaim>;

export const ExpenseClaimWrite = z.object({
	/** Absent: the person's own claim. */
	staffUserId: Id.nullable().default(null),
	locationId: Id,
	headLedgerId: Id,
	amountPaise: Paise.refine((value) => value > 0, { message: 'amount_required' }),
	whatFor: z.string().trim().min(1).max(300),
	billMediaId: Id.nullable().default(null),
	spentOn: IsoDate,
});
export type ExpenseClaimWrite = z.infer<typeof ExpenseClaimWrite>;

export const ClaimDecisionWrite = z.discriminatedUnion('decision', [
	z.object({
		decision: z.literal('approve'),
		payBack: ClaimPayBack,
		payBoxId: Id.nullable().default(null),
		bankLedgerId: Id.nullable().default(null),
		version: z.number().int().nonnegative(),
	}),
	z.object({
		decision: z.literal('reject'),
		reason: z.string().trim().min(1).max(300),
		version: z.number().int().nonnegative(),
	}),
]);
export type ClaimDecisionWrite = z.infer<typeof ClaimDecisionWrite>;

export const CLAIM_CHIPS = ['all', 'waiting', 'approved', 'paid', 'rejected'] as const;
export const ClaimChip = z.enum(CLAIM_CHIPS);

export const ClaimListQuery = z
	.object({
		from: IsoDate,
		to: IsoDate,
		chip: ClaimChip.default('all'),
		search: z.string().trim().max(80).default(''),
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(25),
	})
	.refine((query) => query.from <= query.to, { message: 'period_backwards', path: ['from'] });
export type ClaimListQuery = z.infer<typeof ClaimListQuery>;

export const ClaimList = z.object({
	items: z.array(ExpenseClaim.extend({ locationName: z.string() })),
	total: z.number().int().nonnegative(),
	counts: z.record(ClaimChip, z.number().int().nonnegative()),
});
export type ClaimList = z.infer<typeof ClaimList>;
