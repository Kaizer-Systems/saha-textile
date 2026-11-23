import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { CompanyProfile } from '@saha-textile/contracts';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CompanyProfileSettings } from './company-profile';

const profile = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({
	kind: 'proprietorship',
	legalName: 'K.R. Marketing',
	tradeName: 'Saha Textile',
	pan: 'DBYPS6736R',
	tan: null,
	cin: null,
	llpin: null,
	udyam: null,
	financialYearStartMonth: 4,
	booksStartOn: null,
	homeCurrency: 'INR',
	proprietor: null,
	otherBusinesses: [],
	partners: [],
	partnersCapital: 'fixed_with_current',
	directors: [],
	shareholders: [],
	authorisedCapitalINR: 0,
	paidUpCapitalINR: 0,
	faceValueINR: 10,
	nomineeName: null,
	revision: 1,
	updatedAt: '2026-11-23T10:00:00.000Z',
	updatedBy: null,
	...patch,
});

function setup(current: CompanyProfile, permissions = ['setting.index', 'company.edit']) {
	const gateway = { profile: vi.fn(() => of(current)), saveProfile: vi.fn(() => of(current)) };
	TestBed.configureTestingModule({
		imports: [CompanyProfileSettings, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CompanyGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	const fixture = TestBed.createComponent(CompanyProfileSettings);
	return { fixture, page: fixture.componentInstance, gateway };
}
const settle = async (fixture: ReturnType<typeof setup>['fixture']) => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		fixture.detectChanges();
	}
};

describe('Settings › Company (accounts brief J1, CT1–CT6)', () => {
	it('offers five kinds with public limited switched off, and says what the kind sets', async () => {
		const { fixture, page } = setup(profile());
		await settle(fixture);
		const el: HTMLElement = fixture.nativeElement;
		expect(el.querySelectorAll('input[name="co_kind"]').length).toBe(5);
		expect(page.effects()?.incomeTaxReturn).toBe('ITR-3');
		expect(page.problems()).toEqual(['proprietor_needed']);
		expect((el.querySelector('#co_save') as HTMLButtonElement).disabled).toBe(true);
	});

	it('a partnership needs two partners whose shares make 100%, then saves with the copy read', async () => {
		const { fixture, page, gateway } = setup(profile());
		await settle(fixture);
		page.pickKind('partnership');
		page.addPartner();
		page.addPartner();
		const [a, b] = page.form()!.partners;
		page.patchPartner(a!.id, { name: 'Partner A', pan: 'ABCDE1234F', profitSharePercent: 60 });
		page.patchPartner(b!.id, { name: 'Partner B', pan: 'ABCDE1235F', profitSharePercent: 30 });
		expect(page.problems()).toContain('partner_shares_total_100');
		page.patchPartner(b!.id, { profitSharePercent: 40 });
		expect(page.problems()).toEqual([]);
		await page.save();
		expect(gateway.saveProfile).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'partnership' }),
			'2026-11-23T10:00:00.000Z',
		);
	});

	it('is read-only without company.edit', async () => {
		const { fixture } = setup(profile(), ['setting.index']);
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('#co_save')).toBeNull();
	});
});
