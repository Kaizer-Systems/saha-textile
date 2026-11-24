import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GstReturnDraft, TaxInvoice } from '@saha-textile/contracts';
import { gstr1 } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { GstAnnualController } from '../src/gst/gst-annual.controller';
import { GstAnnualService } from '../src/gst/gst-annual.service';
import { GstReportsModule } from '../src/gst/gst-reports.module';
import { GstReturnsService } from '../src/gst/gst-returns.service';
import { GstModule } from '../src/gst/gst.module';
import { Gstr3bInputs } from '../src/gst/gstr3b-inputs';

/** GSTR-9 against the books, and each month's returns against the books (accounts brief G9, G7). */

const at = '2027-04-20T06:00:00.000Z';
const GSTIN = '19DBYPS6736R1ZZ';
const YEAR = '2026-27';
const refusal = (code: string) => ({ response: { message: code } });

/** A B2C invoice of the books on a day, rupees. */
const invoice = (id: string, date: string, taxableINR: number) =>
	({
		id,
		number: `TI/26-27/${id}`,
		date,
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
		lines: [
			{
				lineId: 'a',
				sku: 'S',
				title: 'Saree',
				hsn: '50071090',
				quantity: 1,
				unit: 'PCS',
				unitPriceINR: taxableINR * 1.05,
				ratePercent: 5,
				taxableINR,
				cgstINR: taxableINR * 0.025,
				sgstINR: taxableINR * 0.025,
				igstINR: 0,
				totalINR: taxableINR * 1.05,
			},
		],
		shippingINR: 0,
		taxableINR,
		cgstINR: taxableINR * 0.025,
		sgstINR: taxableINR * 0.025,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: taxableINR * 1.05,
		ratesPendingCa: true,
		status: 'issued',
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: at,
	}) as unknown as TaxInvoice;
const INVOICES = [invoice('nov', '2026-11-10', 1000), invoice('jan', '2027-01-15', 500)];
/** GSTR-1 from the books between two days, as the returns service works it out. */
const booksGstr1 = (from: string, to: string, month: string) =>
	gstr1({
		gstin: GSTIN,
		month,
		invoices: INVOICES.filter((i) => i.date >= from && i.date <= to),
		creditNotes: [],
		debitNotes: [],
		originals: new Map(),
		hsnDigits: 4,
	});

const draft = (id: string, over: Partial<GstReturnDraft>): GstReturnDraft =>
	({
		id,
		gstRegistrationId: 'reg_wb',
		gstin: GSTIN,
		returnType: 'GSTR-1',
		month: '2026-11',
		status: 'approved',
		summary: [],
		problems: [],
		portal: {},
		...over,
	}) as GstReturnDraft;
const november = booksGstr1('2026-11-01', '2026-11-30', '2026-11');
const DRAFTS = [
	// Filed GSTR-1 and GSTR-3B for November.
	draft('gsr_1_nov', { summary: november.summary, portal: november.portal as unknown as Record<string, unknown> }),
	draft('gsr_3b_nov', {
		returnType: 'GSTR-3B',
		summary: [
			{ table: '3.1a', records: 1, taxable: 1000, tax: 50 },
			{ table: '3.1b', records: 0, taxable: 0, tax: 0 },
			{ table: '4A', records: 0, taxable: 0, tax: 18 },
			{ table: '4B', records: 0, taxable: 0, tax: 2 },
		],
	}),
	// Not counted: October's GSTR-1 isn't filed (only another GSTIN's is), last year's is another year, and
	// December's GSTR-3B has only its GSTR-1 filed.
	draft('gsr_1_oct', { month: '2026-10', summary: [{ table: '7', records: 1, taxable: 9_999, tax: 99 }] }),
	draft('gsr_1_old', { month: '2025-11', summary: [{ table: '7', records: 1, taxable: 9_999, tax: 99 }] }),
	draft('gsr_3b_dec', {
		returnType: 'GSTR-3B',
		month: '2026-12',
		summary: [{ table: '4A', records: 0, taxable: 0, tax: 99 }],
	}),
];
const filing = (gstRegistrationId: string, returnType: string, month: string) => ({
	gstRegistrationId,
	returnType,
	month,
	arn: 'AA1912261234567',
});
const FILINGS = [
	filing('reg_wb', 'GSTR-1', '2026-11'),
	filing('reg_wb', 'GSTR-3B', '2026-11'),
	filing('reg_wb', 'GSTR-1', '2025-11'),
	filing('reg_wb', 'GSTR-1', '2026-12'),
	filing('reg_tr', 'GSTR-1', '2026-10'),
];

