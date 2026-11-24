import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Gstr2bImport } from '@saha-textile/contracts';
import { normalizeBillNumber } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { Gstr2bController } from '../src/gst/gstr2b.controller';
import { Gstr2bService } from '../src/gst/gstr2b.service';

/** GSTR-2B against our purchases (accounts brief G5): import, match to our bills, record what was done on IMS. */

const at = '2026-12-14T06:00:00.000Z';
const now = new Date(at);
const GSTIN = '19DBYPS6736R1ZZ';
const RANG = '27AAKFR1234M1Z2';
const BOSE = '24AAACB1111C1Z5';
const NADIA = '19AAACN2222D1Z9';
const refusal = (code: string) => ({ response: { message: code } });

const REGISTRATIONS: Record<string, unknown> = {
	reg_wb: { id: 'reg_wb', gstin: GSTIN, stateCode: '19' },
	reg_tr: { id: 'reg_tr', gstin: '16ABCDE1234F1Z5', stateCode: '16' },
};
const LOCATIONS = [
	{
		id: 'loc_bar',
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-01-01',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_shop',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-02',
		gstRegistrationId: 'reg_tr',
	},
];

/** A posted purchase bill, rupees as the books keep them. */
const entry = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	number: `PE/26-27/${id}`,
	itcClaimable: true,
	supplierGstin: RANG.toLowerCase(),
	supplierName: 'Rang Mahal',
	billNumber: 'RM/101',
	billDate: '2026-11-05',
	totals: { taxableINR: 100, igstINR: 5, cgstINR: 0, sgstINR: 0, totalINR: 105 },
	...over,
});
const ENTRIES = [
	// In 2B with the same amounts.
	entry('pe_match'),
	// In 2B for less tax than our bill.
	entry('pe_diff', {
		supplierGstin: BOSE,
		supplierName: 'Bose Weavers',
		billNumber: 'BW-77',
		totals: { taxableINR: 200, igstINR: 10, cgstINR: 0, sgstINR: 0, totalINR: 210 },
	}),
	// Not in 2B yet, and unnumbered.
	entry('pe_books', {
		number: null,
		supplierGstin: NADIA,
		supplierName: 'Nadia Weavers',
		billNumber: 'NW/5',
		totals: { taxableINR: 100, igstINR: 0, cgstINR: 2.5, sgstINR: 2.5, totalINR: 105 },
	}),
	// None of these is looked for in 2B.
	entry('pe_no_credit', { itcClaimable: false, billNumber: 'X1' }),
	entry('pe_no_gstin', { supplierGstin: null, billNumber: 'X2' }),
	entry('pe_too_old', { billDate: '2024-03-10', billNumber: 'X3' }),
	entry('pe_no_tax', {
		billNumber: 'X4',
		totals: { taxableINR: 100, igstINR: 0, cgstINR: 0, sgstINR: 0, totalINR: 100 },
	}),
	// Found in October's 2B already.
	entry('pe_seen', { supplierGstin: NADIA, supplierName: 'Nadia Weavers', billNumber: 'NW/4' }),
];

/** The 2B file as the portal gives it, rupees, `dd-mm-yyyy` days. */
const twoBFile = (over: Record<string, unknown> = {}, docdata: Record<string, unknown> = {}) => ({
	data: {
		gstin: GSTIN,
		rtnprd: '112026',
		gendt: '14-12-2026',
		docdata: {
			b2b: [
				{
					ctin: RANG,
					trdnm: 'Rang Mahal',
					supprd: '112026',
					supfildt: '11-12-2026',
					inv: [{ inum: 'RM/101', dt: '05-11-2026', txval: 100, igst: 5, cgst: 0, sgst: 0, itcavl: 'Y' }],
				},
				{
					ctin: BOSE,
					trdnm: 'Bose Weavers',
					inv: [
						{ inum: 'BW-77', dt: '07-11-2026', txval: 200, igst: 8, cgst: 0, sgst: 0 },
						// Entered by the supplier, not yet by us.
						{ inum: 'BW-80', dt: '20-11-2026', txval: 50, igst: 2.5, cgst: 0, sgst: 0 },
					],
				},
			],
			cdnr: [
				{
					ctin: RANG,
					trdnm: 'Rang Mahal',
					nt: [{ ntnum: 'CN-9', typ: 'C', dt: '25-11-2026', txval: 20, igst: 1 }],
				},
			],
			...docdata,
		},
		...over,
	},
});
const KEY = {
	rang: `${RANG}|invoice|${normalizeBillNumber('RM/101')}`,
	bose: `${BOSE}|invoice|${normalizeBillNumber('BW-77')}`,
	bose80: `${BOSE}|invoice|${normalizeBillNumber('BW-80')}`,
	note: `${RANG}|credit|${normalizeBillNumber('CN-9')}`,
};

