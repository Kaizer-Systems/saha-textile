import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { FeatureSwitchesSettings } from './feature-switches';

/** Settings › Features drawn (accounts brief J3): the switches, what holds them, and saving. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ROWS = [
	{ key: 'locations', on: false, inUse: 0, needs: [] },
	{ key: 'stores', on: false, inUse: 0, needs: ['locations'] },
	{ key: 'payroll', on: true, inUse: 14, needs: [] },
];

function mount(gateway: Record<string, unknown>, permissions = ['setting.index', 'company.edit']) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		features: vi.fn(() => of({ rows: ROWS, updatedAt: '2026-11-23T10:00:00.000Z' })),
		saveFeatures: vi.fn(() => of({})),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			FeatureSwitchesSettings,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: CompanyGateway, useValue: calls },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(FeatureSwitchesSettings);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, calls };
}

const switches = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody input[type="checkbox"]')] as HTMLInputElement[];

describe('the feature switches drawn (J3)', () => {
	it('shows each switch, locks one in use, holds Save while a need is off, and saves the changes', async () => {
		const { fixture, calls, notifier } = mount({});
		await settle(fixture);
		expect(switches(fixture).map((s) => [s.checked, s.disabled])).toEqual([
			[false, false],
			[false, false],
			[true, true],
		]);
		const save = fixture.nativeElement.querySelector('#features_save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		switches(fixture)[1]?.click();
		await settle(fixture);
		expect(save.disabled).toBe(true);
		switches(fixture)[0]?.click();
		await settle(fixture);
		expect(save.disabled).toBe(false);
		save.click();
		await settle(fixture);
		expect(calls.saveFeatures).toHaveBeenCalledWith({ stores: true, locations: true }, '2026-11-23T10:00:00.000Z');
		expect(notifier.showSuccess).toHaveBeenCalledWith('features_saved');
	});

	it('saves over no known copy before the switches are read, and says when the save fails', async () => {
		const { page, calls, notifier } = mount({
			features: vi.fn(() => NEVER),
			saveFeatures: vi.fn(() => throwError(() => new Error('down'))),
		});
		page.toggle('locations', true);
		await page.save();
		expect(calls.saveFeatures).toHaveBeenCalledWith({ locations: true }, null);
		expect(notifier.showError).toHaveBeenCalledWith('features_save_failed');
		expect([page.saving(), page.dirty()]).toEqual([false, true]);
	});

	it('offers no Save to someone who may not change the switches, and every switch is off-limits', async () => {
		const { fixture } = mount({}, ['setting.index']);
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('#features_save')).toBeNull();
		expect(switches(fixture).every((s) => s.disabled)).toBe(true);
	});
});
