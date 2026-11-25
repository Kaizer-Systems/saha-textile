import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GstReturnDraft, TaxInvoice, TaxRuleEntry } from '@saha-textile/contracts';
import { DUE_DATES } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesModule } from '../src/accounts-templates/accounts-templates.module';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { GstReturnsController } from '../src/gst/gst-returns.controller';
import { GstReturnsService } from '../src/gst/gst-returns.service';
import { GstSchemesService } from '../src/gst/gst-schemes.service';
import { GstModule } from '../src/gst/gst.module';
import { Gstr2bController } from '../src/gst/gstr2b.controller';
import { Gstr2bService } from '../src/gst/gstr2b.service';
import { Gstr3bInputs } from '../src/gst/gstr3b-inputs';

/** GST returns from the books (accounts brief G3, G4): prepare GSTR-1, check, approve, and the returns calendar. */

const at = '2026-11-28T06:00:00.000Z';
const now = new Date(at);
const GSTIN = '19DBYPS6736R1ZZ';
const accountant = { userId: 'adm_acc', permissions: ['accounts.post'] } as never;
const ca = { userId: 'adm_ca', permissions: ['accounts.post', 'accounts.lock'] } as never;
const refusal = (code: string) => ({ response: { message: code } });

const terms = (from: string, over: Record<string, unknown> = {}) => ({
	from,
	kind: 'regular',
	scheme: 'monthly',
	compositionRatePercent: null,
	lastYearTurnoverINR: 0,
	eInvoice: false,
	eInvoiceThirtyDays: false,
	annualReturn: true,
	reconciliationStatement: false,
	hsnDigits: 6,
	...over,
});
const REGISTRATIONS: Record<string, unknown> = {
	reg_wb: { id: 'reg_wb', gstin: GSTIN, stateCode: '19', terms: [terms('2026-04-01')] },
	// Registered from December: November has no terms of its own.
	reg_late: { id: 'reg_late', gstin: '19AABCG1234A1Z5', stateCode: '19', terms: [terms('2026-12-01')] },
	// Monthly from January, then QRMP from July with no annual return.
	reg_qrmp: {
		id: 'reg_qrmp',
		gstin: GSTIN,
		stateCode: '19',
		terms: [terms('2026-07-01', { scheme: 'qrmp', annualReturn: false }), terms('2026-01-01')],
	},
};

const line = (over: Record<string, unknown> = {}) => ({
	lineId: 'a',
	sku: 'S',
	title: 'Saree',
	hsn: '50071090',
	quantity: 1,
	unit: 'PCS',
	unitPriceINR: 1050,
	ratePercent: 5,
	taxableINR: 1000,
	cgstINR: 25,
	sgstINR: 25,
	igstINR: 0,
	totalINR: 1050,
	...over,
});
const invoice = (id: string, number: string, over: Record<string, unknown> = {}) =>
	({
		id,
		number,
		date: '2026-11-10',
		gstRegistrationId: 'reg_wb',
		gstin: GSTIN,
		locationId: 'loc_bar',
		orderId: `ord_${id}`,
		orderNumber: `ST-${id}`,
		shipmentId: null,
		seller: { name: 'K.R. Marketing', gstin: GSTIN, address: '', stateCode: '19' },
		buyer: { name: 'Ananya Das', gstin: null, address: '', stateCode: '19' },
		placeOfSupply: '19',
		interState: false,
		lines: [line()],
		shippingINR: 0,
		taxableINR: 1000,
		cgstINR: 25,
		sgstINR: 25,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 1050,
		ratesPendingCa: true,
		status: 'issued',
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: at,
		...over,
	}) as unknown as TaxInvoice;
const creditNote = (id: string, number: string, invoiceId: string) => ({
	...invoice(id, number, { date: '2026-11-20' }),
	invoiceId,
	invoiceNumber: 'TI/26-27/000001',
	invoiceDate: '2026-11-10',
	kind: 'goods_returned',
});

