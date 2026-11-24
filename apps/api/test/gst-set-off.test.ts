import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GstReturnDraft } from '@saha-textile/contracts';
import { setOff, type TaxHeads } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { GstSetOffController } from '../src/gst/gst-set-off.controller';
import { GstSetOffModule } from '../src/gst/gst-set-off.module';
import { GstSetOffService } from '../src/gst/gst-set-off.service';
import { GstModule } from '../src/gst/gst.module';
import { GstReturnsService } from '../src/gst/gst-returns.service';
import { LedgerModule } from '../src/ledger/ledger.module';

/** Q7 Post the set-off: a GSTR-3B's set-off journal and challan payment, once, in one transaction. */

const at = '2026-12-18T06:00:00.000Z';
const GSTIN = '19DBYPS6736R1ZZ';
const refusal = (code: string) => ({ response: { message: code } });
const heads = (igst: number, cgst: number, sgst: number): TaxHeads => ({ igst, cgst, sgst });

/** A GSTR-3B's set-off as prepared (paise): `liability` against `credit`, reverse-charge tax apart. */
const setOffOf = (liability: TaxHeads, credit: TaxHeads, reverseChargeCash = heads(0, 0, 0)) => ({
	...setOff(liability, credit),
	reverseChargeCash,
});

const draft = (over: Partial<GstReturnDraft> = {}): GstReturnDraft => ({
	id: 'gsr_3b',
	gstRegistrationId: 'reg_wb',
	gstin: GSTIN,
	returnType: 'GSTR-3B',
	month: '2026-11',
	status: 'approved',
	summary: [],
	problems: [],
	portal: { gstin: GSTIN },
	preparedBy: 'adm_acc',
	preparedAt: at,
	checkedBy: 'adm_acc',
	checkedAt: at,
	approvedBy: 'adm_ca',
	approvedAt: at,
	preparedByName: 'Sudip Ghosh',
	checkedByName: 'Sudip Ghosh',
	approvedByName: 'ca@saha-textile.test',
	arn: null,
	filedOn: null,
	// Output CGST and SGST of ₹25 each, credit of ₹9 each, and ₹5.40 each of reverse-charge tax.
	setOff: setOffOf(heads(0, 2_500, 2_500), heads(0, 900, 900), heads(0, 540, 540)),
	adjustments: [],
	setOffVoucherId: null,
	challanVoucherId: null,
	version: 3,
	...over,
});

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
		id: 'loc_tr_old',
		active: false,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-02',
		gstRegistrationId: 'reg_tr',
	},
	{
		id: 'loc_tr',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-03',
		gstRegistrationId: 'reg_tr',
	},
];

const write = (over: Record<string, unknown> = {}) =>
	({ bankAccountId: 'bank_1', paidOn: '2026-12-18', challan: 'CPIN26120001', version: 3, ...over }) as never;
const caPerson = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

function build(options: { draft?: GstReturnDraft; locations?: unknown[]; saveFails?: unknown } = {}) {
	const posted: unknown[] = [];
	const ledger = {
		post: vi.fn(async (request: unknown, _context: unknown, _by: string | null) => {
			posted.push(request);
			return { id: `jv_${posted.length}`, number: `JV/26-27/00000${posted.length}` };
		}),
	};
	const drafts = {
		save: vi.fn(async (next: GstReturnDraft, expectedVersion: number) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			return { ...next, version: expectedVersion + 1 };
		}),
	};
	const transactions = {
		withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
	};
	const service = new GstSetOffService(
		{ get: async () => options.draft ?? draft() } as never,
		drafts as never,
		{ get: async (id: string) => (id === 'bank_1' ? { id: 'bank_1', ledgerId: 'led_hdfc' } : null) } as never,
		{ list: async () => options.locations ?? LOCATIONS } as never,
		transactions as never,
		ledger as never,
	);
	return { service, ledger, drafts, transactions };
}

