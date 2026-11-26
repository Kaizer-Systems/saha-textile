import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { gstinCheckCharacter } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { GstRegistrationsSettings } from './gst-registrations';

import type { GstRegistration, GstRegistrationTerms } from '@saha-textile/contracts';

/** Settings › GST registrations drawn (accounts brief J2, G1, G2): the list, Add and Edit, and saving. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const gstin = (body: string) => `${body}${gstinCheckCharacter(body)}`;
const BENGAL = gstin('19AAPFU0939F1Z');
const terms = (from: string, over: Partial<GstRegistrationTerms> = {}): GstRegistrationTerms => ({
	from,
	kind: 'regular',
	scheme: 'monthly',
	compositionRatePercent: null,
	lastYearTurnoverINR: 1_00_00_000,
	eInvoice: false,
	eInvoiceThirtyDays: false,
	annualReturn: false,
	reconciliationStatement: false,
	hsnDigits: 4,
	...over,
});
const registration = (id: string, over: Partial<GstRegistration> = {}): GstRegistration => ({
	id,
	gstin: BENGAL,
	stateCode: '19',
	legalName: 'K.R. Marketing',
	tradeName: 'Saha Textile',
	terms: [terms('2025-04-01'), terms('2024-04-01', { scheme: 'qrmp' })],
	active: true,
	createdAt: '2025-04-01T00:00:00.000Z',
	updatedAt: '2025-04-01T00:00:00.000Z',
	...over,
});
const IN_FORCE = registration('reg_1');
const LATER = registration('reg_2', {
	gstin: gstin('29AAPFU0939F1Z'),
	stateCode: '29',
	terms: [terms('2099-01-01', { kind: 'composition', scheme: 'qrmp', compositionRatePercent: 1 })],
	active: false,
});
const NO_TERMS = registration('reg_3', { terms: [] as never });

function mount(options: { list?: GstRegistration[]; permissions?: string[]; gateway?: Record<string, unknown> } = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		registrations: vi.fn(() => of(options.list ?? [IN_FORCE, LATER, NO_TERMS])),
		addRegistration: vi.fn(() => of(IN_FORCE)),
		saveRegistration: vi.fn(() => of(IN_FORCE)),
		...options.gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			GstRegistrationsSettings,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			{ provide: CompanyGateway, useValue: calls },
			{
				provide: AuthStore,
				useValue: { permissions: () => options.permissions ?? ['setting.index', 'company.edit'] },
			},
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(GstRegistrationsSettings);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}
async function opened(options: Parameters<typeof mount>[0] = {}) {
	const harness = mount(options);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: HTMLElement | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim() ?? '');
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};

describe('the GST registrations list (J2)', () => {
	it('shows each GSTIN with its State, the terms in force today, or the first ones before any start', async () => {
		const { fixture, page } = await opened();
		expect(cells(rows(fixture)[0])).toEqual([
			BENGAL,
			'West Bengal (19)',
			'gst_kind_regular',
			'gst_scheme_monthly',
			'2025-04-01',
			'active',
			'',
		]);
		expect(cells(rows(fixture)[1]).slice(2, 6)).toEqual([
			'gst_kind_composition',
			'gst_scheme_qrmp',
			'2099-01-01',
			'inactive',
		]);
		expect(page.rows()[2]?.terms).toBeNull();
		expect(rows(fixture).map((row) => row.querySelectorAll('a[title="edit"]').length)).toEqual([1, 1, 1]);
		expect(el(fixture, '#gst_add')).not.toBeNull();
	});

	it('says when there are none, and offers no changes to someone who may not edit', async () => {
		const empty = await opened({ list: [] });
		expect(cells(rows(empty.fixture)[0])).toEqual(['gst_registrations_none']);
		const reader = await opened({ permissions: ['setting.index'] });
		expect(el(reader.fixture, '#gst_add')).toBeNull();
		expect(reader.fixture.nativeElement.querySelectorAll('a[title="edit"]')).toHaveLength(0);
		reader.page.add();
		await reader.page.save();
		expect(reader.calls.addRegistration).not.toHaveBeenCalled();
	});

	it('changes nothing with no form open: no checks, no problems, no save', async () => {
		const { page, calls } = await opened();
		page.patch({ gstin: BENGAL });
		expect([page.draft(), page.gstinCheck(), page.stateName(), page.checks(), page.problems()]).toEqual([
			null,
			null,
			null,
			null,
			[],
		]);
		await page.save();
		expect(calls.addRegistration).not.toHaveBeenCalled();
	});
});

describe('adding and editing a registration (G1, G2)', () => {
	it('opens Edit on the terms in force from today, hides Add, and saves the change to that GSTIN', async () => {
		const { fixture, page, calls, notifier, invalidate } = await opened();
		(rows(fixture)[0]?.querySelector('a[title="edit"]') as HTMLElement).click();
		await settle(fixture);
		expect(page.draft()).toMatchObject({ id: 'reg_1', gstin: BENGAL, kind: 'regular', scheme: 'monthly' });
		expect(page.draft()?.from).toBe(new Date().toISOString().slice(0, 10));
		expect(el(fixture, '#gst_add')).toBeNull();
		expect(el(fixture, '#gst_form small.help-text')?.textContent).toContain('West Bengal');
		expect([...(el(fixture, '#gst_checks')?.querySelectorAll('li') ?? [])]).toHaveLength(6);
		await enter(fixture, el(fixture, '#gst_trade'), 'Saha Textile Barasat');
		el<HTMLButtonElement>(fixture, '#gst_save')?.click();
		await settle(fixture);
		expect(calls.saveRegistration).toHaveBeenCalledWith(
			'reg_1',
			expect.objectContaining({ gstin: BENGAL, tradeName: 'Saha Textile Barasat', active: true }),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['company']) });
		expect(notifier.showSuccess).toHaveBeenCalledWith('gst_registration_saved');
		expect(page.draft()).toBeNull();
	});

	it('edits a registration whose terms all start later from its first terms, and opens nothing without terms', async () => {
		const { page } = await opened();
		page.edit(LATER);
		expect(page.draft()).toMatchObject({ id: 'reg_2', kind: 'composition', compositionRatePercent: 1 });
		page.close();
		page.edit(NO_TERMS);
		expect(page.draft()).toBeNull();
	});

	it('checks the GSTIN as typed: nothing yet, the wrong shape, then a good one with spaces and small letters', async () => {
		const { fixture, page } = await opened();
		el<HTMLButtonElement>(fixture, '#gst_add')?.click();
		await settle(fixture);
		expect([page.gstinCheck(), page.stateName()]).toEqual([null, null]);
		await enter(fixture, el(fixture, '#gst_gstin'), '1');
		expect([page.gstinCheck(), page.stateName()]).toEqual([{ problem: 'shape' }, null]);
		expect(el(fixture, '#gst_form .invalid-feedback')?.textContent).toContain('gstin_problem_shape');
		expect(el<HTMLButtonElement>(fixture, '#gst_save')?.disabled).toBe(true);
		await enter(fixture, el(fixture, '#gst_gstin'), `${BENGAL.slice(0, 7).toLowerCase()} ${BENGAL.slice(7)}`);
		expect(page.gstinCheck()).toBeNull();
		expect(page.stateName()).toBe('West Bengal');
	});

	it('saves an input service distributor monthly whatever was picked, and a composition rate only for composition', async () => {
		const { fixture, page, calls } = await opened();
		el<HTMLButtonElement>(fixture, '#gst_add')?.click();
		await settle(fixture);
		await enter(fixture, el(fixture, '#gst_gstin'), BENGAL);
		await enter(fixture, el(fixture, '#gst_scheme'), 'qrmp');
		await enter(fixture, el(fixture, '#gst_kind'), 'composition');
		expect(el(fixture, '#gst_rate')).not.toBeNull();
		expect(page.problems()).toContain('composition_rate_needed');
		await enter(fixture, el(fixture, '#gst_rate'), '1');
		expect(page.draft()?.compositionRatePercent).toBe(1);
		await enter(fixture, el(fixture, '#gst_rate'), '');
		expect(page.draft()?.compositionRatePercent).toBeNull();
		expect(page.problems()).toContain('composition_rate_needed');
		await enter(fixture, el(fixture, '#gst_kind'), 'isd');
		expect(el(fixture, '#gst_rate')).toBeNull();
		expect(el<HTMLSelectElement>(fixture, '#gst_scheme')?.disabled).toBe(true);
		await enter(fixture, el(fixture, '#gst_turnover'), 'lots');
		expect(page.draft()?.lastYearTurnoverINR).toBe(0);
		await enter(fixture, el(fixture, '#gst_from_date'), '2026-12-01');
		await enter(fixture, el(fixture, '#gst_legal'), 'K.R. Marketing');
		el<HTMLButtonElement>(fixture, '#gst_save')?.click();
		await settle(fixture);
		expect(calls.addRegistration).toHaveBeenCalledWith(
			expect.objectContaining({
				legalName: 'K.R. Marketing',
				terms: expect.objectContaining({
					from: '2026-12-01',
					kind: 'isd',
					scheme: 'monthly',
					compositionRatePercent: null,
				}),
			}),
		);
	});

	it('keeps the form open and says so when the save fails, and Cancel closes it', async () => {
		const { fixture, page, notifier } = await opened({
			gateway: { saveRegistration: vi.fn(() => throwError(() => new Error('down'))) },
		});
		page.edit(IN_FORCE);
		await settle(fixture);
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('gst_registration_save_failed');
		expect(page.draft()?.id).toBe('reg_1');
		expect(page.saving()).toBe(false);
		await settle(fixture);
		(
			[...(el(fixture, '#gst_form')?.querySelectorAll('button') ?? [])].find((b) =>
				b.textContent?.includes('cancel'),
			) as HTMLButtonElement
		).click();
		expect(page.draft()).toBeNull();
	});
});