const draft = (id: string, over: Partial<GstReturnDraft> = {}): GstReturnDraft => ({
	id,
	gstRegistrationId: 'reg_wb',
	gstin: GSTIN,
	returnType: 'GSTR-1',
	month: '2026-11',
	status: 'prepared',
	summary: [],
	problems: [],
	portal: {},
	preparedBy: 'adm_acc',
	preparedAt: at,
	checkedBy: null,
	checkedAt: null,
	approvedBy: null,
	approvedAt: null,
	preparedByName: '',
	checkedByName: '',
	approvedByName: '',
	arn: null,
	filedOn: null,
	setOff: null,
	adjustments: [],
	setOffVoucherId: null,
	challanVoucherId: null,
	version: 0,
	...over,
});

function build(
	options: {
		drafts?: GstReturnDraft[];
		filings?: unknown[];
		invoices?: TaxInvoice[];
		creditNotes?: unknown[];
		debitNotes?: unknown[];
		originals?: TaxInvoice[];
		saveFails?: unknown;
		/** The installed due-date rule set's entries (RS-DUE); the starter rules unless given. */
		rules?: readonly TaxRuleEntry[];
		/** GSTR-3B's figures from the books and 2B; nothing happened unless given. */
		books?: typeof NO_BOOKS;
	} = {},
) {
	const store = new Map((options.drafts ?? []).map((d) => [d.id, d]));
	const drafts = {
		get: async (id: string) => store.get(id) ?? null,
		find: async (registrationId: string, returnType: string, month: string) =>
			[...store.values()].find(
				(d) => d.gstRegistrationId === registrationId && d.returnType === returnType && d.month === month,
			) ?? null,
		listForRegistration: async (registrationId: string) =>
			[...store.values()].filter((d) => d.gstRegistrationId === registrationId),
		save: vi.fn(async (next: GstReturnDraft, expectedVersion: number | null) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			const before = store.get(next.id);
			if (expectedVersion !== null && before?.version !== expectedVersion) throw new Error('gst_draft_changed');
			const saved = { ...next, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			store.set(next.id, saved);
			return saved;
		}),
	};
	const invoices = {
		listForGstin: vi.fn(async (_gstin: string, _from: string, _to: string) => options.invoices ?? []),
		get: vi.fn(async (id: string) => (options.originals ?? []).find((i) => i.id === id) ?? null),
	};
	const credit = { listForGstin: vi.fn(async () => options.creditNotes ?? []) };
	const debit = { listForGstin: vi.fn(async () => options.debitNotes ?? []) };
	const templates = {
		ruleSetEntries: vi.fn(async (_code: string, _day: string) => [...(options.rules ?? DUE_DATES.entries)]),
	};
	const inputs = { collect: vi.fn(async (_registration: string, _month: string) => options.books ?? NO_BOOKS) };
	const heads = (cgst = 0) => ({ igst: 0, cgst, sgst: cgst });
	const schemes = {
		work: vi.fn(),
		quarterGstr1: vi.fn(async () => ({ summary: [], problems: [], portal: {} })),
		quarterGstr3b: vi.fn(async () => ({
			summary: [],
			problems: [],
			portal: {},
			setOff: {
				liability: heads(),
				credit: heads(),
				igstUsed: heads(),
				cgstUsed: { cgst: 0, igst: 0 },
				sgstUsed: { sgst: 0, igst: 0 },
				cash: heads(),
				carried: heads(),
			},
			reverseChargeCash: heads(),
			deposited: heads(100),
		})),
	};
	const service = new GstReturnsService(
		drafts as never,
		{ list: async () => options.filings ?? [] } as never,
		{ getRegistration: async (id: string) => REGISTRATIONS[id] ?? null } as never,
		invoices as never,
		credit as never,
		debit as never,
		templates,
		{
			findById: async (id: string) => {
				if (id === 'adm_down') throw new Error('people lookup down');
				return ADMINS[id] ?? null;
			},
		} as never,
		inputs,
		schemes,
	);
	return { service, drafts, store, invoices, credit, debit, templates, inputs, schemes };
}

