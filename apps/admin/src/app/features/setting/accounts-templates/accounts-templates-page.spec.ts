import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AccountsTemplatesPage, templateWords } from './accounts-templates-page';

/** Settings › Accounts templates (AT2). */

const row = (patch: Record<string, unknown>) => ({
	code: 'CH-COMMON',
	name: 'Shared chart',
	kind: 'chart',
	appliesTo: { all: true, kinds: [] },
	latestVersion: 2,
	validFrom: '2026-04-01',
	caReview: 'pending',
	locked: false,
	lockReason: null,
	installedVersion: 1,
	updateAvailable: true,
	...patch,
});
const rows = [
	row({}),
	row({
		code: 'CH-PROP',
		appliesTo: { all: false, kinds: ['proprietorship'] },
		latestVersion: 1,
		updateAvailable: false,
	}),
	row({
		code: 'CH-FIRM',
		appliesTo: { all: false, kinds: ['partnership', 'llp'] },
		locked: true,
		installedVersion: null,
	}),
	row({ code: 'RS-RCM', kind: 'taxRules', installedVersion: null, updateAvailable: false }),
	row({
		code: 'CH-NEW',
		appliesTo: { all: false, kinds: ['llp'] },
		latestVersion: null,
		validFrom: null,
		caReview: null,
		hasDraft: true,
		installedVersion: null,
		updateAvailable: false,
	}),
];

function setup(options: { permissions?: string[]; fail?: unknown } = {}) {
	const close = vi.fn();
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const result = (made: unknown) => (options.fail ? throwError(() => options.fail) : of(made));
	const gateway = {
		library: () => of(rows),
		create: vi.fn((write: { code: string }) => result({ code: write.code })),
		importTemplate: vi.fn((t: { code: string }) => result({ code: t.code })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			AccountsTemplatesPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { at_imported: 'Imported {{code}}', at_import_not_json: 'Not a template' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: AccountsTemplatesGateway, useValue: gateway },
			{ provide: CompanyGateway, useValue: { profile: () => of({ kind: 'proprietorship' }) } },
			{ provide: NgbModal, useValue: { open: vi.fn(() => ({ close })) } },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts_template.edit']) },
			},
		],
	});
	const fixture = TestBed.createComponent(AccountsTemplatesPage);
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	return { fixture, page: fixture.componentInstance, gateway, notifier, close, navigate };
}

describe('the accounts templates library (AT2)', () => {
	it('lists every template, filtered by kind and type, with another kind’s greyed and the state of each', async () => {
		const { fixture, page } = setup();
		expect(page.rows()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.rows()).toHaveLength(5));
		await vi.waitFor(() => expect(page.profile.data()).toBeTruthy());
		page.kind.set('llp');
		expect(page.rows().map((r) => r.code)).toEqual(['CH-COMMON', 'CH-FIRM', 'RS-RCM', 'CH-NEW']);
		page.type.set('taxRules');
		expect(page.rows().map((r) => r.code)).toEqual(['RS-RCM']);
		fixture.detectChanges();
		expect(page.appliesTo(rows[0] as never)).toContain('at_all_kinds');
		expect(page.appliesTo(rows[2] as never)).toContain('co_kind_partnership');
		expect(rows.map((r) => page.state(r as never).key)).toEqual([
			'at_state_update',
			'at_state_installed',
			'at_state_locked',
			'at_state_not_installed',
			'at_state_draft',
		]);
		expect(page.day('2026-04-01')).toBe('1 Apr 2026');
	});
});

describe('New template and Import (AT2)', () => {
	it('starts a draft from a valid code, a name and who it applies to, then opens its builder', async () => {
		const { fixture, page, gateway, close, navigate } = setup();
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.library.data()).toBeTruthy());
		page.openNew({} as never);
		expect(page.canCreate()).toBe(false);
		await page.create();
		expect(gateway.create).not.toHaveBeenCalled();
		page.patchNew({ code: 'CH-FIRM-DEED', name: 'Partners from the deed' });
		page.toggleKind('partnership', true);
		page.toggleKind('llp', true);
		page.toggleKind('llp', false);
		expect(page.fresh().appliesTo).toEqual({ all: false, kinds: ['partnership'] });
		expect(page.startOptions().map((o) => o.code)).toEqual(['CH-COMMON', 'CH-PROP', 'CH-FIRM']);
		page.toggleKind('partnership', false);
		expect(page.canCreate()).toBe(false);
		page.patchNew({ appliesTo: { all: true, kinds: [] }, startFrom: 'CH-FIRM' });
		fixture.detectChanges();
		expect(page.canCreate()).toBe(true);
		await page.create();
		expect(gateway.create).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CH-FIRM-DEED', startFrom: 'CH-FIRM' }),
		);
		expect(close).toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith(['/setting/accounts-templates', 'CH-FIRM-DEED']);
		page.creating.set(true);
		expect(page.canCreate()).toBe(false);
	});

	it('says why a new template was refused', async () => {
		const refused = {
			error: { error: { issues: [{ code: 'duplicate_template_code', message: 'duplicate_template_code' }] } },
		};
		const { page, notifier } = setup({ fail: refused });
		page.patchNew({ code: 'CH-FIRM', name: 'x' });
		await page.create();
		expect(notifier.showError).toHaveBeenCalledWith('at_problem_duplicate_template_code');
		expect(page.creating()).toBe(false);
	});

	it('imports a saved template file, and says when the file is not one', async () => {
		const file = (text: string) => ({ files: [{ text: async () => text }], value: 'C:\\fake.json' });
		const { page, gateway, notifier } = setup();
		const input = file('{"code":"CH-FIRM-KOL"}');
		await page.importFile(input);
		expect(gateway.importTemplate).toHaveBeenCalledWith({ code: 'CH-FIRM-KOL' });
		expect(notifier.showSuccess).toHaveBeenCalledWith('Imported CH-FIRM-KOL');
		expect(input.value).toBe('');
		await page.importFile(file('not json'));
		expect(notifier.showError).toHaveBeenCalledWith('Not a template');
		await page.importFile({ files: null, value: '' });
		await page.importFile({ files: [], value: '' });
		const failing = setup({ fail: new Error('offline') });
		await failing.page.importFile(file('{}'));
		expect(failing.notifier.showError).toHaveBeenCalledWith('at_action_failed');
	});

	it('shows a template with only a draft, and hides the buttons from those who can’t make templates', async () => {
		const { page } = setup({ permissions: [] });
		expect(page.canEdit()).toBe(false);
		expect(page.startOptions()).toEqual([]);
		expect(page.state(row({ latestVersion: null }) as never)).toEqual({ key: 'at_state_draft', version: 0 });
		expect(templateWords('template_role_missing:cash:llp', (k) => k)).toBe('at_problem_template_role_missing');
		expect(templateWords('Network down', (k) => k)).toBe('at_action_failed');
	});
});
