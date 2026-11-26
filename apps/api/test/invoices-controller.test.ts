import { NotFoundException } from '@nestjs/common';
import { TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { AccountsInvoicesController, InvoicesController } from '../src/invoicing/invoices.controller';

/** The order's invoice list, its accounting view and its prints (accounts brief D1, Q5, EI10, AE4). */

const party = { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' };
const invoice = TaxInvoice.parse({
	id: 'ti_1',
	number: 'TI/26-27/000001',
	date: '2026-11-23',
	gstRegistrationId: 'reg_wb',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-000001',
	seller: party,
	buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', address: 'Mumbai', stateCode: '27' },
	placeOfSupply: '27',
	interState: true,
	lines: [
		{
			lineId: 'a',
			sku: 'S1',
			title: 'Saree',
			hsn: '5007',
			quantity: 1,
			unitPriceINR: 21_000,
			ratePercent: 5,
			taxableINR: 20_000,
			igstINR: 1_000,
			totalINR: 21_000,
		},
	],
	taxableINR: 20_000,
	cgstINR: 0,
	sgstINR: 0,
	igstINR: 1_000,
	roundOffINR: 0,
	totalINR: 21_000,
	createdAt: '2026-11-23T10:00:00.000Z',
});

function setup(edocs: Record<string, unknown> = {}) {
	const rendered: { doc: string; copies: { values: Record<string, string>; qrSvg?: string }[] }[] = [];
	const service = {
		listForOrder: async () => [invoice],
		get: async () => invoice,
		accounting: async () => ({ lines: [], checks: [] }),
	};
	const controller = new InvoicesController(
		service as never,
		{
			seller: async () => ({ name: 'K.R. Marketing', lines: [] }),
			renderActiveCopies: async (doc: string, copies: never[]) => (
				rendered.push({ doc, copies }),
				new Uint8Array([37])
			),
		} as never,
		{ findActive: async (kind: string, id: string) => edocs[`${kind}:${id}`] ?? null } as never,
	);
	const headers: Record<string, string> = {};
	const reply = {
		header(name: string, value: string) {
			headers[name] = value;
			return this;
		},
		send: () => undefined,
	};
	return { controller, rendered, headers, reply, service };
}

describe('invoices controller (D1)', () => {
	it('lists an order’s invoices and shows one’s books view only under its own order', async () => {
		const { controller } = setup();
		expect(await controller.list('ord_1')).toHaveLength(1);
		expect(await controller.accounting('ord_1', 'ti_1')).toEqual({ lines: [], checks: [] });
		await expect(controller.accounting('ord_2', 'ti_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(controller.pdf('ord_2', 'ti_1', undefined, {} as never)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('prints the original by default or for a copy it doesn’t know, and all three on asking', async () => {
		const s = setup();
		await s.controller.pdf('ord_1', 'ti_1', undefined, s.reply as never);
		await s.controller.pdf('ord_1', 'ti_1', 'fourth', s.reply as never);
		expect(s.rendered.map((r) => r.copies.map((c) => c.values['copyLabel']))).toEqual([
			['Original for recipient'],
			['Original for recipient'],
		]);
		await s.controller.pdf('ord_1', 'ti_1', 'all', s.reply as never);
		expect(s.rendered.at(-1)?.copies).toHaveLength(3);
		expect(s.headers['Content-Disposition']).toBe('inline; filename="TI-26-27-000001 all copies.pdf"');
		expect(s.headers['Content-Type']).toBe('application/pdf');
	});

	it('puts the IRN band on with the signed QR, without a QR when only the IRN was typed, and the e-way bill alone', async () => {
		const irn = {
			irn: 'a'.repeat(64),
			ackNo: '1124',
			ackDate: '2026-11-23T10:05:00.000Z',
			signedQr: 'eyJ0eXAiOiJKV1QifQ.e30.c2ln',
		};
		const withQr = setup({ 'eInvoice:ti_1': irn, 'eWayBill:ord_1': { ewbNumber: '341012345678' } });
		await withQr.controller.pdf('ord_1', 'ti_1', 'duplicate', withQr.reply as never);
		const first = withQr.rendered[0]?.copies[0];
		expect(first?.values).toMatchObject({
			irn: irn.irn,
			ewayBill: '341012345678',
			copyLabel: 'Duplicate for transporter',
		});
		expect(first?.qrSvg).toContain('<svg');

		const typed = setup({ 'eInvoice:ord_1': { irn: irn.irn, ackNo: null, ackDate: null, signedQr: null } });
		await typed.controller.pdf('ord_1', 'ti_1', 'original', typed.reply as never);
		expect(typed.rendered[0]?.copies[0]?.qrSvg).toBeUndefined();
		expect(typed.rendered[0]?.copies[0]?.values['irn']).toBe(irn.irn);

		const ewbOnly = setup({ 'eWayBill:ti_1': { ewbNumber: '34101234567890' } });
		await ewbOnly.controller.pdf('ord_1', 'ti_1', 'triplicate', ewbOnly.reply as never);
		expect(ewbOnly.rendered[0]?.copies[0]?.values).toMatchObject({ ewayBill: '34101234567890' });
		expect(ewbOnly.rendered[0]?.copies[0]?.values['irn']).toBeUndefined();

		const plain = setup({ 'eWayBill:ti_1': { ewbNumber: null } });
		await plain.controller.pdf('ord_1', 'ti_1', 'original', plain.reply as never);
		expect(plain.rendered[0]?.copies[0]?.values['ewayBill']).toBeUndefined();
	});

	it('reads one invoice and its books view from Accounts', async () => {
		const { service } = setup();
		const accounts = new AccountsInvoicesController(service as never);
		expect(await accounts.get('ti_1')).toBe(invoice);
		expect(await accounts.accounting('ti_1')).toEqual({ lines: [], checks: [] });
	});
});
