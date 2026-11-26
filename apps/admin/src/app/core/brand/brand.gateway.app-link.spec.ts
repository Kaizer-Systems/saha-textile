import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandGateway } from './brand.gateway';

vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: { apiUrl: 'https://api.test' } }));

describe('BrandGateway app store links', () => {
	it('asks the API whether the address is a real store page', async () => {
		const http = { post: vi.fn(() => of({ ok: true, name: 'Saha Textile' })) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
		const answer = await firstValueFrom(
			TestBed.inject(BrandGateway).checkAppLink('android', 'https://play.google.com/store/apps/details?id=x'),
		);
		expect(answer).toEqual({ ok: true, name: 'Saha Textile' });
		expect(http.post).toHaveBeenCalledWith('https://api.test/admin/settings/brand/app-link', {
			store: 'android',
			url: 'https://play.google.com/store/apps/details?id=x',
		});
	});
});