/** GSTR-3B's figures from the books when nothing happened in the month. */
const NO_BOOKS = {
	selfInvoices: [],
	twoBImported: false,
	itc2b: { igst: 0, cgst: 0, sgst: 0 },
	acceptedNotInBooks: 0,
	reversedInBooks: { igst: 0, cgst: 0, sgst: 0 },
	rule37: { igst: 0, cgst: 0, sgst: 0 },
	reclaimed: { igst: 0, cgst: 0, sgst: 0 },
};

/** The people who take the steps: by display name, else email, else username. */
const ADMINS: Record<string, unknown> = {
	adm_acc: { displayName: 'Sudip Ghosh', email: 'sudip@saha-textile.test', username: 'sudip' },
	adm_ca: { displayName: '', email: 'ca@saha-textile.test', username: 'ca' },
	adm_rina: { displayName: null, email: null, username: 'rina' },
	adm_blank: { displayName: '', email: '', username: '' },
};
const person = (userId: string, permissions: string[] = ['accounts.post', 'accounts.lock']) =>
	({ userId, permissions }) as never;

/** An entry of the due-date rule set, as the CA adds one. */
const dueEntry = (key: string, due: NonNullable<TaxRuleEntry['due']>): TaxRuleEntry => ({
	key,
	name: key,
	code: '',
	ratePercent: 0,
	expenseRole: null,
	kinds: null,
	from: '2017-07-01',
	to: null,
	source: '',
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
	due,
});

