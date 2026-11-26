import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { gstinCheckCharacter } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { GstRegistrationsSettings } from './gst-registrations';

const GSTIN = `19AAPFU0939F1Z${gstinCheckCharacter('19AAPFU0939F1Z')}`;

function setup() {
	const gateway = {
		registrations: vi.fn(() => of([])),
		addRegistration: vi.fn(() => of({})),
		saveRegistration: vi.fn(() => of({})),
	};
	TestBed.configureTestingModule({
		imports: [TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CompanyGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { permissions: () => ['setting.index', 'company.edit'] } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	return { page: TestBed.runInInjectionContext(() => new GstRegistrationsSettings()), gateway };
}

describe('Settings › GST registrations (accounts brief J2, G1, G2)', () => {
	it('checks the GSTIN and the scheme as they are typed, and saves the terms with the turnover checks', async () => {
		const { page, gateway } = setup();
		page.add();
		page.patch({ gstin: '19AAPFU0939F1ZZ' });
		expect(page.gstinCheck()?.problem).toBe('check_digit');
		page.patch({ gstin: GSTIN, scheme: 'qrmp', lastYearTurnoverINR: 60_000_000 });
		expect(page.gstinCheck()).toBeNull();
		expect(page.stateName()).toBe('West Bengal');
		expect(page.problems()).toEqual(['qrmp_over_limit']);
		await page.save();
		expect(gateway.addRegistration).not.toHaveBeenCalled();
		page.patch({ scheme: 'monthly' });
		expect(page.checks()).toMatchObject({ eInvoice: true, hsnDigits: 6, reconciliationStatement: true });
		await page.save();
		expect(gateway.addRegistration).toHaveBeenCalledWith(
			expect.objectContaining({
				gstin: GSTIN,
				terms: expect.objectContaining({ scheme: 'monthly', eInvoice: true, hsnDigits: 6 }),
			}),
		);
		expect(page.draft()).toBeNull();
	});
});
