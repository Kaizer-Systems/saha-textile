import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { CompanyGateway } from '@core/company/company.gateway';

import { AccountsTemplatesPage } from './accounts-templates-page';

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
];

function setup() {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [AccountsTemplatesPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: AccountsTemplatesGateway, useValue: { library: () => of(rows) } },
			{ provide: CompanyGateway, useValue: { profile: () => of({ kind: 'proprietorship' }) } },
		],
	});
	const fixture = TestBed.createComponent(AccountsTemplatesPage);
	return { fixture, page: fixture.componentInstance };
}

describe('the accounts templates library (AT2)', () => {
	it('lists every template, filtered by kind and type, with another kind’s greyed and the state of each', async () => {
		const { fixture, page } = setup();
		expect(page.rows()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.rows()).toHaveLength(4));
		await vi.waitFor(() => expect(page.profile.data()).toBeTruthy());
		page.kind.set('llp');
		expect(page.rows().map((r) => r.code)).toEqual(['CH-COMMON', 'CH-FIRM', 'RS-RCM']);
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
		]);
		expect(page.day('2026-04-01')).toBe('1 Apr 2026');
	});
});
