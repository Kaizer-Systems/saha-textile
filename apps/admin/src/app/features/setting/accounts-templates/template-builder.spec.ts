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

import { TemplateBuilderPage, builderTree, newKey } from './template-builder';

/** Settings › Accounts templates › a chart template (AT3). */

const group = (key: string, parentKey: string | null, nature = 'equity') => ({
	key,
	name: key,
	parentKey,
	nature,
	tradingAccount: false,
	roles: [] as string[],
});
const ledger = (key: string, groupKey: string) => ({
	key,
	name: key,
	groupKey,
	handPosting: true,
	roles: [] as string[],
	ruleSetCode: null,
	source: '',
});
const chart = {
	kind: 'chart',
	groups: [group('capital_account', null), group('partners_current', 'capital_account')],
	ledgers: [ledger('capital', 'capital_account')],
};
const version = { version: 1, validFrom: '2026-04-01', content: chart };
const firm = { code: 'CH-FIRM', name: 'Partners', kind: 'chart', versions: [version], draft: null, updatedAt: 'u1' };

function setup(options: { template?: unknown; code?: string | null; fail?: unknown; permissions?: string[] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const result = () => (options.fail ? throwError(() => options.fail) : of({}));
	const gateway = {
		get: vi.fn(() => of(options.template ?? firm)),
		changes: vi.fn(() => of({ added: ['loans'], removed: [], renamed: [] })),
		library: vi.fn(() =>
			of([
				{ code: 'RS-RCM', kind: 'taxRules', name: 'Reverse charge' },
				{ code: 'CH-COMMON', kind: 'chart', name: 'Shared' },
			]),
		),
		saveDraft: vi.fn(result),
		publish: vi.fn(result),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			TemplateBuilderPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { tb_new_group: 'New group', tb_new_ledger: 'New ledger' } },
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
					paramMap: of(convertToParamMap(options.code === null ? {} : { code: options.code ?? 'CH-FIRM' })),
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
	const fixture = TestBed.createComponent(TemplateBuilderPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
	const ready = setup(options);
	ready.fixture.detectChanges();
	await vi.waitFor(() => expect(ready.page.template.data()).toBeTruthy());
	ready.fixture.detectChanges();
	return ready;
}

describe('the builder’s helpers', () => {
	it('draws the groups as a tree, a group whose parent is gone at the top', () => {
		const tree = builderTree({
			kind: 'chart',
			groups: [group('a', null), group('b', 'a'), group('c', 'gone')],
			ledgers: [ledger('l', 'b')],
		} as never);
		expect(tree.map((n) => n.group.key)).toEqual(['a', 'c']);
		expect(tree[0]?.groups[0]?.ledgers.map((l) => l.key)).toEqual(['l']);
	});

	it('makes a key from a name, unique', () => {
		expect(newKey('New group', new Set())).toBe('new_group');
		expect(newKey('New group', new Set(['new_group', 'new_group_2']))).toBe('new_group_3');
		expect(newKey('2026 reserve', new Set())).toBe('x_2026_reserve');
	});
});

describe('the chart builder (AT3)', () => {
	it('opens the newest version when there is no draft, with its changes and rule sets', async () => {
		const { page } = await loaded();
		expect(page.content()).toEqual(chart);
		expect(page.nextVersion()).toBe(2);
		expect(page.ruleSets().map((r) => r.code)).toEqual(['RS-RCM']);
		expect(page.isNew('capital')).toBe(false);
		expect(page.isNew('loans')).toBe(true);
		expect([page.group(), page.ledger()]).toEqual([undefined, undefined]);
		await vi.waitFor(() => expect(page.changes.data()).toBeTruthy());
	});

	it('opens a draft where there is one, and nothing to build for a rule set', async () => {
		const draft = { content: { ...chart, ledgers: [] }, validFrom: '2027-04-01', source: 'Deed', notes: 'n' };
		const drafted = await loaded({ template: { ...firm, draft } });
		expect(drafted.page.content()?.ledgers).toEqual([]);
		expect([drafted.page.validFrom(), drafted.page.source(), drafted.page.notes()]).toEqual([
			'2027-04-01',
			'Deed',
			'n',
		]);
		const rules = await loaded({
			template: {
				...firm,
				kind: 'taxRules',
				versions: [{ version: 1, content: { kind: 'taxRules', entries: [] } }],
			},
		});
		expect(rules.page.content()).toBeNull();
		rules.page.addGroup(null);
		expect(rules.page.content()).toBeNull();
		await rules.page.saveDraft();
		expect(rules.gateway.saveDraft).not.toHaveBeenCalled();
		const fresh = await loaded({ template: { ...firm, versions: [], draft: null } });
		expect([fresh.page.content(), fresh.page.nextVersion()]).toEqual([null, 1]);
		expect([rules.page.tree(), rules.page.isNew('capital')]).toEqual([[], true]);
		const none = setup({ code: null });
		expect(none.page.code()).toBe('');
		expect([none.page.nextVersion(), none.page.tree(), none.page.ruleSets(), none.page.isNew('a')]).toEqual([
			1,
			[],
			[],
			true,
		]);
		await none.page.saveDraft();
		await none.page.publish();
		expect(none.gateway.publish).not.toHaveBeenCalled();
	});

	it('adds, renames, edits and removes groups and ledgers', async () => {
		const { page, fixture } = await loaded();
		page.addGroup(null);
		expect(page.group()).toMatchObject({ key: 'new_group', parentKey: null, nature: 'expense' });
		page.addGroup('capital_account');
		expect(page.group()).toMatchObject({ key: 'new_group_2', parentKey: 'capital_account', nature: 'equity' });
		page.addLedger('new_group_2');
		expect(page.ledger()).toMatchObject({ key: 'new_ledger', groupKey: 'new_group_2' });
		page.addGroup('new_group_2');
		page.patchGroup('new_group_2', { key: 'partners_loans', name: 'Loans from partners' });
		expect(page.content()?.ledgers.find((l) => l.key === 'new_ledger')?.groupKey).toBe('partners_loans');
		expect(page.content()?.groups.find((g) => g.key === 'new_group_3')?.parentKey).toBe('partners_loans');
		page.patchGroup('partners_loans', { nature: 'liability' });
		expect(page.selected()).toEqual({ kind: 'group', key: 'partners_loans' });
		page.patchLedger('new_ledger', { key: 'loan_partner_a', roles: page.roles('owners_loans, Bad Key, ,x') });
		expect(page.ledger()).toMatchObject({ key: 'loan_partner_a', roles: ['owners_loans'] });
		page.patchLedger('loan_partner_a', { ruleSetCode: 'RS-RCM' });
		expect(page.selected()).toEqual({ kind: 'ledger', key: 'loan_partner_a' });
		fixture.detectChanges();
		page.remove('ledger', 'loan_partner_a');
		page.remove('group', 'new_group_3');
		expect(page.selected()).toBeNull();
		expect(page.content()?.ledgers.map((l) => l.key)).toEqual(['capital']);
		expect(page.dirty()).toBe(true);
		fixture.detectChanges();
	});

	it('saves the draft, publishes the next version, and lists every problem in words', async () => {
		const { page, gateway, notifier } = await loaded();
		page.validFrom.set('2027-04-01');
		await page.saveDraft();
		expect(gateway.saveDraft).toHaveBeenCalledWith('CH-FIRM', {
			content: chart,
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
		expect(gateway.publish).toHaveBeenCalledWith('CH-FIRM', 'u1');
		const issues = [
			{ code: 'template_dates_overlap', message: 'template_dates_overlap' },
			{ code: 'x', message: 'template_role_missing:cash:llp' },
		];
		const refused = await loaded({ fail: { error: { error: { issues } } } });
		await refused.page.publish();
		expect(refused.page.problems()).toEqual([
			'at_problem_template_dates_overlap',
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
