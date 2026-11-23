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
			[gateway.create({} as never), 'POST', base],
			[gateway.importTemplate({}), 'POST', `${base}/import`],
			[gateway.saveDraft('CH-PROP', {} as never), 'PUT', `${base}/CH-PROP/draft`],
			[gateway.changes('CH-PROP'), 'GET', `${base}/CH-PROP/changes`],
			[gateway.publish('CH-PROP', '2026-11-24T00:00:00.000Z'), 'POST', `${base}/CH-PROP/publish`],
			[gateway.roles(), 'GET', '/admin/accounts/roles'],
			[gateway.pointRole('cash', 'led_till'), 'PUT', '/admin/accounts/roles/cash'],
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
		expect(ACCOUNTS_TEMPLATE_KEYS.changes('CH-PROP')).toEqual(['accounts-templates', 'CH-PROP', 'changes']);
		expect(ACCOUNTS_TEMPLATE_KEYS.roles).toEqual(['accounts-templates', 'roles']);
	});
});
