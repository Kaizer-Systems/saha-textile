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

describe('Add location: the last cases', () => {
	it('saves a petty cash float that is not a number as ₹0', async () => {
		const { fixture, page, gateway } = setup();
		await settle(fixture);
		page.set('pettyCashFloatINR', 'abc' as never);
		await page.save();
		expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ pettyCashFloatINR: 0 }));
	});
});
