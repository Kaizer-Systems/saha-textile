import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EDocsGateway, type EDocSettingsView } from '@core/edocs/edocs.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EDOC_PATH_ROWS, EDocSettingsPage } from './edoc-settings';

import type { EDocSettings } from '@saha-textile/contracts';

/** Settings › E-invoice and e-way bill (addendum 2, EI1, EI2, AE1–AE9): each path's status, its keys, Test and Remove. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
type Keys = EDocSettings['keys'][number];
const keys = (path: Keys['path'], over: Partial<Keys> = {}): Keys => ({
	path,
	provider: path === 'ewbDirect' ? 'nicEwb' : path === 'irpDirect' ? 'nicIrp' : 'mastersIndia',
	environment: 'production',
	baseUrl: 'https://api.example.test',
	userName: 'k-r-marketing',
	clientIdHint: '…1234',
	hasClientSecret: true,
	hasPassword: true,
	hasPublicKey: false,
	passwordSetOn: null,
	testedAt: null,
	testOk: null,
	testMessage: null,
	...over,
});
const view = (patch: Partial<EDocSettings> = {}, over: Partial<EDocSettingsView> = {}): EDocSettingsView => ({
	gstin: '19DBYPS6736R1ZZ',
	keysAvailable: true,
	settings: {
		gstin: '19DBYPS6736R1ZZ',
		eInvoicePath: 'manual',
		eWayBillPath: 'manual',
		eWayBillWithEInvoice: true,
		eInvoiceEnabledFrom: '2026-04-01',
		eWayBillThresholdINR: 50_000,
		keys: [],
		revision: 1,
		updatedAt: '2026-11-23T10:00:00.000Z',
		updatedBy: null,
		...patch,
	} satisfies EDocSettings,
	...over,
});
const refusal = (message: string) => ({ error: { error: { message } } });
const row = (id: string) => EDOC_PATH_ROWS.find((r) => r.id === id) as (typeof EDOC_PATH_ROWS)[number];

function mount(
	current: EDocSettingsView,
	gateway: Record<string, unknown> = {},
	permissions = ['setting.index', 'edocs.settings'],
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		settings: vi.fn(() => of(current)),
		saveSettings: vi.fn(() => of(current)),
		saveKeys: vi.fn(() => of(current)),
		test: vi.fn(() => of(current)),
		removeKeys: vi.fn(() => of(current)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			EDocSettingsPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: EDocsGateway, useValue: calls },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(EDocSettingsPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, calls };
}
async function opened(...args: Parameters<typeof mount>) {
	const harness = mount(...args);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const pathRow = (fixture: { nativeElement: HTMLElement }, index: number) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')][index] as HTMLElement;
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};

describe('each path’s status (EI2)', () => {
	it('names every state a path can be in', async () => {
		const chosen = await opened(
			view({
				eInvoicePath: 'irpDirect',
				eWayBillPath: 'ewbProvider',
				keys: [
					keys('irpDirect', { testOk: true }),
					keys('irpProvider', { testOk: false }),
					keys('ewbDirect', { testOk: true }),
					keys('ewbProvider', { testOk: true }),
				],
			}),
		);
		const status = (id: string) => chosen.page.statusOf(row(id));
		expect(status('manualInvoice')).toEqual({ key: 'edoc_status_fallback', tone: 'pending' });
		expect(status('irpDirect')).toEqual({ key: 'edoc_status_active', tone: 'success' });
		expect(status('irpProvider')).toEqual({ key: 'edoc_status_test_failed', tone: 'danger' });
		expect(status('ewbDirect')).toEqual({ key: 'edoc_status_tested', tone: 'success' });
		expect(status('ewbProvider')).toEqual({ key: 'edoc_status_active', tone: 'success' });
		expect(pathRow(chosen.fixture, 2).querySelector('.status-danger')?.textContent).toContain(
			'edoc_status_test_failed',
		);
		const fresh = await opened(view({ eInvoiceEnabledFrom: null, keys: [keys('ewbDirect')] }));
		expect(fresh.page.statusOf(row('irpDirect')).key).toBe('edoc_status_waits_enablement');
		expect(fresh.page.statusOf(row('ewbDirect')).key).toBe('edoc_status_needs_test');
		expect(fresh.page.statusOf(row('ewbProvider')).key).toBe('edoc_status_no_keys');
		expect(fresh.page.statusOf(row('manualBill')).key).toBe('edoc_status_active');
		const enabled = await opened(view());
		expect(enabled.page.statusOf(row('irpProvider')).key).toBe('edoc_status_no_keys');
	});

	it('says when there is no GSTIN, and when keys cannot be kept on this server', async () => {
		const noGstin = await opened(view({}, { gstin: null, settings: null }));
		expect(noGstin.page.settings()).toBeNull();
		expect(el(noGstin.fixture, '#edoc_save')).toBeNull();
		const noKeys = await opened(view({}, { keysAvailable: false }));
		expect(noKeys.fixture.nativeElement.querySelectorAll('a[title="edoc_add_keys"]')).toHaveLength(0);
		const full = await opened(view({ keys: [keys('irpDirect')] }));
		expect(full.fixture.nativeElement.querySelectorAll('a[title="edoc_add_keys"]')).toHaveLength(4);
		expect(full.fixture.nativeElement.querySelectorAll('a[title="edoc_test"]')).toHaveLength(1);
	});
});

describe('a path’s keys (EI2, AE2, AE3)', () => {
	it('opens a path’s stored keys, or a provider’s sandbox, and asks for a public key only on direct paths', async () => {
		const { fixture, page } = await opened(view({ keys: [keys('irpProvider')] }));
		(pathRow(fixture, 2).querySelector('a[title="edoc_add_keys"]') as HTMLElement).click();
		await settle(fixture);
		expect([page.keysPath(), page.provider(), page.environment(), page.baseUrl(), page.userName()]).toEqual([
			'irpProvider',
			'mastersIndia',
			'production',
			'https://api.example.test',
			'k-r-marketing',
		]);
		expect([...(el<HTMLSelectElement>(fixture, '#edoc_provider')?.options ?? [])].map((o) => o.value)).toEqual([
			'mastersIndia',
		]);
		expect(el(fixture, '#edoc_public_key')).toBeNull();
		page.openKeys('ewbDirect');
		await settle(fixture);
		expect([page.provider(), page.environment(), page.baseUrl()]).toEqual(['nicEwb', 'sandbox', '']);
		expect(el(fixture, '#edoc_public_key')).not.toBeNull();
		expect(page.providersOf('irpDirect')).toEqual(['irisIrp', 'nicIrp']);
		expect([page.needsPublicKey('irpDirect'), page.needsPublicKey('ewbProvider')]).toEqual([true, false]);
	});

	it('saves every secret typed, trimmed, then forgets the password and secret', async () => {
		const { fixture, page, calls, notifier } = await opened(view());
		page.openKeys('irpDirect');
		await settle(fixture);
		await enter(fixture, el(fixture, '#edoc_provider'), 'nicIrp');
		await enter(fixture, el(fixture, '#edoc_environment'), 'production');
		await enter(fixture, el(fixture, '#edoc_user'), ' k-r-marketing ');
		await enter(fixture, el(fixture, '#edoc_base_url'), ' https://einvoice1.gst.gov.in ');
		await enter(fixture, el(fixture, '#edoc_password'), 'pw');
		await enter(fixture, el(fixture, '#edoc_client_id'), ' client-1 ');
		await enter(fixture, el(fixture, '#edoc_client_secret'), 'secret');
		await enter(fixture, el(fixture, '#edoc_public_key'), ' -----BEGIN PUBLIC KEY----- ');
		el<HTMLButtonElement>(fixture, '#edoc_save_keys')?.click();
		await settle(fixture);
		expect(calls.saveKeys).toHaveBeenCalledWith({
			path: 'irpDirect',
			provider: 'nicIrp',
			environment: 'production',
			baseUrl: 'https://einvoice1.gst.gov.in',
			userName: 'k-r-marketing',
			password: 'pw',
			clientId: 'client-1',
			clientSecret: 'secret',
			publicKeyPem: '-----BEGIN PUBLIC KEY-----',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('edoc_keys_saved');
		expect([page.password(), page.clientSecret(), page.clientId()]).toEqual(['', '', ' client-1 ']);
	});

	it('names a refusal by its code, says it simply failed otherwise, and keeps what was typed', async () => {
		const saveKeys = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('edoc_keys_rejected: the portal said no')))
			.mockReturnValueOnce(throwError(() => refusal('quota')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await opened(view(), { saveKeys });
		page.openKeys('ewbProvider');
		page.userName.set('api');
		page.password.set('pw');
		await page.saveKeys();
		expect(notifier.showError).toHaveBeenLastCalledWith('edoc_keys_rejected');
		await page.saveKeys();
		expect(notifier.showError).toHaveBeenLastCalledWith('edoc_save_failed');
		await page.saveKeys();
		expect(notifier.showError).toHaveBeenLastCalledWith('edoc_save_failed');
		expect([page.password(), page.saving()]).toEqual(['pw', false]);
	});

	it('tests a path’s keys, and removes them, closing their form when it is that path’s', async () => {
		const { fixture, page, calls, notifier } = await opened(view({ keys: [keys('irpDirect'), keys('ewbDirect')] }));
		(pathRow(fixture, 1).querySelector('a[title="edoc_test"]') as HTMLElement).click();
		await settle(fixture);
		expect(calls.test).toHaveBeenCalledWith('irpDirect');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('edoc_test_done');
		page.openKeys('ewbDirect');
		await page.removeKeys('irpDirect');
		expect(calls.removeKeys).toHaveBeenLastCalledWith('irpDirect');
		expect(page.keysPath()).toBe('ewbDirect');
		(pathRow(fixture, 4).querySelector('a[title="edoc_remove_keys"]') as HTMLElement).click();
		await settle(fixture);
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('edoc_keys_removed');
		expect(page.keysPath()).toBeNull();
	});

	it('saves no keys with no path open, and changes nothing for someone who may not', async () => {
		const editor = await opened(view());
		await editor.page.saveKeys();
		expect(editor.calls.saveKeys).not.toHaveBeenCalled();
		editor.page.openKeys('ewbProvider');
		editor.page.userName.set('api');
		await editor.page.saveKeys();
		expect(editor.calls.saveKeys).toHaveBeenCalledWith({
			path: 'ewbProvider',
			provider: 'mastersIndia',
			environment: 'sandbox',
			baseUrl: 'https://clientbasic.mastersindia.co',
			userName: 'api',
		});
		const reader = await opened(view({ keys: [keys('irpDirect')] }), {}, ['setting.index']);
		reader.page.openKeys('irpDirect');
		await reader.page.saveKeys();
		await reader.page.removeKeys('irpDirect');
		await reader.page.save();
		expect(
			[reader.calls.saveKeys, reader.calls.removeKeys, reader.calls.saveSettings].map((c) => c.mock.calls.length),
		).toEqual([0, 0, 0]);
	});
});

describe('saving the paths and the e-way bill threshold (EI1)', () => {
	it('sends no enablement day when it is cleared and a whole, never-negative threshold', async () => {
		const { fixture, page, calls } = await opened(view());
		await enter(fixture, el(fixture, '#edoc_enabled_from'), '');
		el<HTMLInputElement>(fixture, '#edoc_with_einvoice')?.click();
		page.threshold.set(-20 as never);
		await page.save();
		expect(calls.saveSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({
				eInvoiceEnabledFrom: null,
				eWayBillThresholdINR: 0,
				eWayBillWithEInvoice: false,
			}),
			'2026-11-23T10:00:00.000Z',
		);
		page.threshold.set('lots' as never);
		await page.save();
		expect(calls.saveSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({ eWayBillThresholdINR: 0 }),
			expect.anything(),
		);
		await enter(fixture, el(fixture, '#edoc_threshold'), '75000.4');
		el<HTMLButtonElement>(fixture, '#edoc_save')?.click();
		await settle(fixture);
		expect(calls.saveSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({ eWayBillThresholdINR: 75_000 }),
			expect.anything(),
		);
	});

	it('saves over no known copy when there were no settings yet', async () => {
		const { page, calls } = await opened(view({}, { settings: null }));
		await page.save();
		expect(calls.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ eInvoicePath: 'manual' }), null);
	});
});