const prepare = (over: Record<string, unknown> = {}) =>
	({ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-11', ...over }) as never;

describe('preparing GSTR-1 from the books (G4)', () => {
	it('refuses GSTR-3B before its GSTR-1 is filed, a registration it doesn’t know, and a month already filed', async () => {
		const { service } = build({
			filings: [{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-11', arn: 'AA1911261234567' }],
		});
		const notReady = service.prepare(prepare({ returnType: 'GSTR-3B', month: '2026-10' }), accountant, now);
		await expect(notReady).rejects.toBeInstanceOf(BadRequestException);
		await expect(notReady).rejects.toMatchObject(refusal('gst_gstr1_not_filed'));
		const unknown = service.prepare(prepare({ gstRegistrationId: 'reg_gone' }), accountant, now);
		await expect(unknown).rejects.toBeInstanceOf(NotFoundException);
		await expect(unknown).rejects.toMatchObject(refusal('gst_registration_unknown'));
		await expect(service.prepare(prepare(), accountant, now)).rejects.toMatchObject(refusal('gst_return_filed'));
	});

	it('refuses again once the draft is approved or filed', async () => {
		for (const status of ['approved', 'filed'] as const) {
			const { service } = build({ drafts: [draft('gsr_1', { status })] });
			await expect(service.prepare(prepare(), accountant, now)).rejects.toMatchObject(
				refusal('gst_return_approved'),
			);
		}
	});

	it('works out a new draft from the month’s invoices and notes, each note’s invoice read once', async () => {
		const original = invoice('ti_1', 'TI/26-27/000001');
		const { service, drafts, invoices, credit, debit } = build({
			// Another registration's filing, another return and another month: none is this one.
			filings: [
				{ gstRegistrationId: 'reg_other', returnType: 'GSTR-1', month: '2026-11' },
				{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-11' },
				{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-10' },
			],
			invoices: [original, invoice('ti_2', 'TI/26-27/000002')],
			creditNotes: [
				creditNote('cn_1', 'CN/26-27/000001', 'ti_1'),
				creditNote('cn_2', 'CN/26-27/000002', 'ti_1'),
				creditNote('cn_3', 'CN/26-27/000003', 'ti_gone'),
			],
			originals: [original],
		});
		const prepared = await service.prepare(prepare(), accountant, now);
		expect(invoices.listForGstin).toHaveBeenCalledWith(GSTIN, '2026-11-01', '2026-11-30');
		expect(credit.listForGstin).toHaveBeenCalledWith(GSTIN, '2026-11-01', '2026-11-30');
		expect(debit.listForGstin).toHaveBeenCalledWith(GSTIN, '2026-11-01', '2026-11-30');
		expect(invoices.get.mock.calls.map(([id]) => id)).toEqual(['ti_1', 'ti_gone']);
		expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'prepared' }), null);
		expect(prepared).toMatchObject({
			gstRegistrationId: 'reg_wb',
			gstin: GSTIN,
			returnType: 'GSTR-1',
			month: '2026-11',
			status: 'prepared',
			preparedBy: 'adm_acc',
			preparedAt: at,
			version: 0,
		});
		expect(prepared.id).toMatch(/^gsr_/);
		// The note whose invoice is gone can't be placed; HSN of 8 digits passes the 6 the registration needs.
		expect(prepared.problems).toEqual([
			{ table: '9B', problem: 'note_invoice_missing', document: 'CN/26-27/000003' },
		]);
		expect(prepared.summary.length).toBeGreaterThan(0);
		expect(prepared.portal).toMatchObject({ gstin: GSTIN });
	});

	it('asks for 4-digit HSN when the registration has no terms for the month', async () => {
		const short = invoice('ti_1', 'TI/26-27/000001', { lines: [line({ hsn: '5007' })] });
		const late = await build({ invoices: [short] }).service.prepare(
			prepare({ gstRegistrationId: 'reg_late' }),
			accountant,
			now,
		);
		expect(late.problems).toEqual([]);
		// The same invoice under a registration that needs 6 digits.
		const wb = await build({ invoices: [short] }).service.prepare(prepare(), accountant, now);
		expect(wb.problems).toEqual([{ table: '12', problem: 'hsn_digits', document: '5007' }]);
	});

	it('prepares a checked draft again over its version, by nobody when no one is signed in', async () => {
		const { service, drafts } = build({
			drafts: [draft('gsr_1', { status: 'checked', checkedBy: 'adm_acc', checkedAt: at, version: 3 })],
		});
		const again = await service.prepare(prepare(), undefined);
		expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'gsr_1', version: 3 }), 3);
		expect(again).toMatchObject({
			id: 'gsr_1',
			status: 'prepared',
			preparedBy: null,
			checkedBy: null,
			checkedAt: null,
			version: 4,
		});
		expect(again.preparedByName).toBe('');
		const prepared = build({ drafts: [draft('gsr_2')] });
		expect((await prepared.service.prepare(prepare(), accountant, now)).id).toBe('gsr_2');
	});
});

