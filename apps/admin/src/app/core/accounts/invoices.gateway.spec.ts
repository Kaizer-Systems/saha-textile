import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { INVOICE_KEYS, INVOICE_PRINTS, InvoicesGateway, invoiceProblemKey } from './invoices.gateway';

describe('tax invoices in admin (accounts brief D1, EI5B, EI10)', () => {
	it('names why an invoice could not be made, with the piece', () => {
		expect(invoiceProblemKey('invoice_problem:hsn_missing:ST-KAT-0901')).toEqual({
			key: 'inv_problem_hsn_missing',
			params: { sku: 'ST-KAT-0901' },
		});
		expect(invoiceProblemKey('invoice_problem:no_gst_registration')).toEqual({
			key: 'inv_problem_no_gst_registration',
			params: { sku: '' },
		});
		expect(invoiceProblemKey('Someone else changed this order first')).toBeNull();
	});

	it('offers the three copies in Rule 48 order, then all three', () => {
		expect(INVOICE_PRINTS.map((p) => p.copy)).toEqual(['original', 'duplicate', 'triplicate', 'all']);
	});

	it('reads an order’s invoices, one invoice, its books view and a copy as a PDF', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(InvoicesGateway);
		const http = TestBed.inject(HttpTestingController);
		const list = firstValueFrom(gateway.forOrder('ord/1'));
		http.expectOne((r) => r.url.endsWith('/admin/orders/ord%2F1/invoices')).flush([]);
		expect(await list).toEqual([]);
		const pdf = firstValueFrom(gateway.pdf('ord_1', 'ti_1', 'all'));
		const pdfReq = http.expectOne((r) => r.url.endsWith('/admin/orders/ord_1/invoices/ti_1/pdf'));
		expect(pdfReq.request.params.get('copy')).toBe('all');
		pdfReq.flush(new Blob(['%PDF']));
		expect(await pdf).toBeInstanceOf(Blob);
		const one = firstValueFrom(gateway.one('ti_1'));
		http.expectOne((r) => r.url.endsWith('/admin/accounts/invoices/ti_1')).flush({ id: 'ti_1' });
		expect(await one).toEqual({ id: 'ti_1' });
		const books = firstValueFrom(gateway.accounting('ti_1'));
		http.expectOne((r) => r.url.endsWith('/admin/accounts/invoices/ti_1/accounting')).flush({ lines: [] });
		expect(await books).toEqual({ lines: [] });
		http.verify();
		expect([INVOICE_KEYS.one('ti_1'), INVOICE_KEYS.accounting('ti_1')]).toEqual([
			['invoices', 'one', 'ti_1'],
			['invoices', 'accounting', 'ti_1'],
		]);
		expect(INVOICE_KEYS.forOrder('ord_1').at(-1)).toBe('ord_1');
	});
});
