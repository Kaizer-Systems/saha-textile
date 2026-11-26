import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DocumentLocksGateway } from './document-locks.gateway';

describe('document locks gateway (D10, B7)', () => {
	it('calls each route with its method and the document', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(DocumentLocksGateway);
		const http = TestBed.inject(HttpTestingController);
		const cases: [Observable<unknown>, string, string][] = [
			[gateway.claim('creditNote', 'cn_1'), 'POST', '/admin/document-locks'],
			[gateway.heartbeat('creditNote', 'cn_1'), 'POST', '/admin/document-locks/heartbeat'],
			[gateway.current('creditNote', 'cn/1'), 'GET', '/admin/document-locks/creditNote/cn%2F1'],
			[gateway.askRelease('creditNote', 'cn_1'), 'POST', '/admin/document-locks/ask-release'],
			[gateway.takeOver('creditNote', 'cn_1'), 'POST', '/admin/document-locks/take-over'],
			[gateway.release('creditNote', 'cn_1'), 'DELETE', '/admin/document-locks/creditNote/cn_1'],
		];
		for (const [call, method, path] of cases) {
			const done = firstValueFrom(call);
			const req = http.expectOne((r) => r.url.endsWith(path) && r.method === method);
			if (method === 'POST') expect(req.request.body).toEqual({ documentType: 'creditNote', documentId: 'cn_1' });
			req.flush({});
			await done;
		}
		http.verify();
	});
});
