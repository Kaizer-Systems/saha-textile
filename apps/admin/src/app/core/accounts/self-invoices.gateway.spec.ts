import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway, selfInvoiceProblemKey } from './self-invoices.gateway';

describe('self-invoices gateway (D2–D4)', () => {
	it('calls each route with its method', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(SelfInvoicesGateway);
		const http = TestBed.inject(HttpTestingController);
		const base = '/admin/accounts/self-invoices';
		const cases: [Observable<unknown>, string, string][] = [
			[gateway.form('2026-11-01'), 'GET', `${base}/form`],
			[gateway.list({ from: 'a', to: 'b', search: '', filter: 'all', page: 1, pageSize: 25 }), 'GET', base],
			[
				gateway.voucherList({ from: 'a', to: 'b', search: '', filter: 'all', page: 1, pageSize: 25 }),
				'GET',
				'/admin/accounts/payment-vouchers',
			],
			[gateway.create({} as never), 'POST', base],
			[gateway.save('s/1', {} as never), 'PUT', `${base}/s%2F1`],
			[gateway.remove('s1'), 'DELETE', `${base}/s1`],
			[gateway.get('s1'), 'GET', `${base}/s1`],
			[gateway.log('s1'), 'GET', `${base}/s1/log`],
			[gateway.pdf('s1'), 'GET', `${base}/s1/pdf`],
			[gateway.issue('s1', 2), 'POST', `${base}/s1/issue`],
			[gateway.pay('s1', {} as never), 'POST', `${base}/s1/pay`],
			[gateway.cancel('s1', {} as never), 'POST', `${base}/s1/cancel`],
			[gateway.paymentVouchers('s1'), 'GET', `${base}/s1/payment-vouchers`],
			[gateway.voucher('p1'), 'GET', '/admin/accounts/payment-vouchers/p1'],
			[gateway.voucherLog('p1'), 'GET', '/admin/accounts/payment-vouchers/p1/log'],
			[gateway.voucherPdf('p1'), 'GET', '/admin/accounts/payment-vouchers/p1/pdf'],
			[gateway.cancelVoucher('p1', 'Paid twice'), 'POST', '/admin/accounts/payment-vouchers/p1/cancel'],
			[gateway.payPurchaseEntry('e1', {} as never), 'POST', '/admin/purchases/entries/e1/pay-with-voucher'],
			[gateway.purchaseEntryVouchers('e1'), 'GET', '/admin/purchases/entries/e1/payment-vouchers'],
		];
		for (const [call, method, path] of cases) {
			const done = firstValueFrom(call);
			const req = http.expectOne((r) => r.url.endsWith(path) && r.method === method);
			if (path.endsWith('/form')) expect(req.request.params.get('receivedOn')).toBe('2026-11-01');
			if (path.endsWith('/issue')) expect(req.request.body).toEqual({ version: 2 });
			req.flush(path.endsWith('pdf') ? new Blob(['%PDF']) : {});
			await done;
		}
		http.verify();
		expect(SELF_INVOICE_KEYS.one('s1')).toEqual(['self-invoices', 's1']);
		expect(SELF_INVOICE_KEYS.log('s1')).toEqual(['self-invoices', 's1', 'log']);
		expect(SELF_INVOICE_KEYS.vouchers('s1')).toEqual(['self-invoices', 's1', 'payment-vouchers']);
		expect(SELF_INVOICE_KEYS.form('2026-11-01')).toEqual(['self-invoices', 'form', '2026-11-01']);
		expect(SELF_INVOICE_KEYS.voucher('p1')).toEqual(['payment-vouchers', 'p1']);
		expect(SELF_INVOICE_KEYS.voucherLog('p1')).toEqual(['payment-vouchers', 'p1', 'log']);
		expect(SELF_INVOICE_KEYS.entryVouchers('e1')).toEqual(['payment-vouchers', 'purchase-entry', 'e1']);
		expect(SELF_INVOICE_KEYS.list({ page: 1 } as never)).toEqual(['self-invoices', 'list', { page: 1 }]);
		expect(SELF_INVOICE_KEYS.voucherList({ page: 2 } as never)).toEqual(['payment-vouchers', 'list', { page: 2 }]);
	});

	it('turns refusal codes into word keys', () => {
		expect(selfInvoiceProblemKey('overpayment')).toEqual({ key: 'si_problem_overpayment', params: {} });
		expect(selfInvoiceProblemKey('self_invoice_changed')).toEqual({
			key: 'si_problem_self_invoice_changed',
			params: {},
		});
		expect(selfInvoiceProblemKey('voucher_problem:role_not_mapped:legal_fees')).toEqual({
			key: 'si_problem_role_not_mapped',
			params: { role: 'legal_fees' },
		});
		expect(selfInvoiceProblemKey('Network down')).toBeNull();
	});
});