describe('preparing GSTR-3B from the filed GSTR-1, the books and 2B (G6)', () => {
	const filedGstr1 = (gstRegistrationId: string, month: string) => ({
		gstRegistrationId,
		returnType: 'GSTR-1',
		month,
		arn: 'AA1912261234567',
		filedOn: `${month}-11`,
	});
	const sample = { table: '4B' as const, igst: 0, cgst: 100, sgst: 100, reason: 'Saree given away as a sample' };

	it('hands a quarterly filer’s GSTR-1 and GSTR-3B to the quarter’s own working', async () => {
		const { service, schemes } = build({ filings: [filedGstr1('reg_qrmp', '2026-09')] });
		const three = await service.prepare(
			prepare({ gstRegistrationId: 'reg_qrmp', returnType: 'GSTR-3B', month: '2026-09', adjustments: [] }),
			accountant,
			now,
		);
		expect(schemes.quarterGstr1).toHaveBeenCalledTimes(1);
		expect(schemes.quarterGstr3b).toHaveBeenCalledTimes(1);
		expect(three.setOff?.deposited).toEqual({ igst: 0, cgst: 100, sgst: 100 });
	});

	it('takes outward supplies from the GSTR-1 draft, figures from the books, and keeps the set-off and changes', async () => {
		const filings: unknown[] = [];
		const { service, invoices, inputs } = build({
			filings,
			invoices: [invoice('ti_1', 'TI/26-27/000001')],
			books: { ...NO_BOOKS, twoBImported: true, itc2b: { igst: 0, cgst: 1_000, sgst: 1_000 } },
		});
		const gstr1 = await service.prepare(prepare(), accountant, now);
		// A GSTR-1 draft has no set-off and no changes.
		expect(gstr1).toMatchObject({ setOff: null, adjustments: [] });
		filings.push(filedGstr1('reg_wb', '2026-11'));
		const gstr3b = await service.prepare(
			prepare({ returnType: 'GSTR-3B', adjustments: [sample] }),
			accountant,
			now,
		);
		expect(invoices.listForGstin).toHaveBeenCalledTimes(1);
		expect(inputs.collect).toHaveBeenCalledWith('reg_wb', '2026-11');
		expect(gstr3b).toMatchObject({
			returnType: 'GSTR-3B',
			status: 'prepared',
			problems: [],
			adjustments: [sample],
			portal: { gstin: GSTIN, ret_period: '112026' },
		});
		expect(gstr3b.summary.find((row) => row.table === '3.1a')).toMatchObject({
			records: 1,
			taxable: 1000,
			tax: 50,
		});
		// Output CGST and SGST of ₹25 each, less credit of ₹10 each and ₹1 each taken back: ₹16 each in cash.
		expect(gstr3b.setOff).toMatchObject({
			cash: { igst: 0, cgst: 1_600, sgst: 1_600 },
			reverseChargeCash: { igst: 0, cgst: 0, sgst: 0 },
		});
	});

	it('works GSTR-1 out again from the books when it was filed without a draft here', async () => {
		const { service, invoices } = build({
			filings: [filedGstr1('reg_wb', '2026-11'), filedGstr1('reg_late', '2026-11')],
			invoices: [invoice('ti_1', 'TI/26-27/000001')],
		});
		const gstr3b = await service.prepare(prepare({ returnType: 'GSTR-3B', adjustments: [] }), accountant, now);
		expect(invoices.listForGstin).toHaveBeenCalledWith(GSTIN, '2026-11-01', '2026-11-30');
		expect(gstr3b.summary.find((row) => row.table === '3.1a')).toMatchObject({ records: 1, tax: 50 });
		// No 2B imported for the month yet.
		expect(gstr3b.problems).toEqual([{ table: '4A', problem: 'gstr2b_missing', document: '2026-11' }]);
		// A registration with no terms for the month is not a quarterly filer.
		const late = await service.prepare(
			prepare({ gstRegistrationId: 'reg_late', returnType: 'GSTR-3B', adjustments: [] }),
			accountant,
			now,
		);
		expect(late.returnType).toBe('GSTR-3B');
	});
});

describe('who took each step, by name (G4)', () => {
	it('keeps the name of who prepared, checked and approved, and starts a new draft unfiled', async () => {
		const { service } = build();
		const prepared = await service.prepare(prepare(), accountant, now);
		expect(prepared).toMatchObject({
			preparedByName: 'Sudip Ghosh',
			checkedByName: '',
			approvedByName: '',
			arn: null,
			filedOn: null,
		});
		const checked = await service.step(prepared.id, { to: 'checked', version: 0 }, person('adm_rina'), now);
		expect(checked).toMatchObject({ checkedBy: 'adm_rina', checkedByName: 'rina', preparedByName: 'Sudip Ghosh' });
		const approved = await service.step(prepared.id, { to: 'approved', version: 1 }, ca, now);
		expect(approved).toMatchObject({ approvedBy: 'adm_ca', approvedByName: 'ca@saha-textile.test' });
	});

	it('names someone by their user id when the account has no name, is gone, or can’t be read', async () => {
		for (const userId of ['adm_blank', 'adm_gone', 'adm_down']) {
			const { service } = build();
			expect((await service.prepare(prepare(), person(userId), now)).preparedByName).toBe(userId);
		}
	});
});