const LOCATIONS = [
	{
		id: 'loc_bar',
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-01-01',
		gstRegistrationId: 'reg_wb',
	},
];
const ENTRIES = [
	{ id: 'pe_1', itcClaimable: true, billDate: '2026-11-05', totals: { igstINR: 0, cgstINR: 9, sgstINR: 9 } },
	{ id: 'pe_2', itcClaimable: false, billDate: '2026-11-06', totals: { igstINR: 50, cgstINR: 0, sgstINR: 0 } },
];
const SELF_INVOICES = [
	{ id: 'si_1', date: '2026-11-20', taxINR: 10.8 },
	{ id: 'si_draft', date: null, taxINR: 99 },
];

function build(
	options: {
		saved?: { notes: Record<string, string>; version: number } | null;
		locations?: unknown[];
		saveFails?: unknown;
	} = {},
) {
	let saved = options.saved === undefined ? null : options.saved;
	const notes = {
		get: vi.fn(async (_registration: string, _year: string) => saved),
		save: vi.fn(
			async (_registration: string, _year: string, next: Record<string, string>, expected: number | null) => {
				if (options.saveFails !== undefined) throw options.saveFails;
				const version = expected === null ? 0 : expected + 1;
				saved = { notes: next, version };
				return version;
			},
		),
	};
	const returns = {
		gstr1Between: vi.fn(async (_registration: unknown, from: string, to: string, month: string) =>
			booksGstr1(from, to, month),
		),
	};
	const inputs = {
		reversedFor: vi.fn(async (_registration: string, _from: string, _to: string) => ({
			igst: 0,
			cgst: 100,
			sgst: 100,
		})),
	};
	const entries = { postedBetween: vi.fn(async (_from: string, _to: string) => ENTRIES) };
	const selfInvoices = {
		issuedForGstin: vi.fn(async (_registration: string, _from: string, _to: string) => SELF_INVOICES),
	};
	const service = new GstAnnualService(
		returns as never,
		inputs as never,
		{
			getRegistration: async (id: string) => (id === 'reg_wb' ? { id, gstin: GSTIN, stateCode: '19' } : null),
		} as never,
		{ listForRegistration: async () => DRAFTS } as never,
		{ list: async () => FILINGS } as never,
		notes as never,
		entries as never,
		selfInvoices as never,
		{ list: async () => options.locations ?? LOCATIONS } as never,
	);
	return { service, notes, returns, inputs, entries, selfInvoices };
}

const query = { gstRegistrationId: 'reg_wb', year: YEAR } as never;

describe('GSTR-9 against the books (G9)', () => {
	it('sets the year’s filed returns beside the books, table by table, with the notes kept', async () => {
		const { service, returns, inputs, entries, selfInvoices } = build({
			saved: { notes: { '6': 'A bill entered after its month' }, version: 2 },
		});
		const annual = await service.view(query);
		expect(returns.gstr1Between).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'reg_wb' }),
			'2026-04-01',
			'2027-03-31',
			'2027-03',
		);
		expect(inputs.reversedFor).toHaveBeenCalledWith('reg_wb', '2026-04-01', '2027-03-31');
		expect(entries.postedBetween).toHaveBeenCalledWith('2026-04-01', '2027-03-31');
		expect(selfInvoices.issuedForGstin).toHaveBeenCalledWith('reg_wb', '2026-04-01', '2027-03-31');
		expect(annual).toMatchObject({ gstin: GSTIN, year: YEAR, version: 2 });
		expect(annual.rows).toEqual([
			// November's filed GSTR-1 (₹1,000) against the year's books (₹1,000 in November and ₹500 in January).
			{ table: '4', returns: 100_000, books: 150_000, unit: 'paise', note: '' },
			{ table: '5', returns: 0, books: 0, unit: 'paise', note: '' },
			// GSTR-3B's ₹18 against the books' credit: ₹18 on a bill with credit and ₹10.80 on a self-invoice.
			{ table: '6', returns: 1_800, books: 2_880, unit: 'paise', note: 'A bill entered after its month' },
			{ table: '7', returns: 200, books: 200, unit: 'paise', note: '' },
			{ table: '17', returns: 1, books: 1, unit: 'count', note: '' },
		]);
	});

	it('checks every month’s returns against the books, with nothing for a return not filed', async () => {
		const { months } = await build().service.view(query);
		expect(months.map((m) => m.month)).toEqual([
			'2026-04',
			'2026-05',
			'2026-06',
			'2026-07',
			'2026-08',
			'2026-09',
			'2026-10',
			'2026-11',
			'2026-12',
			'2027-01',
			'2027-02',
			'2027-03',
		]);
		const of = (month: string) => months.find((m) => m.month === month);
		expect(of('2026-11')).toEqual({
			month: '2026-11',
			gstr1Tax: 5_000,
			gstr3bTax: 5_000,
			booksTax: 5_000,
			gstr3bCredit: 1_800,
			booksCredit: 2_880,
		});
		expect(of('2027-01')).toEqual({
			month: '2027-01',
			gstr1Tax: null,
			gstr3bTax: null,
			booksTax: 2_500,
			gstr3bCredit: null,
			booksCredit: 0,
		});
	});

	it('has no notes yet, and counts only reverse charge when purchases post at another GSTIN’s stock location', async () => {
		const elsewhere = build({ locations: [{ ...LOCATIONS[0], gstRegistrationId: 'reg_tr' }] });
		const annual = await elsewhere.service.view(query);
		expect(annual.version).toBe(0);
		expect(annual.rows.every((row) => row.note === '')).toBe(true);
		expect(elsewhere.entries.postedBetween).not.toHaveBeenCalled();
		expect(annual.rows.find((row) => row.table === '6')?.books).toBe(1_080);
		const noStock = build({ locations: [] });
		expect((await noStock.service.view(query)).rows.find((row) => row.table === '6')?.books).toBe(1_080);
	});

	it('refuses a registration it doesn’t know', async () => {
		const unknown = build().service.view({ gstRegistrationId: 'reg_gone', year: YEAR } as never);
		await expect(unknown).rejects.toBeInstanceOf(NotFoundException);
		await expect(unknown).rejects.toMatchObject(refusal('gst_registration_unknown'));
	});
});

