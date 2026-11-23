import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { FeatureSwitchesSettings } from './feature-switches';

const rows = [
	{ key: 'locations', on: false, inUse: 0, needs: [] },
	{ key: 'stores', on: false, inUse: 0, needs: ['locations'] },
	{ key: 'payroll', on: true, inUse: 14, needs: [] },
];

function setup(permissions: string[]) {
	const gateway = {
		features: vi.fn(() => of({ rows, updatedAt: '2026-11-23T10:00:00.000Z' })),
		saveFeatures: vi.fn(() => of({})),
	};
	TestBed.configureTestingModule({
		imports: [TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CompanyGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	const page = TestBed.runInInjectionContext(() => new FeatureSwitchesSettings());
	return { page, gateway };
}

describe('Settings › Features (accounts brief J3)', () => {
	it('locks a switch in use, holds one whose need is off, and saves only the changes', async () => {
		const { page, gateway } = setup(['setting.index', 'company.edit']);
		for (let i = 0; i < 20 && !page.query.data(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
		expect(page.rows().find((row) => row.key === 'payroll')?.locked).toBe(true);
		page.toggle('stores', true);
		expect(page.rows().find((row) => row.key === 'stores')?.missing).toBe('locations');
		expect(page.blocked()).toBe(true);
		await page.save();
		expect(gateway.saveFeatures).not.toHaveBeenCalled();
		page.toggle('locations', true);
		expect(page.blocked()).toBe(false);
		await page.save();
		expect(gateway.saveFeatures).toHaveBeenCalledWith(
			{ stores: true, locations: true },
			'2026-11-23T10:00:00.000Z',
		);
	});

	it('is read only without company.edit', async () => {
		const { page, gateway } = setup(['setting.index']);
		page.toggle('locations', true);
		await page.save();
		expect(page.canEdit()).toBe(false);
		expect(gateway.saveFeatures).not.toHaveBeenCalled();
	});
});
