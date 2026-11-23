import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PaymentVoucher, RcmChoice, SelfInvoice } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { paymentVoucherData, selfInvoiceData } from '../src/documents/self-invoice-print';
import {
	PaymentVouchersController,
	PurchasePaymentVouchersController,
	SelfInvoicesController,
} from '../src/self-invoices/self-invoices.controller';
import { SelfInvoicesModule } from '../src/self-invoices/self-invoices.module';
import { SelfInvoicesService } from '../src/self-invoices/self-invoices.service';

/** Reverse charge: self-invoices and payment vouchers (accounts brief D2–D4, decision D5). */

const NOW = new Date('2026-11-21T06:30:00.000Z');
const owner = { userId: 'adm_owner' } as never;
const manager = { userId: 'adm_manager' } as never;
const choice = (key: string, patch: Partial<RcmChoice> = {}): RcmChoice => ({
	templateCode: 'RS-RCM',
	templateVersion: 1,
	key,
	name: key === 'shop_rent' ? 'Rent of the shop (commercial property)' : 'Goods transport agency',
	code: key === 'shop_rent' ? '997212' : '996511',
	ratePercent: key === 'shop_rent' ? 18 : 5,
	expenseRole: key === 'shop_rent' ? 'rent' : 'freight_inward',
	source: '13/2017',
	...patch,
});
const supplier = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	legalName: id === 'sup_bose' ? 'Bose Properties' : 'Haripada Basak',
	gstin: null,
	stateCode: '19',
	active: true,
	address: { line: 'KB Basu Road', city: 'Barasat', pin: '700124' },
	...patch,
});
const write = (patch: Record<string, unknown> = {}) => ({
	supplierId: 'sup_bose',
	ruleKey: 'shop_rent',
	forMonth: '2026-11',
	receivedOn: '2026-11-01',
	taxableINR: 60_000,
	version: null,
	...patch,
});

