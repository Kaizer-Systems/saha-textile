import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ACCOUNTS_TEMPLATE_KEYS, AccountsTemplatesGateway } from './accounts-templates.gateway';

describe('accounts templates gateway (T2, T3)', () => {
	it('calls each route with its method', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(AccountsTemplatesGateway);
		const http = TestBed.inject(HttpTestingController);
		const base = '/admin/accounts/templates';
		const cases: [Observable<unknown>, string, string][] = [
			[gateway.library(), 'GET', base],
			[gateway.get('CH-PROP'), 'GET', `${base}/CH-PROP`],
			[gateway.opens('llp'), 'GET', `${base}/opens`],
			[gateway.setUpBooks(), 'POST', `${base}/set-up-books`],
		];
		for (const [call, method, path] of cases) {
			const done = firstValueFrom(call);
			const req = http.expectOne((r) => r.url.endsWith(path) && r.method === method);
			if (path.endsWith('/opens')) expect(req.request.params.get('kind')).toBe('llp');
			req.flush({});
			await done;
		}
		http.verify();
		expect(ACCOUNTS_TEMPLATE_KEYS.library).toEqual(['accounts-templates', 'library']);
		expect(ACCOUNTS_TEMPLATE_KEYS.one('CH-PROP')).toEqual(['accounts-templates', 'CH-PROP']);
		expect(ACCOUNTS_TEMPLATE_KEYS.opens('llp')).toEqual(['accounts-templates', 'opens', 'llp']);
	});
});
