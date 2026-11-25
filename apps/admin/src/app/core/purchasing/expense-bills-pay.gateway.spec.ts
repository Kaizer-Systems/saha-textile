import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { EXPENSE_BILL_KEYS, ExpenseBillsGateway, expenseBillProblemKey } from './expense-bills.gateway';

/** Paying an expense bill (brief 25 EB2): the pay and payment-voucher routes, their key and the payment refusals. */

describe('the expense bills gateway’s payments', () => {
	it('keys a bill’s payment vouchers under the bill', () => {
		expect(EXPENSE_BILL_KEYS.vouchers('eb_1')).toEqual(['expense-bills', 'eb_1', 'payment-vouchers']);
	});

	it('pays a bill and reads its payment vouchers', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ExpenseBillsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/expense-bills/eb%2F1`;
		const write = {
			amountINR: 20_000,
			paidOn: '2026-11-24',
			mode: 'cash',
			reference: null,
			paidFromLedgerId: null,
			version: 3,
		} as never;
		gateway.pay('eb/1', write).subscribe();
		const pay = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/pay`);
		expect(pay.request.body).toEqual(write);
		pay.flush({});
		gateway.paymentVouchers('eb/1').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/payment-vouchers`).flush([]);
		http.verify();
	});

	it('words each payment refusal', () => {
		for (const code of [
			'expense_bill_paid',
			'expense_bill_not_posted',
			'expense_bill_paid_before_bill',
			'overpayment',
			'paid_in_future',
			'payment_needs_a_bank_ledger',
			'payment_choose_bank_ledger',
		])
			expect(expenseBillProblemKey(code)).toEqual({ key: `eb_problem_${code}`, params: {} });
	});
});