describe('why a GSTR-9 table differs from the books (G9)', () => {
	const note = (over: Record<string, unknown> = {}) =>
		({ gstRegistrationId: 'reg_wb', year: YEAR, table: '4', note: 'Sample sarees', version: 0, ...over }) as never;

	it('keeps the first note, then the next over the version read, and shows the year again', async () => {
		const { service, notes } = build();
		const first = await service.note(note());
		expect(notes.save).toHaveBeenLastCalledWith('reg_wb', YEAR, { '4': 'Sample sarees' }, null);
		expect(first.rows.find((row) => row.table === '4')?.note).toBe('Sample sarees');
		const second = await service.note(note({ table: '6', note: 'Bill entered late', version: 0 }));
		expect(notes.save).toHaveBeenLastCalledWith(
			'reg_wb',
			YEAR,
			{ '4': 'Sample sarees', '6': 'Bill entered late' },
			0,
		);
		expect(second.version).toBe(1);
	});

	it('refuses a version someone saved over, before or while saving, and passes on any other failure', async () => {
		const stale = build({ saved: { notes: {}, version: 2 } });
		const changed = stale.service.note(note({ version: 1 }));
		await expect(changed).rejects.toBeInstanceOf(ConflictException);
		await expect(changed).rejects.toMatchObject(refusal('gst_annual_changed'));
		expect(stale.notes.save).not.toHaveBeenCalled();
		await expect(build().service.note(note({ version: 1 }))).rejects.toMatchObject(refusal('gst_annual_changed'));
		const raced = build({ saveFails: new Error('gst_annual_changed') }).service.note(note());
		await expect(raced).rejects.toBeInstanceOf(ConflictException);
		const diskFull = new Error('disk full');
		await expect(build({ saveFails: diskFull }).service.note(note())).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ saveFails: odd }).service.note(note())).rejects.toBe(odd);
	});
});

describe('the GST reports routes and module', () => {
	it('hand each call to the service; viewing needs accounts.index, a note accounts.edit; wired into the app', () => {
		const annual = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new GstAnnualController(annual as never);
		const write = { gstRegistrationId: 'reg_wb', year: YEAR, table: '4', note: 'x', version: 0 } as never;
		expect([c.view(query), c.note(write)]).toEqual([
			['view', query],
			['note', write],
		]);
		const perm = (m: keyof GstAnnualController) =>
			new Reflector().get(PERMISSIONS_KEY, GstAnnualController.prototype[m]);
		expect([perm('view'), perm('note')]).toEqual([['accounts.index'], ['accounts.edit']]);
		expect(Reflect.getMetadata('imports', GstReportsModule)).toEqual([GstModule]);
		expect(Reflect.getMetadata('controllers', GstReportsModule)).toEqual([GstAnnualController]);
		expect(Reflect.getMetadata('providers', GstReportsModule)).toEqual([GstAnnualService]);
		expect(Reflect.getMetadata('exports', GstModule)).toEqual([GstReturnsService, Gstr3bInputs]);
		expect(AppModule.forRoot({} as never).imports).toContain(GstReportsModule);
	});
});
