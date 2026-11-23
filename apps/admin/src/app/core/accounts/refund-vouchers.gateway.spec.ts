import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { REFUND_VOUCHER_KEYS, RefundVouchersGateway, refundProblemKey } from './refund-vouchers.gateway';

describe('refund vouchers gateway (C1, C2)', () => {
	it('calls each route with its method', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(RefundVouchersGateway);
		const http = TestBed.inject(HttpTestingController);
		const cases: [Observable<unknown>, string, string][] = [
			[gateway.cancelAndRefund('o/1', {} as never), 'POST', '/admin/orders/o%2F1/cancel-and-refund'],
			[gateway.get('r1'), 'GET', '/admin/accounts/refund-vouchers/r1'],
			[gateway.log('r1'), 'GET', '/admin/accounts/refund-vouchers/r1/log'],
			[gateway.pdf('r1'), 'GET', '/admin/accounts/refund-vouchers/r1/pdf'],
			[gateway.retry('r1'), 'POST', '/admin/accounts/refund-vouchers/r1/retry'],
			[
				gateway.byHand('r1', { ledgerId: 'l', reference: 'NEFT0001' }),
				'POST',
				'/admin/accounts/refund-vouchers/r1/by-hand',
			],
		];
		for (const [call, method, path] of cases) {
			const done = firstValueFrom(call);
			const req = http.expectOne((r) => r.url.endsWith(path) && r.method === method);
			req.flush(path.endsWith('pdf') ? new Blob(['%PDF']) : {});
			await done;
		}
		http.verify();
		expect(REFUND_VOUCHER_KEYS.one('r1')).toEqual(['refund-vouchers', 'r1']);
		expect(REFUND_VOUCHER_KEYS.log('r1')).toEqual(['refund-vouchers', 'r1', 'log']);
	});

	it('turns refusal codes into word keys', () => {
		expect(refundProblemKey('nothing_to_refund')).toBe('rf_problem_nothing_to_refund');
		expect(refundProblemKey('refund_needs_cash_or_bank')).toBe('rf_problem_refund_needs_cash_or_bank');
		expect(refundProblemKey('Someone else changed the order')).toBeNull();
	});
});
