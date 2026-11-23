import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import { ConvertGateway } from './convert.gateway';

describe('Convert gateway (AC2)', () => {
	it('previews with the kind and last day, and converts, both quietly', async () => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ConvertGateway);
		const http = TestBed.inject(HttpTestingController);
		const preview = firstValueFrom(gateway.preview('partnership', '2026-10-31'));
		const get = http.expectOne((r) => r.url.endsWith('/admin/company/convert/preview') && r.method === 'GET');
		expect([get.request.params.get('kind'), get.request.params.get('lastDay')]).toEqual([
			'partnership',
			'2026-10-31',
		]);
		expect(get.request.context.get(QUIET_ERRORS)).toBe(true);
		get.flush({});
		await preview;
		const run = firstValueFrom(gateway.convert({ kind: 'partnership', lastDay: '2026-10-31', mapping: [] }));
		const post = http.expectOne((r) => r.url.endsWith('/admin/company/convert') && r.method === 'POST');
		expect(post.request.context.get(QUIET_ERRORS)).toBe(true);
		post.flush({});
		await run;
		http.verify();
	});
});