function setup(
	options: { scope?: { current: string | null; ids: readonly string[] }; banks?: number; filed?: boolean } = {},
) {
	const invoices = new Map<string, SelfInvoice>();
	const raced = new Set<string>();
	const vouchers = new Map<string, PaymentVoucher>();
	let n = 0;
	const log = vi.fn(async () => undefined);
	const post = vi.fn(async () => ({ id: `jv_${++n}` }));
	const suppliers = {
		findById: async (id: string) =>
			({
				sup_bose: supplier('sup_bose'),
				sup_far: supplier('sup_far', { stateCode: '10' }),
				sup_gst: supplier('sup_gst', { gstin: '19AAAAA0000A1Z5' }),
			})[id] ?? null,
		list: async () => ({
			items: [
				supplier('sup_bose'),
				supplier('sup_gst', { gstin: '19AAAAA0000A1Z5' }),
				supplier('sup_old', { active: false }),
			],
			total: 3,
		}),
	};
	const banks = Array.from({ length: options.banks ?? 1 }, (_, i) => ({
		id: `led_bank${i}`,
		groupId: 'grp_bank_accounts',
		active: true,
		systemKey: null,
		roles: [],
	}));
	const ledger = {
		post,
		chart: async () => ({
			groups: [{ id: 'grp_bank_accounts', systemKey: 'bank_accounts', roles: [], parentId: null }],
			ledgers: [...banks, { id: 'led_rent', groupId: 'grp_x', active: true, systemKey: 'rent', roles: [] }],
		}),
		isSuperAdmin: async (p?: { userId: string }) => p?.userId === 'adm_owner',
	};
	const paymentsMade: { id: string; amountINR: number; paidOn: string; mode: string; reference: string | null }[] =
		[];
	const purchases = {
		paymentsFor: async () => [...paymentsMade],
		recordPayment: vi.fn(
			async (id: string, w: { amountINR: number; paidOn: string; mode: string; reference: string | null }) => {
				if (id !== 'pe_lost') paymentsMade.push({ id: `pay_${paymentsMade.length + 1}`, ...w });
				return {
					id,
					number: 'PE/26-27/00031',
					supplierId: id === 'pe_unknown' ? 'sup_none' : 'sup_bose',
					supplierName: 'Nadia Weavers Co-op',
				};
			},
		),
	};
	const service = new SelfInvoicesService(
		{
			get: async (id: string) => invoices.get(id) ?? null,
			insert: async (i: SelfInvoice) => void invoices.set(i.id, i),
			save: async (i: SelfInvoice, expected: number) => {
				if (raced.has(i.id) || invoices.get(i.id)?.version !== expected)
					throw new Error('self_invoice_changed');
				const next = { ...i, version: expected + 1 };
				invoices.set(i.id, next);
				return next;
			},
			removeDraft: async (id: string) => id !== 'si_gone' && invoices.delete(id),
			forSupplier: async () => [],
			list: vi.fn(async (query: unknown) => ({ items: [], total: 0, counts: {}, query }) as never),
		},
		{
			get: async (id: string) => vouchers.get(id) ?? null,
			insert: async (v: PaymentVoucher) => void vouchers.set(v.id, v),
			list: vi.fn(async (query: unknown) => ({ items: [], total: 0, counts: {}, query }) as never),
			forDocument: async (kind: string, id: string) =>
				[...vouchers.values()].filter((v) => v.against.kind === kind && v.against.id === id),
		},
		suppliers as never,
		{ getRegistration: async (id: string) => (id === 'reg_wb' ? { id, gstin: '19DBYPS6736R1ZZ' } : null) } as never,
		{
			list: async () => [
				{ id: 'loc_bar', gstRegistrationId: 'reg_wb' },
				{ id: 'loc_office', gstRegistrationId: null },
				{ id: 'loc_lost', gstRegistrationId: 'reg_gone' },
			],
		} as never,
		{
			list: async () =>
				options.filed ? [{ gstRegistrationId: 'reg_wb', month: '2026-11', returnType: 'gstr3b' }] : [],
		} as never,
		{ withTransaction: (work: (c: object) => Promise<unknown>) => work({}) } as never,
		{ issue: async (type: string) => `${type === 'selfInvoice' ? 'SI' : 'PV'}/26-27/00000${++n}` } as never,
		ledger as never,
		{ scope: async () => options.scope ?? { current: 'loc_bar', ids: ['loc_bar'] } } as never,
		{
			rcmChoices: async (day: string) =>
				day >= '2024-10-10' ? [choice('shop_rent'), choice('goods_transport')] : [choice('goods_transport')],
		} as never,
		{ append: log } as never,
		purchases as never,
	);
	return { service, invoices, vouchers, log, post, purchases, raced };
}

const issueOne = async (s: ReturnType<typeof setup>, patch: Record<string, unknown> = {}, now = NOW) => {
	const draft = await s.service.create(write(patch) as never, owner, now);
	return s.service.issue(draft.id, draft.version, owner, now);
};

