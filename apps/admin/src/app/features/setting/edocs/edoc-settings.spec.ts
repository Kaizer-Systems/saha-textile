import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EDocsGateway, type EDocSettingsView } from '@core/edocs/edocs.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EDocSettingsPage } from './edoc-settings';

import type { EDocSettings } from '@saha-textile/contracts';

const view = (patch: Partial<EDocSettings> = {}): EDocSettingsView => ({
	gstin: '19DBYPS6736R1ZZ',
	keysAvailable: true,
	settings: {
		gstin: '19DBYPS6736R1ZZ',
		eInvoicePath: 'manual',
		eWayBillPath: 'manual',
		eWayBillWithEInvoice: true,
		eInvoiceEnabledFrom: null,
		eWayBillThresholdINR: 50_000,
		keys: [],
		revision: 0,
		updatedAt: '2026-11-23T10:00:00.000Z',
		updatedBy: null,
		...patch,
	} satisfies EDocSettings,
});

function setup(current: EDocSettingsView, permissions = ['setting.index', 'edocs.settings']) {
	const gateway = {
		settings: vi.fn(() => of(current)),
		saveSettings: vi.fn(() => of(current)),
		saveKeys: vi.fn(() => of(current)),
		test: vi.fn(() => of(current)),
		removeKeys: vi.fn(() => of(current)),
	};
	TestBed.configureTestingModule({
		imports: [EDocSettingsPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: EDocsGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	const fixture = TestBed.createComponent(EDocSettingsPage);
	return { fixture, page: fixture.componentInstance, gateway };
}

const settle = async (fixture: ReturnType<typeof setup>['fixture']) => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		fixture.detectChanges();
	}
};

describe('Settings › E-invoice and e-way bill (addendum 2)', () => {
	it('says the GSTIN is not enabled and keeps automatic paths unpickable until their keys pass Test', async () => {
		const { fixture, page } = setup(view());
		await settle(fixture);
		const el: HTMLElement = fixture.nativeElement;
		expect(el.querySelector('#edoc_not_enabled')).not.toBeNull();
		expect((el.querySelector('#edoc_einvoice_irpDirect') as HTMLInputElement).disabled).toBe(true);
		expect(page.statusOf(page.rows[0]!).key).toBe('edoc_status_waits_enablement');
		expect(page.statusOf(page.rows[3]!).key).toBe('edoc_status_active');
	});

	it('lets a tested path be chosen and saves the choice with the copy read', async () => {
		const tested = view({
			eInvoiceEnabledFrom: '2026-04-01',
			keys: [
				{
					path: 'irpDirect',
					provider: 'irisIrp',
					environment: 'sandbox',
					baseUrl: 'https://sandbox.einvoice6.gst.gov.in',
					userName: 'api',
					clientIdHint: '…1234',
					hasClientSecret: true,
					hasPassword: true,
					hasPublicKey: true,
					passwordSetOn: null,
					testedAt: '2026-11-23T10:00:00.000Z',
					testOk: true,
					testMessage: null,
				},
			],
		});
		const { fixture, page, gateway } = setup(tested);
		await settle(fixture);
		expect((fixture.nativeElement.querySelector('#edoc_einvoice_irpDirect') as HTMLInputElement).disabled).toBe(
			false,
		);
		page.eInvoicePath.set('irpDirect');
		await page.save();
		expect(gateway.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ eInvoicePath: 'irpDirect', eInvoiceEnabledFrom: '2026-04-01' }),
			'2026-11-23T10:00:00.000Z',
		);
	});

	it('sends only the secrets typed in, so blanks keep the stored ones', async () => {
		const { fixture, page, gateway } = setup(view());
		await settle(fixture);
		page.openKeys('irpDirect');
		expect(page.baseUrl()).toBe('https://sandbox.einvoice6.gst.gov.in');
		page.userName.set('api-user');
		page.password.set('pw');
		await page.saveKeys();
		expect(gateway.saveKeys).toHaveBeenCalledWith({
			path: 'irpDirect',
			provider: 'irisIrp',
			environment: 'sandbox',
			baseUrl: 'https://sandbox.einvoice6.gst.gov.in',
			userName: 'api-user',
			password: 'pw',
		});
		expect(page.password()).toBe('');
	});

	it('is read-only without edocs.settings', async () => {
		const { fixture } = setup(view(), ['setting.index']);
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('#edoc_save')).toBeNull();
	});
});
