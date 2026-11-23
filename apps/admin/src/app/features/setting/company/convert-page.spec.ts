import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ConvertGateway } from '@core/accounts/convert.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ConvertPage, KINDS, lastMonthEnd } from './convert-page';

/** Settings › Company › Convert (Postings and Convert brief AC2; AC-D1, AC-D2). */

const preview = {
	from: 'proprietorship',
	to: 'partnership',
	lastDay: '2026-10-31',
	openingDate: '2026-11-01',
	rows: [
		{ from: 'led_capital', name: 'Capital', balancePaise: -1_240_000_00 },
		{ from: 'led_drawings', name: 'Drawings', balancePaise: 310_000_00 },
		{ from: 'profit', name: 'Profit up to the last day', balancePaise: -205_000_00 },
	],
	targets: [
		{ ledgerId: 'led_capital', key: null, name: 'Capital' },
		{ ledgerId: null, key: 'partner_current', name: 'Partner A: current' },
	],
	problems: [],
	months: Array.from({ length: 19 }, () => 'x'),
};
const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });

function setup(options: { preview?: unknown; previewFails?: unknown; convertFails?: unknown; sure?: boolean } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		preview: vi.fn(() =>
			options.previewFails ? throwError(() => options.previewFails) : of(options.preview ?? preview),
		),
		convert: vi.fn(() =>
			options.convertFails ? throwError(() => options.convertFails) : of({ voucherId: 'jv_1', months: 19 }),
		),
	};
	const modals = {
		open: vi.fn(() => ({ componentInstance: { start: vi.fn() }, result: Promise.resolve(options.sure ?? true) })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			ConvertPage,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						cv_failed: 'Failed',
						cv_profit_row: 'Profit so far',
						cv_problem_convert_same_kind: 'Choose another kind',
						cv_problem_convert_row_not_mapped: 'Map every row',
						accounts_problem_period_locked: 'That month is locked.',
						cv_done: '{{months}} months locked',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: ConvertGateway, useValue: gateway },
			{
				provide: CompanyGateway,
				useValue: { profile: () => of({ kind: 'proprietorship', legalName: 'K.R. Marketing' }) },
			},
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(ConvertPage);
	const router = TestBed.inject(Router);
	const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
	return { fixture, page: fixture.componentInstance, gateway, notifier, modals, navigate };
}

describe('the last day of the old books', () => {
	it('starts at the end of last month in India', () => {
		expect(lastMonthEnd(new Date('2026-11-24T10:00:00Z'))).toBe('2026-10-31');
		expect(lastMonthEnd(new Date('2027-01-05T10:00:00Z'))).toBe('2026-12-31');
		expect(lastMonthEnd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('Convert', () => {
	it('offers every other kind, and previews what converting does', async () => {
		const { fixture, page, gateway } = setup();
		expect(page.kinds()).toEqual(KINDS);
		expect(page.unmapped()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.kinds()).not.toContain('proprietorship'));
		await page.load();
		expect(gateway.preview).not.toHaveBeenCalled();
		page.kind.set('partnership');
		page.pick('led_capital', 'id:led_capital');
		await page.load();
		expect(gateway.preview).toHaveBeenCalledWith('partnership', page.lastDay());
		expect(page.choice()).toEqual({});
		fixture.detectChanges();
		expect(page.rowName(preview.rows[2] as never)).toBe('Profit so far');
		expect(page.rowName(preview.rows[0] as never)).toBe('Capital');
		expect(page.unmapped()).toHaveLength(3);
		expect(page.canConvert()).toBe(false);
	});

	it('says why a preview was refused, in words', async () => {
		for (const [error, words] of [
			[refused('convert_same_kind'), 'Choose another kind'],
			[refused('voucher_problem:period_locked'), 'That month is locked.'],
			[new Error('offline'), 'Failed'],
		] as const) {
			const { page, notifier } = setup({ previewFails: error });
			page.kind.set('llp');
			await page.load();
			expect(notifier.showError).toHaveBeenCalledWith(words);
			expect(page.preview()).toBeNull();
		}
		expect(setup().page.words('convert_row_not_mapped:led_x')).toBe('Map every row');
	});

	it('maps each row to a ledger, the new kind’s ledger or a new one, then converts after asking', async () => {
		const { fixture, page, gateway, notifier, navigate } = setup();
		page.kind.set('partnership');
		await page.load();
		page.pick('led_capital', 'key:partner_current');
		page.pick('led_drawings', 'id:led_capital');
		page.pick('profit', 'new');
		fixture.detectChanges();
		expect(page.unmapped().map((row) => row.from)).toEqual(['profit']);
		page.name('profit', ' P');
		expect(page.canConvert()).toBe(false);
		page.name('profit', ' Partner B: current ');
		fixture.detectChanges();
		expect(page.canConvert()).toBe(true);
		await page.convert();
		expect(gateway.convert).toHaveBeenCalledWith({
			kind: 'partnership',
			lastDay: '2026-10-31',
			mapping: [
				{ from: 'led_capital', to: { key: 'partner_current' } },
				{ from: 'led_drawings', to: { ledgerId: 'led_capital' } },
				{ from: 'profit', to: { newName: 'Partner B: current' } },
			],
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('19 months locked');
		expect(navigate).toHaveBeenCalledWith(['/setting/company']);
		page.busy.set(true);
		expect(page.canConvert()).toBe(false);
	});

	it('does nothing until it can, or when the person says no; says why a conversion was refused', async () => {
		const early = setup();
		await early.page.convert();
		expect(early.modals.open).not.toHaveBeenCalled();
		const blocked = setup({ preview: { ...preview, problems: ['convert_same_kind'], rows: [] } });
		blocked.page.kind.set('partnership');
		await blocked.page.load();
		blocked.fixture.detectChanges();
		expect(blocked.page.canConvert()).toBe(false);
		const declined = setup({ sure: false, preview: { ...preview, rows: [] } });
		declined.page.kind.set('partnership');
		await declined.page.load();
		declined.fixture.detectChanges();
		await declined.page.convert();
		expect(declined.gateway.convert).not.toHaveBeenCalled();
		const failing = setup({
			convertFails: refused('convert_target_unknown:led_x'),
			preview: { ...preview, rows: [] },
		});
		failing.page.kind.set('partnership');
		await failing.page.load();
		await failing.page.convert();
		expect(failing.notifier.showError).toHaveBeenCalledWith('cv_problem_convert_target_unknown');
		expect(failing.page.busy()).toBe(false);
	});
});
