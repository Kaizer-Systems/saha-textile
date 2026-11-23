import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { LocationFormPage } from './location-form';

function setup() {
	const gateway = {
		list: vi.fn(() => of([])),
		create: vi.fn(() => of({})),
		save: vi.fn(() => of({})),
		setActive: vi.fn(() => of({})),
	};
	TestBed.configureTestingModule({
		imports: [LocationFormPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: LocationsGateway, useValue: gateway },
			{
				provide: CompanyGateway,
				useValue: {
					registrations: () =>
						of([
							{ id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', stateCode: '19' },
							{ id: 'reg_tr', gstin: '16AAAAA0000A1Z5', stateCode: '16' },
						]),
				},
			},
			{ provide: AuthStore, useValue: { permissions: signal(['setting.index', 'location.edit']) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	const fixture = TestBed.createComponent(LocationFormPage);
	return { fixture, page: fixture.componentInstance, gateway };
}
const settle = async (fixture: ReturnType<typeof setup>['fixture']) => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		fixture.detectChanges();
	}
};

describe('Add location (accounts brief K2)', () => {
	it('keeps a store a warehouse, an office stock-free, and offers only same-State registrations', async () => {
		const { fixture, page } = setup();
		await settle(fixture);
		page.set('store', true);
		expect(page.form()).toMatchObject({ store: true, warehouse: true, office: false });
		page.set('office', true);
		expect(page.form()).toMatchObject({ office: true, warehouse: false, store: false });
		expect(page.registrationChoices().map((r) => r.id)).toEqual(['reg_wb']);
		page.set('gstRegistrationId', 'reg_wb');
		page.set('stateCode', '16');
		expect(page.form().gstRegistrationId).toBeNull();
		expect(page.registrationChoices().map((r) => r.id)).toEqual(['reg_tr']);
	});
});