/** October's 2B: Nadia's NW/4 was in it; a note and a later month's file never hide a bill. */
const october: Gstr2bImport = {
	id: 'g2b_oct',
	gstRegistrationId: 'reg_wb',
	gstin: GSTIN,
	month: '2026-10',
	generatedOn: '2026-11-14',
	lines: [
		{
			key: `${NADIA}|invoice|${normalizeBillNumber('NW/4')}`,
			kind: 'invoice',
			supplierGstin: NADIA,
			supplierName: 'Nadia Weavers',
			number: 'NW/4',
			date: '2026-10-30',
			supplierPeriod: '2026-10',
			filedOn: '2026-11-11',
			taxable: 10_000,
			igst: 500,
			cgst: 0,
			sgst: 0,
			reverseCharge: false,
			itcAvailable: true,
			reason: null,
		},
		{
			key: `${NADIA}|credit|${normalizeBillNumber('NW/5')}`,
			kind: 'credit',
			supplierGstin: NADIA,
			supplierName: 'Nadia Weavers',
			number: 'NW/5',
			date: '2026-10-30',
			supplierPeriod: '2026-10',
			filedOn: '2026-11-11',
			taxable: 100,
			igst: 5,
			cgst: 0,
			sgst: 0,
			reverseCharge: false,
			itcAvailable: true,
			reason: null,
		},
	],
	notRead: [],
	decisions: {},
	importedBy: null,
	importedByName: '',
	importedAt: '2026-11-15T06:00:00.000Z',
	version: 0,
};

const ADMINS: Record<string, unknown> = {
	adm_acc: { displayName: 'Sudip Ghosh', email: 'sudip@saha-textile.test', username: 'sudip' },
	adm_ca: { displayName: '', email: 'ca@saha-textile.test', username: 'ca' },
	adm_rina: { displayName: null, email: null, username: 'rina' },
	adm_blank: { displayName: '', email: '', username: '' },
};
const person = (userId: string) => ({ userId, permissions: ['accounts.edit'] }) as never;

function build(
	options: {
		imports?: Gstr2bImport[];
		filings?: unknown[];
		locations?: unknown[];
		saveFails?: unknown;
	} = {},
) {
	const store = new Map((options.imports ?? [october]).map((doc) => [`${doc.gstRegistrationId}|${doc.month}`, doc]));
	const imports = {
		find: async (registrationId: string, month: string) => store.get(`${registrationId}|${month}`) ?? null,
		listForRegistration: async (registrationId: string) =>
			[...store.values()].filter((doc) => doc.gstRegistrationId === registrationId),
		save: vi.fn(async (doc: Gstr2bImport, expectedVersion: number | null) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			const saved = { ...doc, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			store.set(`${doc.gstRegistrationId}|${doc.month}`, saved);
			return saved;
		}),
	};
	const entries = { postedBetween: vi.fn(async (_from: string, _to: string) => ENTRIES) };
	const service = new Gstr2bService(
		imports as never,
		{ getRegistration: async (id: string) => REGISTRATIONS[id] ?? null } as never,
		entries as never,
		{ list: async () => options.locations ?? LOCATIONS } as never,
		{ list: async () => options.filings ?? [] } as never,
		{
			findById: async (id: string) => {
				if (id === 'adm_down') throw new Error('people lookup down');
				return ADMINS[id] ?? null;
			},
		} as never,
	);
	return { service, imports, entries, store };
}

const query = (over: Record<string, unknown> = {}) =>
	({ gstRegistrationId: 'reg_wb', month: '2026-11', chip: 'all', ...over }) as never;

describe('our bills that may show in a month’s 2B (G5)', () => {
	it('takes posted bills with credit and tax, from a supplier with a GSTIN, within the time limit, not seen before', async () => {
		const { service, entries } = build();
		const bills = await service.booksBills('reg_wb', '2026-11');
		expect(entries.postedBetween).toHaveBeenCalledWith('2024-04-01', '2026-11-30');
		expect(bills).toEqual([
			{
				entryId: 'pe_match',
				entryNumber: 'PE/26-27/pe_match',
				supplierGstin: RANG,
				supplierName: 'Rang Mahal',
				billNumber: 'RM/101',
				billDate: '2026-11-05',
				taxable: 10_000,
				igst: 500,
				cgst: 0,
				sgst: 0,
			},
			expect.objectContaining({ entryId: 'pe_diff', taxable: 20_000, igst: 1_000 }),
			expect.objectContaining({ entryId: 'pe_books', entryNumber: '', cgst: 250, sgst: 250 }),
		]);
	});

	it('has none for a GSTIN that isn’t the stock location’s, or when there is no stock location', async () => {
		expect(await build().service.booksBills('reg_tr', '2026-11')).toEqual([]);
		expect(await build({ locations: [] }).service.booksBills('reg_wb', '2026-11')).toEqual([]);
	});

	it('looks only at earlier months’ 2B for bills already found', async () => {
		const { service } = build({ imports: [{ ...october, month: '2026-12' }] });
		expect((await service.booksBills('reg_wb', '2026-11')).map((b) => b.entryId)).toContain('pe_seen');
	});
});