describe('a reverse-charge supply (D2)', () => {
	it('offers suppliers without a GSTIN and the list for the day received, with our State', async () => {
		const { service } = setup();
		const form = await service.form('2026-11-01', owner);
		expect(form).toEqual({
			suppliers: [{ id: 'sup_bose', name: 'Bose Properties', stateCode: '19' }],
			choices: [choice('shop_rent'), choice('goods_transport')],
			placeOfSupply: '19',
		});
	});

	it('needs a location with a GSTIN to make one', async () => {
		const firstWithGstin = setup({ scope: { current: null, ids: ['loc_office', 'loc_bar'] } });
		expect((await firstWithGstin.service.form('2026-11-01', owner)).placeOfSupply).toBe('19');
		for (const [scope, refusal] of [
			[{ current: null, ids: [] }, 'self_invoice_needs_a_location'],
			[{ current: 'loc_office', ids: ['loc_office', 'loc_bar'] }, 'self_invoice_needs_a_gstin'],
			[{ current: 'loc_lost', ids: ['loc_lost'] }, 'self_invoice_needs_a_gstin'],
		] as const) {
			await expect(setup({ scope }).service.form('2026-11-01', owner)).rejects.toThrow(refusal);
		}
	});

	it('saves a draft with the rule copied and the tax worked out, and refuses what isn’t reverse charge', async () => {
		const s = setup();
		const draft = await s.service.create(write() as never, owner, NOW);
		expect(draft).toMatchObject({
			status: 'draft',
			number: null,
			supplierName: 'Bose Properties',
			supplierAddress: 'KB Basu Road, Barasat 700124',
			rule: { key: 'shop_rent', templateCode: 'RS-RCM', expenseRole: 'rent' },
			placeOfSupply: '19',
			interState: false,
			cgstINR: 5_400,
			sgstINR: 5_400,
			taxINR: 10_800,
			totalINR: 70_800,
			createdBy: 'adm_owner',
		});
		const far = await s.service.create(
			write({ supplierId: 'sup_far', ruleKey: 'goods_transport' }) as never,
			undefined,
			NOW,
		);
		expect([far.interState, far.igstINR, far.createdBy]).toEqual([true, 3_000, null]);
		await expect(s.service.create(write({ supplierId: 'sup_none' }) as never, owner, NOW)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await expect(s.service.create(write({ supplierId: 'sup_gst' }) as never, owner, NOW)).rejects.toThrow(
			'supplier_has_gstin',
		);
		// Shop rent only came under reverse charge from 10 Oct 2024.
		await expect(s.service.create(write({ receivedOn: '2024-10-01' }) as never, owner, NOW)).rejects.toThrow(
			'not_on_reverse_charge_list',
		);
		expect(s.log).toHaveBeenCalledWith('adm_owner', 'selfInvoice.create', 'selfInvoice', draft.id, [], {
			supplier: 'Bose Properties',
			what: 'Rent of the shop (commercial property)',
		});
	});

	it('saves changes to a draft with what changed, and refuses a stale page or an issued one', async () => {
		const s = setup();
		const draft = await s.service.create(write() as never, owner, NOW);
		const saved = await s.service.save(
			draft.id,
			write({ taxableINR: 50_000, ruleKey: 'goods_transport', version: 0 }) as never,
			owner,
			NOW,
		);
		expect([saved.version, saved.taxINR, saved.createdAt]).toEqual([1, 2_500, NOW.toISOString()]);
		expect(s.log).toHaveBeenLastCalledWith('adm_owner', 'selfInvoice.save', 'selfInvoice', draft.id, [
			{ field: 'what', before: 'Rent of the shop (commercial property)', after: 'Goods transport agency' },
			{ field: 'taxable', before: 60_000, after: 50_000 },
		]);
		await expect(s.service.save(draft.id, write({ version: 0 }) as never, owner, NOW)).rejects.toThrow(
			'self_invoice_changed',
		);
		await s.service.save(draft.id, write() as never, owner, NOW);
		// Someone saved it between reading and writing.
		s.raced.add(draft.id);
		await expect(s.service.save(draft.id, write() as never, owner, NOW)).rejects.toBeInstanceOf(ConflictException);
		s.raced.clear();
		const issued = await s.service.issue(draft.id, 2, owner, NOW);
		await expect(s.service.save(issued.id, write() as never, owner, NOW)).rejects.toThrow('self_invoice_not_draft');
		await expect(s.service.get('si_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('deletes a draft only', async () => {
		const s = setup();
		const draft = await s.service.create(write() as never, owner, NOW);
		await s.service.remove(draft.id, owner);
		expect(s.invoices.has(draft.id)).toBe(false);
		s.invoices.set('si_gone', { ...draft, id: 'si_gone' });
		await expect(s.service.remove('si_gone', owner)).rejects.toBeInstanceOf(ConflictException);
	});

	it('issues it with an SI number, posts through roles, and flags one made after the 30 days', async () => {
		const s = setup();
		const issued = await issueOne(s);
		expect(issued).toMatchObject({
			number: 'SI/26-27/000001',
			status: 'issued',
			date: '2026-11-21',
			late: false,
			journalVoucherId: 'jv_2',
			issuedBy: 'adm_owner',
		});
		expect(s.post).toHaveBeenCalledWith(
			expect.objectContaining({
				date: '2026-11-21',
				source: { type: 'selfInvoice', id: issued.id, number: 'SI/26-27/000001' },
				lines: [
					{ ledger: { role: 'rent' }, locationId: 'loc_bar', debitPaise: 6_000_000, creditPaise: undefined },
					{
						ledger: { role: 'input_gst_rcm' },
						locationId: 'loc_bar',
						debitPaise: 1_080_000,
						creditPaise: undefined,
					},
					{
						ledger: { role: 'rcm_payable' },
						locationId: 'loc_bar',
						debitPaise: undefined,
						creditPaise: 1_080_000,
					},
					{
						ledger: { role: 'creditors_control' },
						locationId: 'loc_bar',
						debitPaise: undefined,
						creditPaise: 6_000_000,
					},
				],
			}),
			{},
			'adm_owner',
		);
		const late = await issueOne(setup(), { receivedOn: '2026-10-01' });
		expect(late.late).toBe(true);
		await expect(s.service.issue(issued.id, issued.version, owner, NOW)).rejects.toThrow('self_invoice_not_draft');
	});
});

describe('paying it: a payment voucher (D3)', () => {
	const pay = (patch: Record<string, unknown> = {}) => ({
		amountINR: 60_000,
		paidOn: '2026-11-21',
		mode: 'bank_transfer',
		reference: 'NEFT 7712',
		paidFromLedgerId: null,
		version: 1,
		...patch,
	});

	it('issues a PV with the payment, posts it from the only bank, and keeps the reverse-charge tax on it', async () => {
		const s = setup();
		const issued = await issueOne(s);
		const { invoice, voucher } = await s.service.pay(issued.id, pay() as never, owner, NOW);
		expect(invoice.paidINR).toBe(60_000);
		expect(invoice.paymentVouchers).toEqual([{ id: voucher.id, number: 'PV/26-27/000003' }]);
		expect(voucher).toMatchObject({
			number: 'PV/26-27/000003',
			against: {
				kind: 'selfInvoice',
				id: issued.id,
				number: 'SI/26-27/000001',
				detail: 'Rent of the shop (commercial property)',
			},
			paidFromLedgerId: 'led_bank0',
			reverseChargeTaxINR: 10_800,
			journalVoucherId: 'jv_4',
			payeeName: 'Bose Properties',
		});
		expect(s.post).toHaveBeenLastCalledWith(
			expect.objectContaining({
				lines: [
					{ ledger: { role: 'creditors_control' }, debitPaise: 6_000_000, locationId: 'loc_bar' },
					{ ledger: { id: 'led_bank0' }, creditPaise: 6_000_000, locationId: 'loc_bar' },
				],
			}),
			{},
			'adm_owner',
		);
		expect(await s.service.paymentVoucher(voucher.id)).toBe(voucher);
		expect(await s.service.paymentVouchersFor('selfInvoice', issued.id)).toEqual([voucher]);
		await expect(s.service.paymentVoucher('pv_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('pays cash from the cash ledger, and a chosen bank only if it is a bank', async () => {
		const s = setup({ banks: 2 });
		const issued = await issueOne(s);
		const cash = await s.service.pay(issued.id, pay({ amountINR: 10_000, mode: 'cash' }) as never, manager, NOW);
		expect(cash.voucher.paidFromLedgerId).toBeNull();
		expect(s.post).toHaveBeenLastCalledWith(
			expect.objectContaining({
				lines: expect.arrayContaining([
					{ ledger: { role: 'cash' }, creditPaise: 1_000_000, locationId: 'loc_bar' },
				]),
			}),
			{},
			'adm_manager',
		);
		await expect(s.service.pay(issued.id, pay({ amountINR: 1, version: 2 }) as never, owner, NOW)).rejects.toThrow(
			'payment_choose_bank_ledger',
		);
		await expect(
			s.service.pay(
				issued.id,
				pay({ amountINR: 1, version: 2, paidFromLedgerId: 'led_rent' }) as never,
				owner,
				NOW,
			),
		).rejects.toThrow('payment_needs_a_bank_ledger');
		const chosen = await s.service.pay(
			issued.id,
			pay({ amountINR: 1, version: 2, paidFromLedgerId: 'led_bank1' }) as never,
			owner,
			NOW,
		);
		expect(chosen.voucher.paidFromLedgerId).toBe('led_bank1');
		const none = setup({ banks: 0 });
		const other = await issueOne(none);
		await expect(none.service.pay(other.id, pay() as never, owner, NOW)).rejects.toThrow(
			'payment_needs_a_bank_ledger',
		);
	});

	it('refuses paying a draft, a stale page, more than is owed, a future date or before the self-invoice', async () => {
		const s = setup();
		const draft = await s.service.create(write() as never, owner, NOW);
		await expect(s.service.pay(draft.id, pay({ version: 0 }) as never, owner, NOW)).rejects.toThrow(
			'self_invoice_not_issued',
		);
		const issued = await s.service.issue(draft.id, 0, owner, NOW);
		for (const [patch, refusal] of [
			[{ version: 0 }, 'self_invoice_changed'],
			[{ amountINR: 60_001 }, 'overpayment'],
			[{ paidOn: '2026-11-22' }, 'paid_in_future'],
			[{ paidOn: '2026-11-20' }, 'paid_before_self_invoice'],
		] as const) {
			await expect(s.service.pay(issued.id, pay(patch) as never, owner, NOW)).rejects.toThrow(refusal);
		}
		await expect(
			s.service.pay(issued.id, pay({ amountINR: 0.004 + 60_000 }) as never, owner, NOW),
		).resolves.toBeDefined();
	});
});

describe('cancelling a self-invoice', () => {
	it('lets a super admin cancel an unpaid one, reversing its posting; others are refused and logged', async () => {
		const s = setup();
		const issued = await issueOne(s);
		await expect(s.service.cancel(issued.id, { reason: 'Wrong month', version: 1 }, manager, NOW)).rejects.toThrow(
			'only_super_admin',
		);
		expect(s.log).toHaveBeenLastCalledWith(
			'adm_manager',
			'selfInvoice.cancel_refused',
			'selfInvoice',
			issued.id,
			[],
			{
				why: 'only_super_admin',
			},
		);
		await expect(s.service.cancel(issued.id, { reason: 'Wrong month', version: 0 }, owner, NOW)).rejects.toThrow(
			'self_invoice_changed',
		);
		const cancelled = await s.service.cancel(issued.id, { reason: 'Wrong month', version: 1 }, owner, NOW);
		expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong month', cancelledBy: 'adm_owner' });
		expect(s.post).toHaveBeenLastCalledWith(
			expect.objectContaining({
				idempotencyKey: `selfInvoice:${issued.id}:cancel`,
				lines: expect.arrayContaining([
					{ ledger: { role: 'rent' }, locationId: 'loc_bar', creditPaise: 6_000_000, debitPaise: undefined },
				]),
			}),
			{},
			'adm_owner',
		);
		const filed = setup({ filed: true });
		const inFiledMonth = await issueOne(filed);
		expect(await filed.service.cancelProblems(inFiledMonth, owner)).toEqual(['month_filed']);
		const draft = await filed.service.create(write() as never, owner, NOW);
		expect(await filed.service.cancelProblems(draft, undefined)).toEqual([
			'self_invoice_not_issued',
			'only_super_admin',
			'month_filed',
		]);
	});
});

describe('paying an ordinary supplier bill (D4, decision D5)', () => {
	it('records the payment with the purchases step unchanged, then gives it its own voucher', async () => {
		const s = setup();
		const paid = await s.service.payPurchaseEntry(
			'pe_31',
			{ amountINR: 48_400, paidOn: '2026-11-20', mode: 'upi', reference: '8821 1092', proofAssetId: null },
			owner,
			NOW,
		);
		expect(s.purchases.recordPayment).toHaveBeenCalledWith(
			'pe_31',
			expect.objectContaining({ amountINR: 48_400 }),
			'adm_owner',
		);
		expect(paid.voucher).toMatchObject({
			number: 'PV/26-27/000001',
			against: { kind: 'purchaseEntry', id: 'pe_31', number: 'PE/26-27/00031' },
			supplierPaymentId: 'pay_1',
			reverseChargeTaxINR: null,
			journalVoucherId: null,
			payeeAddress: 'KB Basu Road, Barasat 700124',
		});
		const unknown = await s.service.payPurchaseEntry(
			'pe_unknown',
			{ amountINR: 1, paidOn: '2026-11-20', mode: 'cash', reference: null, proofAssetId: null },
			undefined,
			NOW,
		);
		expect([unknown.voucher.payeeAddress, unknown.voucher.createdBy]).toEqual(['', null]);
		await expect(
			s.service.payPurchaseEntry(
				'pe_lost',
				{ amountINR: 1, paidOn: '2026-11-20', mode: 'cash', reference: null, proofAssetId: null },
				owner,
				NOW,
			),
		).rejects.toThrow('payment_not_recorded');
	});
});

describe('prints and routes', () => {
	it('prints the self-invoice and the payment voucher as drawn', async () => {
		const s = setup();
		const issued = await issueOne(s);
		const seller = { name: 'K.R. Marketing', lines: [] };
		const data = selfInvoiceData(issued, seller);
		expect(data.values).toMatchObject({
			selfInvoiceNo: 'SI/26-27/000001',
			date: '21 Nov 2026',
			placeOfSupply: 'West Bengal (19)',
			rcmNote: 'Tax payable on reverse charge: Yes. Bought from an unregistered supplier.',
		});
		expect(data.rows?.[0]?.cells).toMatchObject({
			item: 'Rent of the shop (commercial property)',
			hsn: '997212',
			tax: '₹10,800.00',
		});
		expect(data.totals?.['totals']?.map((t) => t.label)).toEqual([
			'Taxable value',
			'CGST + SGST (reverse charge)',
			'Total',
		]);
		expect(selfInvoiceData({ ...issued, placeOfSupply: '00' }, seller).values['placeOfSupply']).toBe('00 (00)');
		const draft = selfInvoiceData(
			{ ...issued, number: null, date: null, interState: true, supplierAddress: '' },
			seller,
		);
		expect([draft.number, draft.taxHeading, draft.parties?.['supplier']?.lines]).toEqual([
			'Draft',
			'IGST',
			['Bose Properties'],
		]);
		const { voucher } = await s.service.pay(
			issued.id,
			{
				amountINR: 60_000,
				paidOn: '2026-11-21',
				mode: 'bank_transfer',
				reference: 'NEFT 7712',
				paidFromLedgerId: null,
				version: 1,
			},
			owner,
			NOW,
		);
		expect(paymentVoucherData(voucher, seller).values).toMatchObject({
			against: 'SI/26-27/000001',
			method: 'Bank transfer',
			rcmTax: '₹10,800.00 paid by us under reverse charge',
		});
		const plain = paymentVoucherData(
			{ ...voucher, reverseChargeTaxINR: null, reference: null, mode: 'cheque' },
			seller,
		);
		expect([plain.values['rcmTax'], plain.values['reference'], plain.values['method']]).toEqual(['', '', 'Cheque']);
	});

	it('passes each route to the service, prints and logs the print', async () => {
		const s = setup();
		const issued = await issueOne(s);
		const draft = await s.service.create(write() as never, owner, NOW);
		const { voucher } = await s.service.pay(
			issued.id,
			{ amountINR: 1, paidOn: '2026-11-21', mode: 'cash', reference: null, paidFromLedgerId: null, version: 1 },
			owner,
			NOW,
		);
		const formats = {
			seller: async () => ({ name: 'K', lines: [] }),
			renderActive: async () => new Uint8Array([37]),
		};
		const editLog = { entries: async (type: string, id: string) => [type, id] };
		const routes = new SelfInvoicesController(s.service, formats as never, editLog as never);
		const pvs = new PaymentVouchersController(s.service, formats as never, editLog as never);
		const bills = new PurchasePaymentVouchersController(s.service);
		expect((await routes.form({ receivedOn: '2026-11-01' }, owner)).placeOfSupply).toBe('19');
		const made = await routes.create(write() as never, owner);
		expect((await routes.save(made.id, write({ taxableINR: 1 }) as never, owner)).taxableINR).toBe(1);
		await routes.remove(made.id, owner);
		expect((await routes.get(issued.id)).id).toBe(issued.id);
		const second = await routes.issue(draft.id, { version: 0 }, owner);
		expect(
			(
				await routes.pay(
					second.id,
					{
						amountINR: 1,
						paidOn: '2026-11-24',
						mode: 'cash',
						reference: null,
						paidFromLedgerId: null,
						version: 1,
					},
					owner,
				)
			).voucher.amountINR,
		).toBe(1);
		const third = await issueOne(s);
		expect((await routes.cancel(third.id, { reason: 'Typed twice', version: 1 }, owner)).status).toBe('cancelled');
		expect(await routes.paymentVouchers(issued.id)).toEqual([voucher]);
		const listQuery = { from: '2026-04-01', to: '2026-11-30', search: '', page: 1, pageSize: 25 };
		expect(await routes.list({ ...listQuery, filter: 'all' })).toMatchObject({
			query: { filter: 'all', dueSoonFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
		});
		expect(await pvs.list({ ...listQuery, filter: 'reverse_charge' })).toMatchObject({
			query: { filter: 'reverse_charge' },
		});
		expect(await s.service.list({ ...listQuery, filter: 'due_soon' }, NOW)).toMatchObject({
			query: { dueSoonFrom: '2026-10-22' },
		});
		expect(await routes.log(issued.id)).toEqual(['selfInvoice', issued.id]);
		expect(await pvs.get(voucher.id)).toBe(voucher);
		expect(await pvs.log(voucher.id)).toEqual(['paymentVoucher', voucher.id]);
		const headers: Record<string, string> = {};
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return reply;
			},
			send: vi.fn(),
		};
		await routes.pdf(issued.id, reply as never, owner);
		expect(headers['Content-Disposition']).toBe('inline; filename="SI-26-27-000001.pdf"');
		const fresh = await s.service.create(write() as never, owner, NOW);
		await routes.pdf(fresh.id, reply as never);
		expect(headers['Content-Disposition']).toBe('inline; filename="self-invoice-draft.pdf"');
		await pvs.pdf(voucher.id, reply as never);
		expect(headers['Content-Disposition']).toContain('PV-26-27-');
		expect(s.log).toHaveBeenCalledWith(null, 'paymentVoucher.print', 'paymentVoucher', voucher.id, [], {
			format: 'pdf',
		});
		const bill = await bills.pay(
			'pe_31',
			{ amountINR: 5, paidOn: '2026-11-20', mode: 'upi', reference: null, proofAssetId: null },
			owner,
		);
		expect(await bills.paymentVouchers('pe_31')).toEqual([bill.voucher]);
		expect(new SelfInvoicesModule()).toBeInstanceOf(SelfInvoicesModule);
		expect(BadRequestException).toBeDefined();
	});
});
