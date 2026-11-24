import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { RuleSetBuilderPage } from './rule-set-builder';

import type { TaxRuleEntry } from '@saha-textile/contracts';

/** Settings › Accounts templates › a tax rule set (AT5). */

const entry = (key: string, over: Partial<TaxRuleEntry> = {}): TaxRuleEntry => ({
	key,
	name: key,
	code: '998212',
	ratePercent: 18,
	expenseRole: 'legal_fees',
	kinds: null,
	from: '2017-07-01',
	to: null,
	source: '13/2017',
	caReview: 'pending',
	...over,
});
const rules = { kind: 'taxRules', entries: [entry('advocate_fees'), entry('sponsorship', { kinds: ['llp'] })] };
const rcm = {
	code: 'RS-RCM',
	name: 'Reverse-charge list',
	kind: 'taxRules',
	versions: [{ version: 1, validFrom: '2017-07-01', content: rules }],
	draft: null,
	updatedAt: 'u1',
};

function setup(options: { template?: unknown; code?: string | null; fail?: unknown; permissions?: string[] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const result = () => (options.fail ? throwError(() => options.fail) : of({}));
	const gateway = {
		get: vi.fn(() => of(options.template ?? rcm)),
		changes: vi.fn(() => of({ added: ['Security'], removed: [], renamed: [], changed: ['Advocate'] })),
		saveDraft: vi.fn(result),
		publish: vi.fn(result),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			RuleSetBuilderPage,
			TranslocoTestingModule.forRoot({
				langs: {
					en: { rs_new_entry: 'New entry', rs_all: 'All', co_kind_llp: 'LLP', co_kind_partnership: 'Firm' },
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(options.code === null ? {} : { code: options.code ?? 'RS-RCM' })),
				},
			},
			{ provide: AccountsTemplatesGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts_template.edit']) },
			},
		],
	});
	const fixture = TestBed.createComponent(RuleSetBuilderPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
	const ready = setup(options);
	ready.fixture.detectChanges();
	await vi.waitFor(() => expect(ready.page.template.data()).toBeTruthy());
	ready.fixture.detectChanges();
	return ready;
}

describe('the rule set builder (AT5)', () => {
	it('opens the newest version as the drawn table, with what each entry applies to', async () => {
		const { page, fixture } = await loaded();
		expect(page.content()).toEqual(rules);
		expect([page.latest(), page.nextVersion()]).toEqual([1, 2]);
		expect(page.appliesTo(entry('a'))).toBe('All');
		expect(page.appliesTo(entry('b', { kinds: ['llp', 'partnership'] }))).toBe('LLP, Firm');
		expect([page.isNew('advocate_fees'), page.isNew('security')]).toEqual([false, true]);
		page.comparing.set(true);
		await vi.waitFor(() => expect(page.changes.data()).toBeTruthy());
		page.selected.set('advocate_fees');
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain('Security');
	});

	it('opens a draft, and nothing to edit for a chart or a set never published', async () => {
		const draft = {
			content: { kind: 'taxRules', entries: [] },
			validFrom: '2027-04-01',
			source: 'Notif.',
			notes: 'n',
		};
		const drafted = await loaded({ template: { ...rcm, draft } });
		expect(drafted.page.content()?.entries).toEqual([]);
		expect([drafted.page.validFrom(), drafted.page.source(), drafted.page.notes()]).toEqual([
			'2027-04-01',
			'Notif.',
			'n',
		]);
		const chart = await loaded({
			template: { ...rcm, versions: [{ version: 1, content: { kind: 'chart', groups: [], ledgers: [] } }] },
		});
		expect(chart.page.content()).toBeNull();
		expect(chart.page.isNew('advocate_fees')).toBe(true);
		chart.page.addEntry();
		expect(chart.page.content()).toBeNull();
		await chart.page.saveDraft();
		expect(chart.gateway.saveDraft).not.toHaveBeenCalled();
		const fresh = await loaded({ template: { ...rcm, versions: [] } });
		expect([fresh.page.content(), fresh.page.latest()]).toEqual([null, 0]);
		const none = setup({ code: null });
		expect([none.page.code(), none.page.latest(), none.page.nextVersion(), none.page.entry()]).toEqual([
			'',
			0,
			1,
			undefined,
		]);
		expect(none.page.isNew('advocate_fees')).toBe(true);
		await none.page.saveDraft();
		await none.page.publish();
		expect(none.gateway.publish).not.toHaveBeenCalled();
	});

	it('adds, edits and removes entries: key, role, the kinds it applies to', async () => {
		const { page, fixture } = await loaded();
		page.addEntry();
		expect(page.entry()).toMatchObject({ key: 'new_entry', name: 'New entry', kinds: null, caReview: 'pending' });
		page.patch('new_entry', { key: 'security', name: 'Security services', code: '998525', ratePercent: 18 });
		expect(page.selected()).toBe('security');
		page.role('security', ' security_services ');
		expect(page.entry()?.expenseRole).toBe('security_services');
		page.role('security', 'Not A Role');
		expect(page.entry()?.expenseRole).toBeNull();
		page.allKinds('security', false);
		expect(page.entry()?.kinds).toEqual(page.kinds);
		page.toggleKind(page.entry() as TaxRuleEntry, 'llp', false);
		expect(page.entry()?.kinds).not.toContain('llp');
		page.toggleKind(page.entry() as TaxRuleEntry, 'llp', true);
		expect(page.entry()?.kinds).toEqual(page.kinds);
		page.allKinds('security', true);
		page.toggleKind(page.entry() as TaxRuleEntry, 'partnership', true);
		expect(page.entry()?.kinds).toEqual(['partnership']);
		page.patch('security', { caReview: 'reviewed', to: '2030-03-31' });
		fixture.detectChanges();
		page.remove('security');
		expect(page.selected()).toBeNull();
		expect(page.content()?.entries.map((row) => row.key)).toEqual(['advocate_fees', 'sponsorship']);
		expect(page.dirty()).toBe(true);
		fixture.detectChanges();
	});

	it('saves the draft, publishes the next version, and lists every problem in words', async () => {
		const { page, gateway, notifier } = await loaded();
		page.validFrom.set('2027-04-01');
		await page.saveDraft();
		expect(gateway.saveDraft).toHaveBeenCalledWith('RS-RCM', {
			content: rules,
			validFrom: '2027-04-01',
			source: '',
			notes: '',
			expectedUpdatedAt: 'u1',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('tb_saved');
		page.dirty.set(true);
		await page.publish();
		expect(gateway.publish).not.toHaveBeenCalled();
		page.dirty.set(false);
		await page.publish();
		expect(gateway.publish).toHaveBeenCalledWith('RS-RCM', 'u1');
		const issues = [
			{ code: 'x', message: 'template_entry_dates:b' },
			{ code: 'x', message: 'template_role_missing:yacht_hire:llp' },
		];
		const refused = await loaded({ fail: { error: { error: { issues } } } });
		await refused.page.publish();
		expect(refused.page.problems()).toEqual([
			'at_problem_template_entry_dates',
			'at_problem_template_role_missing',
		]);
		const lost = await loaded({ fail: new Error('offline') });
		await lost.page.saveDraft();
		expect(lost.page.problems()).toEqual(['at_action_failed']);
		expect(lost.page.busy()).toBe(false);
		const readOnly = await loaded({ permissions: [] });
		expect(readOnly.page.canEdit()).toBe(false);
	});
});