describe('the month’s 2B against our bills (G5)', () => {
	it('shows only our bills before 2B is imported', async () => {
		const view = await build().service.view(query());
		expect(view).toMatchObject({
			gstin: GSTIN,
			month: '2026-11',
			importId: null,
			importedAt: null,
			importedByName: '',
			generatedOn: null,
			notRead: [],
			claim: { igst: 0, cgst: 0, sgst: 0 },
			locked: false,
			version: 0,
		});
		expect(view.rows.map((r) => [r.result, r.entryId])).toEqual([
			['only_books', 'pe_match'],
			['only_books', 'pe_diff'],
			['only_books', 'pe_books'],
		]);
		await expect(build().service.view(query({ gstRegistrationId: 'reg_gone' }))).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('imports the file, matches every line, counts each result and works out the credit 3B may claim', async () => {
		const { service, imports } = build();
		const view = await service.import({ gstRegistrationId: 'reg_wb', file: twoBFile() }, person('adm_acc'), now);
		expect(imports.save).toHaveBeenCalledWith(expect.objectContaining({ importedBy: 'adm_acc' }), null);
		expect(view).toMatchObject({
			importedAt: at,
			importedByName: 'Sudip Ghosh',
			generatedOn: '2026-12-14',
			counts: { all: 5, matched: 1, different: 1, only_2b: 1, only_books: 1, note: 1 },
			version: 0,
			locked: false,
		});
		expect(view.importId).toMatch(/^g2b_/);
		expect(view.rows.map((r) => [r.key, r.result, r.action])).toEqual([
			[KEY.rang, 'matched', 'accept'],
			[KEY.bose, 'different', 'pending'],
			[KEY.bose80, 'only_2b', 'pending'],
			[KEY.note, 'note', 'accept'],
			['books|pe_books', 'only_books', 'held'],
		]);
		// The matched bill's credit less the supplier's credit note.
		expect(view.claim).toEqual({ igst: 400, cgst: 0, sgst: 0 });
		const different = await service.view(query({ chip: 'different' }));
		expect(different.rows.map((r) => r.key)).toEqual([KEY.bose]);
		expect(different.counts.all).toBe(5);
	});

	it('locks the month once its GSTR-3B is filed, and only then', async () => {
		const filings = [
			{ gstRegistrationId: 'reg_tr', returnType: 'GSTR-3B', month: '2026-11' },
			{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-11' },
			{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-10' },
		];
		expect((await build({ filings }).service.view(query())).locked).toBe(false);
		const filed = [...filings, { gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-11' }];
		expect((await build({ filings: filed }).service.view(query())).locked).toBe(true);
	});
});

describe('importing the 2B file (G5)', () => {
	const importAs = (service: Gstr2bService, file: unknown, principal: unknown = person('adm_acc')) =>
		service.import({ gstRegistrationId: 'reg_wb', file } as never, principal as never, now);

	it('refuses a file it can’t read, a document without a number, another GSTIN’s file and a filed month', async () => {
		const { service } = build({
			filings: [{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-11' }],
		});
		const unreadable = importAs(service, { data: { gstin: GSTIN } });
		await expect(unreadable).rejects.toBeInstanceOf(BadRequestException);
		await expect(unreadable).rejects.toMatchObject(refusal('gstr2b_file_unreadable'));
		await expect(
			importAs(service, twoBFile({}, { b2b: [{ ctin: RANG, inv: [{ dt: '05-11-2026', txval: 1 }] }] })),
		).rejects.toMatchObject(refusal('gstr2b_line_unreadable'));
		await expect(importAs(service, twoBFile({ gstin: '16ABCDE1234F1Z5' }))).rejects.toMatchObject(
			refusal('gstr2b_other_gstin'),
		);
		await expect(importAs(service, twoBFile())).rejects.toMatchObject(refusal('gstr2b_month_filed'));
		await expect(
			service.import({ gstRegistrationId: 'reg_gone', file: twoBFile() }, undefined, now),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('imports again over the same month, keeping what was recorded for lines still in the file', async () => {
		const november: Gstr2bImport = {
			...october,
			id: 'g2b_nov',
			month: '2026-11',
			lines: [],
			decisions: { [KEY.bose]: 'accept', 'GONE|invoice|1': 'reject' },
			version: 2,
		};
		const { service, imports } = build({ imports: [october, november] });
		// No one signed in: imported by nobody.
		const view = await service.import({ gstRegistrationId: 'reg_wb', file: twoBFile() }, undefined, now);
		expect(imports.save).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'g2b_nov',
				decisions: { [KEY.bose]: 'accept' },
				importedBy: null,
				importedByName: '',
			}),
			2,
		);
		expect(view.version).toBe(3);
		expect(view.rows.find((r) => r.key === KEY.bose)?.action).toBe('accept');
	});

	it('names who imported it: display name, email, username, else the user id', async () => {
		const names: [string, string][] = [
			['adm_ca', 'ca@saha-textile.test'],
			['adm_rina', 'rina'],
			['adm_blank', 'adm_blank'],
			['adm_gone', 'adm_gone'],
			['adm_down', 'adm_down'],
		];
		for (const [userId, name] of names)
			expect((await importAs(build().service, twoBFile(), person(userId))).importedByName).toBe(name);
	});

	it('says someone saved first when the save lost a race, and passes on any other failure', async () => {
		for (const message of ['gstr2b_changed', 'gstr2b_exists']) {
			const raced = importAs(build({ saveFails: new Error(message) }).service, twoBFile());
			await expect(raced).rejects.toBeInstanceOf(ConflictException);
			await expect(raced).rejects.toMatchObject(refusal('gstr2b_changed'));
		}
		const diskFull = new Error('disk full');
		await expect(importAs(build({ saveFails: diskFull }).service, twoBFile())).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(importAs(build({ saveFails: odd }).service, twoBFile())).rejects.toBe(odd);
	});
});

describe('recording what was done on the portal for a line (G5)', () => {
	const decide = (service: Gstr2bService, over: Record<string, unknown> = {}) =>
		service.decide({
			gstRegistrationId: 'reg_wb',
			month: '2026-11',
			key: KEY.bose,
			action: 'reject',
			version: 0,
			...over,
		} as never);

	it('records it over the version read and shows the month again', async () => {
		const { service, imports } = build();
		await service.import({ gstRegistrationId: 'reg_wb', file: twoBFile() }, person('adm_acc'), now);
		const view = await decide(service);
		expect(imports.save).toHaveBeenLastCalledWith(
			expect.objectContaining({ decisions: { [KEY.bose]: 'reject' } }),
			0,
		);
		expect(view.rows.find((r) => r.key === KEY.bose)?.action).toBe('reject');
		expect(view.version).toBe(1);
	});

	it('refuses before 2B is imported, once the month is filed, and for a line 2B doesn’t have', async () => {
		await expect(decide(build().service)).rejects.toMatchObject(refusal('gstr2b_not_imported'));
		const { service } = build();
		await service.import({ gstRegistrationId: 'reg_wb', file: twoBFile() }, person('adm_acc'), now);
		await expect(decide(service, { key: 'NOPE|invoice|1' })).rejects.toMatchObject(refusal('gstr2b_line_unknown'));
		const filed = build({
			imports: [{ ...october, month: '2026-11' }],
			filings: [{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-11' }],
		});
		await expect(decide(filed.service)).rejects.toMatchObject(refusal('gstr2b_month_filed'));
		await expect(decide(build().service, { gstRegistrationId: 'reg_gone' })).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});
});

describe('the 2B routes', () => {
	it('hand each call to the service; viewing needs accounts.index, importing and deciding accounts.edit', () => {
		const gstr2b = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new Gstr2bController(gstr2b as never);
		const q = query();
		const body = { gstRegistrationId: 'reg_wb', file: twoBFile() };
		const decision = { gstRegistrationId: 'reg_wb', month: '2026-11', key: KEY.bose, action: 'accept', version: 0 };
		const p = person('adm_acc');
		expect([c.view(q), c.import(body, p), c.import(body), c.decide(decision as never)]).toEqual([
			['view', q],
			['import', body, p],
			['import', body, undefined],
			['decide', decision],
		]);
		const perm = (m: keyof Gstr2bController) => new Reflector().get(PERMISSIONS_KEY, Gstr2bController.prototype[m]);
		expect([perm('view'), perm('import'), perm('decide')]).toEqual([
			['accounts.index'],
			['accounts.edit'],
			['accounts.edit'],
		]);
	});
});
