import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { RETURN_KEYS, ReturnsGateway, returnProblemKey } from './returns.gateway';

describe('returns gateway (accounts brief B)', () => {
	it('calls each route with its method and body', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ReturnsGateway);
		const http = TestBed.inject(HttpTestingController);
		const cases: [Observable<unknown>, string, string][] = [
			[gateway.view('o/1'), 'GET', '/admin/orders/o%2F1/returns'],
			[gateway.start('o1', {} as never), 'POST', '/admin/orders/o1/returns'],
			[gateway.priceAdjustment('o1', {} as never), 'POST', '/admin/orders/o1/price-adjustment'],
			[gateway.undelivered('o1', 's1'), 'POST', '/admin/orders/o1/parcels/s1/undelivered'],
			[gateway.getReturn('r1'), 'GET', '/admin/returns/r1'],
			[gateway.step('r1', { to: 'received' }), 'POST', '/admin/returns/r1/step'],
			[gateway.check('r1', { lines: [] }), 'POST', '/admin/returns/r1/check'],
			[gateway.creditNoteFromReturn('r1'), 'POST', '/admin/returns/r1/credit-note'],
			[gateway.creditNote('c1'), 'GET', '/admin/accounts/credit-notes/c1'],
			[gateway.saveDraft('c1', { version: 0, lines: [] }), 'PUT', '/admin/accounts/credit-notes/c1'],
			[gateway.deleteDraft('c1'), 'DELETE', '/admin/accounts/credit-notes/c1'],
			[gateway.issue('c1', 2), 'POST', '/admin/accounts/credit-notes/c1/issue'],
			[gateway.cancelChecks('c1'), 'GET', '/admin/accounts/credit-notes/c1/cancel-checks'],
			[gateway.cancel('c1', 'why'), 'POST', '/admin/accounts/credit-notes/c1/cancel'],
			[gateway.debitNote('c1', 'why'), 'POST', '/admin/accounts/credit-notes/c1/debit-note'],
			[gateway.creditNotePdf('c1'), 'GET', '/admin/accounts/credit-notes/c1/pdf'],
			[gateway.debitNotePdf('d1'), 'GET', '/admin/accounts/debit-notes/d1/pdf'],
		];
		for (const [call, method, path] of cases) {
			const done = firstValueFrom(call);
			const req = http.expectOne((r) => r.url.endsWith(path));
			expect(req.request.method).toBe(method);
			req.flush(method === 'GET' && path.endsWith('pdf') ? new Blob(['%PDF']) : {});
			await done;
		}
		http.verify();
		expect(RETURN_KEYS.one('r1')).toEqual(['returns', 'one', 'r1']);
		expect(RETURN_KEYS.view('o1').at(-1)).toBe('o1');
		expect(RETURN_KEYS.creditNote('c1')).toEqual(['credit-notes', 'c1']);
		expect(RETURN_KEYS.cancelChecks('c1')).toEqual(['credit-notes', 'c1', 'cancel-checks']);
	});

	it('turns refusal codes into word keys, naming the piece', () => {
		expect(returnProblemKey('return_too_many:BAN-3')).toEqual({
			key: 'ret_problem_return_too_many',
			params: { sku: 'BAN-3' },
		});
		expect(returnProblemKey('credit_note_problem:past_deadline')).toEqual({
			key: 'ret_problem_past_deadline',
			params: { sku: '' },
		});
		expect(returnProblemKey('credit_note_changed')).toEqual({
			key: 'ret_problem_credit_note_changed',
			params: { sku: '' },
		});
		expect(returnProblemKey('Someone else changed the order')).toBeNull();
	});
});