describe('posting a GSTR-3B’s set-off and challan (Q7)', () => {
	it('posts the set-off journal and the challan payment from the bank, in one transaction, and keeps both', async () => {
		const { service, ledger, drafts, transactions } = build();
		const saved = await service.post('gsr_3b', write(), caPerson);
		expect(transactions.withTransaction).toHaveBeenCalledTimes(1);
		expect(ledger.post.mock.calls[0]).toEqual([
			{
				kind: 'journal',
				date: '2026-12-18',
				narration: `GST set-off, GSTR-3B 2026-11 · ${GSTIN} (s.49, rule 88A)`,
				source: { type: 'gstSetOff', id: 'gsr_3b', number: null },
				idempotencyKey: 'gstSetOff:gsr_3b',
				lines: [
					{ ledger: { role: 'output_cgst' }, locationId: 'loc_bar', debitPaise: 900 },
					{ ledger: { role: 'output_sgst' }, locationId: 'loc_bar', debitPaise: 900 },
					{ ledger: { role: 'input_cgst' }, locationId: 'loc_bar', creditPaise: 360 },
					{ ledger: { role: 'input_sgst' }, locationId: 'loc_bar', creditPaise: 360 },
					{ ledger: { role: 'input_gst_rcm' }, locationId: 'loc_bar', creditPaise: 1_080 },
				],
			},
			{ session: 'tx' },
			'adm_ca',
		]);
		expect(ledger.post.mock.calls[1]).toEqual([
			{
				kind: 'payment',
				date: '2026-12-18',
				narration: `GST challan CPIN26120001 (PMT-06), GSTR-3B 2026-11 · ${GSTIN}`,
				source: { type: 'gstChallan', id: 'gsr_3b', number: 'CPIN26120001' },
				idempotencyKey: 'gstChallan:gsr_3b',
				lines: [
					{ ledger: { role: 'output_cgst' }, locationId: 'loc_bar', debitPaise: 1_600 },
					{ ledger: { role: 'output_sgst' }, locationId: 'loc_bar', debitPaise: 1_600 },
					{ ledger: { role: 'rcm_payable' }, locationId: 'loc_bar', debitPaise: 1_080 },
					{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 4_280 },
				],
			},
			{ session: 'tx' },
			'adm_ca',
		]);
		expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }), 3);
		expect(saved).toMatchObject({
			status: 'approved',
			arn: null,
			filedOn: null,
			setOffVoucherId: 'jv_1',
			challanVoucherId: 'jv_2',
			challan: {
				number: 'CPIN26120001',
				paidOn: '2026-12-18',
				bankAccountId: 'bank_1',
				amountPaise: 4_280,
				setOffNumber: 'JV/26-27/000001',
				challanNumber: 'JV/26-27/000002',
			},
			version: 4,
		});
	});

	it('stores a filed return as approved, the filing being read from the filing', async () => {
		const filed = draft({ status: 'filed', arn: 'AA1912261234567', filedOn: '2026-12-20' });
		const saved = await build({ draft: filed }).service.post('gsr_3b', write(), caPerson);
		expect(saved).toMatchObject({ status: 'approved', arn: null, filedOn: null });
	});

	it('posts only the journal when no cash is due, and only the challan when no credit is used, by nobody signed in', async () => {
		const creditOnly = build({ draft: draft({ setOff: setOffOf(heads(0, 500, 500), heads(0, 900, 900)) }) });
		const journalOnly = await creditOnly.service.post('gsr_3b', write(), undefined);
		expect(creditOnly.ledger.post).toHaveBeenCalledTimes(1);
		expect(creditOnly.ledger.post.mock.calls[0]?.[0]).toMatchObject({ kind: 'journal' });
		expect(creditOnly.ledger.post.mock.calls[0]?.[2]).toBeNull();
		expect(journalOnly).toMatchObject({
			setOffVoucherId: 'jv_1',
			challanVoucherId: null,
			challan: { amountPaise: 0, setOffNumber: 'JV/26-27/000001', challanNumber: null },
		});
		const cashOnly = build({ draft: draft({ setOff: setOffOf(heads(0, 500, 500), heads(0, 0, 0)) }) });
		const challanOnly = await cashOnly.service.post('gsr_3b', write(), caPerson);
		expect(cashOnly.ledger.post).toHaveBeenCalledTimes(1);
		expect(cashOnly.ledger.post.mock.calls[0]?.[0]).toMatchObject({ kind: 'payment' });
		expect(challanOnly).toMatchObject({
			setOffVoucherId: null,
			challanVoucherId: 'jv_1',
			challan: { amountPaise: 1_000, setOffNumber: null, challanNumber: 'JV/26-27/000001' },
		});
	});

	it('posts at the GSTIN’s first active location when the stock location is another GSTIN’s, or there is none', async () => {
		const other = build({ draft: draft({ gstRegistrationId: 'reg_tr' }) });
		await other.service.post('gsr_3b', write(), caPerson);
		expect(other.ledger.post.mock.calls[0]?.[0]).toMatchObject({
			lines: expect.arrayContaining([expect.objectContaining({ locationId: 'loc_tr' })]),
		});
		const noStock = build({ locations: LOCATIONS.slice(1) });
		await expect(noStock.service.post('gsr_3b', write(), caPerson)).rejects.toMatchObject(
			refusal('books_need_a_location'),
		);
		const shopOnly = build({
			draft: draft({ gstRegistrationId: 'reg_tr' }),
			locations: LOCATIONS.slice(1),
		});
		await shopOnly.service.post('gsr_3b', write(), caPerson);
		expect(shopOnly.ledger.post.mock.calls[0]?.[0]).toMatchObject({
			lines: expect.arrayContaining([expect.objectContaining({ locationId: 'loc_tr' })]),
		});
	});
});