describe('a filed return (G4)', () => {
	const filing = {
		gstRegistrationId: 'reg_wb',
		gstin: GSTIN,
		returnType: 'GSTR-1',
		month: '2026-11',
		arn: 'AA1912261234567',
		filedOn: '2026-12-10',
	};

	it('reads filed with the ARN and the day once its filing is entered, and takes no more steps', async () => {
		const { service } = build({
			drafts: [draft('gsr_1', { status: 'approved' }), draft('gsr_oct', { month: '2026-10' })],
			filings: [filing],
		});
		expect(await service.get('gsr_1')).toMatchObject({
			status: 'filed',
			arn: 'AA1912261234567',
			filedOn: '2026-12-10',
		});
		// October has no filing of its own.
		expect(await service.get('gsr_oct')).toMatchObject({ status: 'prepared', arn: null, filedOn: null });
		for (const to of ['checked', 'approved'] as const)
			await expect(service.step('gsr_1', { to, version: 0 }, ca, now)).rejects.toMatchObject(
				refusal('gst_return_wrong_step'),
			);
	});
});

describe('checking and approving a return (G4)', () => {
	it('opens a draft, and refuses one that doesn’t exist', async () => {
		const { service } = build({ drafts: [draft('gsr_1')] });
		expect((await service.get('gsr_1')).id).toBe('gsr_1');
		const missing = service.get('gsr_9');
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('gst_draft_not_found'));
	});

	it('the accountant checks a prepared draft, once', async () => {
		const { service } = build({ drafts: [draft('gsr_1')] });
		expect(await service.step('gsr_1', { to: 'checked', version: 0 }, accountant, now)).toMatchObject({
			status: 'checked',
			checkedBy: 'adm_acc',
			checkedAt: at,
			version: 1,
		});
		await expect(service.step('gsr_1', { to: 'checked', version: 1 }, accountant, now)).rejects.toMatchObject(
			refusal('gst_return_wrong_step'),
		);
	});

	it('approves only a checked draft, only by someone who may lock the books, and only with nothing to fix', async () => {
		const prepared = build({ drafts: [draft('gsr_1')] });
		await expect(prepared.service.step('gsr_1', { to: 'approved', version: 0 }, ca, now)).rejects.toMatchObject(
			refusal('gst_return_wrong_step'),
		);
		const checked = build({ drafts: [draft('gsr_1', { status: 'checked' })] });
		await expect(
			checked.service.step('gsr_1', { to: 'approved', version: 0 }, accountant, now),
		).rejects.toMatchObject(refusal('gst_return_approver_only'));
		await expect(
			checked.service.step('gsr_1', { to: 'approved', version: 0 }, undefined, now),
		).rejects.toMatchObject(refusal('gst_return_approver_only'));
		const withProblems = build({
			drafts: [
				draft('gsr_1', {
					status: 'checked',
					problems: [{ table: '12', problem: 'hsn_digits', document: '5007' }],
				}),
			],
		});
		await expect(withProblems.service.step('gsr_1', { to: 'approved', version: 0 }, ca)).rejects.toMatchObject(
			refusal('gst_return_has_problems'),
		);
		expect(await checked.service.step('gsr_1', { to: 'approved', version: 0 }, ca, now)).toMatchObject({
			status: 'approved',
			approvedBy: 'adm_ca',
			approvedAt: at,
			version: 1,
		});
	});

	it('says someone saved first, and passes on any other failure to save', async () => {
		const stale = build({ drafts: [draft('gsr_1', { version: 2 })] });
		const changed = stale.service.step('gsr_1', { to: 'checked', version: 1 }, accountant, now);
		await expect(changed).rejects.toBeInstanceOf(ConflictException);
		await expect(changed).rejects.toMatchObject(refusal('gst_draft_changed'));
		const diskFull = new Error('disk full');
		await expect(
			build({ drafts: [draft('gsr_1')], saveFails: diskFull }).service.step(
				'gsr_1',
				{ to: 'checked', version: 0 },
				accountant,
				now,
			),
		).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ saveFails: odd }).service.prepare(prepare(), accountant, now)).rejects.toBe(odd);
	});
});

