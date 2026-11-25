import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { EXPENSE_BILL_KEYS, ExpenseBillsGateway, expenseBillProblemKey } from './expense-bills.gateway';

/** Purchases › Expense bills (brief 25 EB1): the routes, their keys, and refusals in words. */

describe('the expense bills gateway', () => {
	it('keys every bill under one root, each list by its filters, one bill by its id, and the form', () => {
		const query = { status: 'draft' as const, from: '2026-04-01' };
		expect([
			EXPENSE_BILL_KEYS.all,
			EXPENSE_BILL_KEYS.list(query),
			EXPENSE_BILL_KEYS.one('eb_1'),
			EXPENSE_BILL_KEYS.form,
		]).toEqual([
			['expense-bills'],
			['expense-bills', 'list', query],
			['expense-bills', 'eb_1'],
			['expense-bills', 'form'],
		]);
	});

	it('sends a status other than all and only the dates set, and calls each route with its body', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ExpenseBillsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/expense-bills`;
		const write = { supplierId: 'sup_1' } as never;
		const calls: [() => unknown, string, string, unknown][] = [
			[() => gateway.list({ status: 'all' }), 'GET', '', null],
			[
				() => gateway.list({ status: 'posted', from: '2026-04-01', to: '2026-11-25' }),
				'GET',
				'?status=posted&from=2026-04-01&to=2026-11-25',
				null,
			],
			[() => gateway.list({ status: 'all', to: '2026-11-25' }), 'GET', '?to=2026-11-25', null],
			[() => gateway.get('eb/1'), 'GET', '/eb%2F1', null],
			[() => gateway.form(), 'GET', '/form', null],
			[() => gateway.create(write), 'POST', '', write],
			[() => gateway.update('eb/1', write, 4), 'PUT', '/eb%2F1', { supplierId: 'sup_1', version: 4 }],
			[() => gateway.post('eb/1'), 'POST', '/eb%2F1/post', {}],
			[() => gateway.cancel('eb/1', 'Entered twice'), 'POST', '/eb%2F1/cancel', { reason: 'Entered twice' }],
		];
		for (const [call, method, path, sent] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			const request = http.expectOne((req) => req.method === method && req.urlWithParams === api + path);
			expect(request.request.body).toEqual(sent);
			request.flush({});
		}
		http.verify();
	});

	it('words the bill’s own refusals, the books’ refusals as every posting screen does, and nothing else', () => {
		for (const code of [
			'expense_bill_not_found',
			'expense_bill_not_draft',
			'expense_bill_changed',
			'expense_bill_cancelled',
			'expense_bill_not_an_expense',
			'expense_bill_no_gstin',
			'expense_bill_composition_no_credit',
			'use_self_invoice',
			'supplier_unknown',
			'location_unknown',
		])
			expect(expenseBillProblemKey(code)).toEqual({ key: `eb_problem_${code}`, params: {} });
		expect(expenseBillProblemKey('voucher_problem:period_locked')).toEqual({
			key: 'accounts_problem_period_locked',
			params: {},
		});
		expect(expenseBillProblemKey('Network down')).toBeNull();
	});
});