describe('what stops a set-off (Q7)', () => {
	/** The refusal a post meets, nothing posted; the error comes back for its kind to be checked. */
	const refusedWith = async (
		code: string,
		options: Parameters<typeof build>[0],
		over: Record<string, unknown> = {},
	) => {
		const { service, ledger } = build(options);
		const error = await service.post('gsr_3b', write(over), caPerson).catch((reason: unknown) => reason);
		expect(error).toMatchObject(refusal(code));
		expect(ledger.post).not.toHaveBeenCalled();
		return error;
	};

	it('needs an approved GSTR-3B with a set-off, not posted yet, at the version read', async () => {
		expect(await refusedWith('gst_set_off_not_3b', { draft: draft({ returnType: 'GSTR-1' }) })).toBeInstanceOf(
			BadRequestException,
		);
		await refusedWith('gst_set_off_not_3b', { draft: draft({ setOff: null }) });
		for (const status of ['prepared', 'checked'] as const)
			await refusedWith('gst_set_off_not_approved', { draft: draft({ status }) });
		await refusedWith('gst_set_off_posted', { draft: draft({ setOffVoucherId: 'jv_9' }) });
		await refusedWith('gst_set_off_posted', { draft: draft({ challanVoucherId: 'jv_9' }) });
		expect(await refusedWith('gst_draft_changed', {}, { version: 2 })).toBeInstanceOf(ConflictException);
	});

	it('needs a bank account it knows and something to post', async () => {
		expect(await refusedWith('bank_account_unknown', {}, { bankAccountId: 'bank_9' })).toBeInstanceOf(
			NotFoundException,
		);
		await refusedWith('gst_set_off_nothing', {
			draft: draft({ setOff: setOffOf(heads(0, 0, 0), heads(0, 900, 900)) }),
		});
	});

	it('says someone saved first when the save lost a race, and passes on any other failure', async () => {
		const raced = build({ saveFails: new Error('gst_draft_changed') }).service.post('gsr_3b', write(), caPerson);
		await expect(raced).rejects.toBeInstanceOf(ConflictException);
		await expect(raced).rejects.toMatchObject(refusal('gst_draft_changed'));
		const diskFull = new Error('disk full');
		await expect(build({ saveFails: diskFull }).service.post('gsr_3b', write(), caPerson)).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ saveFails: odd }).service.post('gsr_3b', write(), caPerson)).rejects.toBe(odd);
	});
});

describe('the set-off route and module', () => {
	it('hands the call to the service with accounts.post, and is wired into the app', () => {
		const setOffService = { post: vi.fn((...args: unknown[]) => ['post', ...args]) };
		const c = new GstSetOffController(setOffService as never);
		const body = write();
		expect(c.post('gsr_3b', body, caPerson)).toEqual(['post', 'gsr_3b', body, caPerson]);
		expect(c.post('gsr_3b', body)).toEqual(['post', 'gsr_3b', body, undefined]);
		expect(new Reflector().get(PERMISSIONS_KEY, GstSetOffController.prototype.post)).toEqual(['accounts.post']);
		expect(Reflect.getMetadata('imports', GstSetOffModule)).toEqual([GstModule, LedgerModule]);
		expect(Reflect.getMetadata('controllers', GstSetOffModule)).toEqual([GstSetOffController]);
		expect(Reflect.getMetadata('providers', GstSetOffModule)).toEqual([GstSetOffService]);
		// The set-off reads drafts through the returns service the GST module shares.
		expect(Reflect.getMetadata('exports', GstModule)).toContain(GstReturnsService);
		expect(AppModule.forRoot({} as never).imports).toContain(GstSetOffModule);
	});
});