describe('the returns calendar (G3)', () => {
	const calendarOf = (
		chip: 'due' | 'filed' | 'all',
		options: Parameters<typeof build>[0] = {},
		registration = 'reg_qrmp',
	) => build(options).service.calendar({ gstRegistrationId: registration, chip }, new Date('2026-11-27T20:00:00Z'));

	const options = {
		drafts: [
			draft('gsr_sep', { gstRegistrationId: 'reg_qrmp', month: '2026-09', status: 'checked' }),
			draft('gsr_jun3b', { gstRegistrationId: 'reg_qrmp', returnType: 'GSTR-3B', month: '2026-06' }),
		],
		filings: [
			{ gstRegistrationId: 'reg_qrmp', returnType: 'GSTR-1', month: '2026-06', arn: 'AA1907261234567' },
			{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-05', arn: 'AA1906261234567' },
		],
	};

	it('lists the 12 months before this one in India, newest due first, with each return where it stands', async () => {
		// 01:30 on 28 Nov in India: November is this month, so November 2025 to October 2026 are looked at; terms start in January.
		const all = await calendarOf('all', options);
		expect(all.gstin).toBe(GSTIN);
		expect(all.rows.map((r) => [r.returnType, r.period, r.dueOn, r.status, r.arn, r.draftId])).toEqual([
			// March has an annual return under the January terms.
			['GSTR-9', '2025-26', '2026-12-31', 'not_started', null, null],
			// QRMP from July: only September, the quarter's end; West Bengal's GSTR-3B is due on the 24th.
			['GSTR-3B', '2026-09', '2026-10-24', 'not_started', null, null],
			['GSTR-1', '2026-09', '2026-10-13', 'checked', null, 'gsr_sep'],
			['GSTR-3B', '2026-06', '2026-07-20', 'prepared', null, 'gsr_jun3b'],
			['GSTR-1', '2026-06', '2026-07-11', 'filed', 'AA1907261234567', null],
			['GSTR-3B', '2026-05', '2026-06-20', 'not_started', null, null],
			['GSTR-1', '2026-05', '2026-06-11', 'not_started', null, null],
			['GSTR-3B', '2026-04', '2026-05-20', 'not_started', null, null],
			['GSTR-1', '2026-04', '2026-05-11', 'not_started', null, null],
			['GSTR-3B', '2026-03', '2026-04-20', 'not_started', null, null],
			['GSTR-1', '2026-03', '2026-04-11', 'not_started', null, null],
			['GSTR-3B', '2026-02', '2026-03-20', 'not_started', null, null],
			['GSTR-1', '2026-02', '2026-03-11', 'not_started', null, null],
			['GSTR-3B', '2026-01', '2026-02-20', 'not_started', null, null],
			['GSTR-1', '2026-01', '2026-02-11', 'not_started', null, null],
		]);
		expect(all.counts).toEqual({ due: 14, filed: 1, all: 15 });
	});

	it('shows the filed returns, or the ones still due', async () => {
		const filed = await calendarOf('filed', options);
		expect(filed.rows.map((r) => [r.returnType, r.period])).toEqual([['GSTR-1', '2026-06']]);
		const due = await calendarOf('due', options);
		expect(due.rows).toHaveLength(14);
		expect(due.rows.every((r) => r.status !== 'filed')).toBe(true);
	});

	it('reads the due-date rule set installed on the day in India, and refuses when none is installed', async () => {
		const { service, templates } = build();
		await service.calendar({ gstRegistrationId: 'reg_qrmp', chip: 'all' }, new Date('2026-11-27T20:00:00Z'));
		expect(templates.ruleSetEntries).toHaveBeenCalledWith('RS-DUE', '2026-11-28');
		const none = calendarOf('all', { rules: [] });
		await expect(none).rejects.toBeInstanceOf(BadRequestException);
		await expect(none).rejects.toMatchObject(refusal('gst_due_dates_not_installed'));
	});

	it('leaves out the annual return when no rule gives its date', async () => {
		const noAnnual = DUE_DATES.entries.filter((entry) => entry.due?.returnType !== 'GSTR-9');
		const all = await calendarOf('all', { rules: noAnnual });
		expect(all.rows.map((r) => r.returnType)).not.toContain('GSTR-9');
		expect(all.counts).toEqual({ due: 14, filed: 0, all: 14 });
	});

	it('takes an extension for one month, and puts GSTR-1 first when both fall due the same day', async () => {
		// The CA extends May's GSTR-1 to 20 June, the day its GSTR-3B is due.
		const extended = [
			...DUE_DATES.entries,
			dueEntry('gstr1_may_extended', {
				returnType: 'GSTR-1',
				scheme: 'monthly',
				day: 20,
				monthsAfter: 1,
				states: ['19'],
				period: '2026-05',
			}),
		];
		const all = await calendarOf('all', { rules: extended });
		const may = all.rows.filter((r) => r.period === '2026-05');
		expect(may.map((r) => [r.returnType, r.dueOn])).toEqual([
			['GSTR-1', '2026-06-20'],
			['GSTR-3B', '2026-06-20'],
		]);
	});

	it('refuses a registration it doesn’t know, and reads today when no day is given', async () => {
		await expect(calendarOf('all', {}, 'reg_gone')).rejects.toMatchObject(refusal('gst_registration_unknown'));
		const today = await build().service.calendar({ gstRegistrationId: 'reg_wb', chip: 'all' });
		expect(today.rows.length).toBeGreaterThan(0);
	});
});

describe('the GST return routes', () => {
	it('hand each call to the service; reading needs accounts.index, preparing accounts.edit, a step accounts.post', () => {
		const returns = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new GstReturnsController(returns as never);
		const query = { gstRegistrationId: 'reg_wb', chip: 'due' } as const;
		const body = prepare();
		const stepTo = { to: 'checked', version: 0 } as const;
		expect([
			c.calendar(query),
			c.prepare(body, accountant),
			c.prepare(body),
			c.get('gsr_1'),
			c.step('gsr_1', stepTo, ca),
			c.step('gsr_1', stepTo),
		]).toEqual([
			['calendar', query],
			['prepare', body, accountant],
			['prepare', body, undefined],
			['get', 'gsr_1'],
			['step', 'gsr_1', stepTo, ca],
			['step', 'gsr_1', stepTo, undefined],
		]);
		const perm = (m: keyof GstReturnsController) =>
			new Reflector().get(PERMISSIONS_KEY, GstReturnsController.prototype[m]);
		expect([perm('calendar'), perm('prepare'), perm('get'), perm('step')]).toEqual([
			['accounts.index'],
			['accounts.edit'],
			['accounts.index'],
			['accounts.post'],
		]);
		expect(Reflect.getMetadata('providers', GstModule)).toEqual([
			GstReturnsService,
			GstSchemesService,
			Gstr2bService,
			Gstr3bInputs,
		]);
		expect(Reflect.getMetadata('controllers', GstModule)).toEqual([GstReturnsController, Gstr2bController]);
		// Due dates come from the rule sets the templates library keeps.
		expect(Reflect.getMetadata('imports', GstModule)).toEqual([AccountsTemplatesModule]);
	});
});
