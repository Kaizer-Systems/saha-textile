import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { RuleSetBuilderPage } from './rule-set-builder';

import type { TaxRuleEntry } from '@saha-textile/contracts';

/** Settings › Accounts templates › a GST return due-date rule set (RS-DUE). */

type Due = NonNullable<TaxRuleEntry['due']>;
const due = (over: Partial<Due> = {}): Due => ({
	returnType: 'GSTR-1',
	scheme: 'monthly',
	day: 11,
	monthsAfter: 1,
	states: [],
	period: null,
	...over,
});
const rule = (key: string, when: Due | null): TaxRuleEntry => ({
	key,
	name: key,
	code: '',
	ratePercent: 0,
	expenseRole: null,
	kinds: null,
	from: '2021-01-01',
	to: null,
	source: 'CGST Rules 2017 rule 61(5)',
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
	due: when,
});
/** The core starter's shape: monthly GSTR-1, QRMP GSTR-3B for two States, the annual return and a one-off extension. */
const DUE_RULES = [
	rule('gstr1_monthly', due()),
	rule('gstr3b_qrmp_22', due({ returnType: 'GSTR-3B', scheme: 'qrmp', day: 22, states: ['19', '27'] })),
	rule('gstr9_annual', due({ returnType: 'GSTR-9', scheme: null, day: 31, monthsAfter: 9 })),
	rule('gstr3b_2026_10', due({ returnType: 'GSTR-3B', day: 25, period: '2026-10' })),
];
const dueSet = (entries: TaxRuleEntry[] = DUE_RULES) => ({
	code: 'RS-DUE',
	name: 'GST return due dates',
	kind: 'taxRules',
	versions: [{ version: 1, validFrom: '2017-07-01', content: { kind: 'taxRules', list: 'dueDates', entries } }],
	draft: null,
	updatedAt: 'u1',
});

async function open(template: unknown = dueSet(), permissions = ['accounts_template.edit']) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			RuleSetBuilderPage,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						rs_new_entry: 'New entry',
						rs_due_rule: 'day {{day}}, {{months}} month(s) after, {{states}}',
						rs_due_extension: 'day {{day}} for {{period}} only, {{states}}',
						rs_due_all_states: 'every State',
						rs_due_scheme_monthly: 'monthly',
						rs_due_scheme_qrmp: 'QRMP',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code: 'RS-DUE' })) } },
			{
				provide: AccountsTemplatesGateway,
				useValue: {
					get: vi.fn(() => of(template)),
					changes: vi.fn(() => of({ added: [], removed: [], renamed: [], changed: [] })),
				},
			},
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	const fixture = TestBed.createComponent(RuleSetBuilderPage);
	fixture.detectChanges();
	await vi.waitFor(() => expect(fixture.componentInstance.template.data()).toBeTruthy());
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

/** Draws the page and lets ngModel write its values. */
async function drawn(fixture: { detectChanges: () => void; whenStable: () => Promise<unknown> }) {
	fixture.detectChanges();
	await fixture.whenStable();
	fixture.detectChanges();
}

const field = <T extends HTMLElement>(fixture: { nativeElement: HTMLElement }, id: string) =>
	fixture.nativeElement.querySelector(`#${id}`) as T;

/** Types into a box or picks an option, as the person would. */
function enter(control: HTMLInputElement | HTMLSelectElement, value: string): void {
	control.value = value;
	control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
}

describe('a due-date rule in words', () => {
	it('words a rule for every State, for some States, and a one-off extension for a month', async () => {
		const { page } = await open();
		expect(page.list()).toBe('dueDates');
		expect(DUE_RULES.map((entry) => page.dueText(entry))).toEqual([
			'day 11, 1 month(s) after, every State',
			'day 22, 1 month(s) after, 19, 27',
			'day 31, 9 month(s) after, every State',
			'day 25 for 2026-10 only, every State',
		]);
	});

	it('keeps only two-digit State codes from what is typed', async () => {
		const { page } = await open();
		expect(page.statesOf(' 19, 27 ,x, 123,1,')).toEqual(['19', '27']);
		expect(page.statesOf('')).toEqual([]);
	});
});

describe('the due-date table', () => {
	it('shows each rule’s return, its scheme when it has one, and when it falls due, in place of code, rate and limit', async () => {
		const { fixture } = await open();
		await drawn(fixture);
		const headings = [...fixture.nativeElement.querySelectorAll('thead th')].map((th) =>
			(th as HTMLElement).textContent?.trim(),
		);
		expect(headings).toContain('rs_due_return');
		expect(headings).toContain('rs_due_when');
		expect(headings).not.toContain('rs_rate');
		expect(headings).not.toContain('rs_limit');
		expect(headings[0]).toBe('rs_what');
		const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
		expect(rows).toHaveLength(4);
		const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
		expect(cells(rows[1] as HTMLElement).slice(1, 3)).toEqual([
			'GSTR-3B · QRMP',
			'day 22, 1 month(s) after, 19, 27',
		]);
		expect(cells(rows[2] as HTMLElement)[1]).toBe('GSTR-9');
	});
});

describe('adding and changing a due-date rule', () => {
	it('starts a new rule as monthly GSTR-1 for every State, and an entry of another list with no due date', async () => {
		const { page } = await open();
		page.addEntry();
		const added = page.entry() as TaxRuleEntry;
		expect(added.name).toBe('New entry');
		expect(added.due).toEqual(due());
		expect(page.dirty()).toBe(true);

		const other = await open({
			...dueSet(),
			versions: [{ version: 1, content: { kind: 'taxRules', list: 'tds', entries: [] } }],
		});
		other.page.addEntry();
		expect(other.page.entry()?.due).toBeNull();
	});

	it('merges one changed field into the rule and keeps it selected', async () => {
		const { page } = await open();
		page.patchDue(DUE_RULES[1] as TaxRuleEntry, { day: 24, states: [] });
		expect(page.content()?.entries[1]?.due).toEqual(
			due({ returnType: 'GSTR-3B', scheme: 'qrmp', day: 24, monthsAfter: 1, states: [] }),
		);
		expect(page.selected()).toBe('gstr3b_qrmp_22');
		expect(page.dirty()).toBe(true);
	});

	it('edits each field of the selected rule in its form', async () => {
		const { fixture, page } = await open();
		page.selected.set('gstr3b_qrmp_22');
		await drawn(fixture);
		const current = () => page.entry()?.due as Due;
		expect(field<HTMLSelectElement>(fixture, 'rs_due_return').value).toBe('GSTR-3B');
		expect(field<HTMLSelectElement>(fixture, 'rs_due_scheme').value).toBe('qrmp');
		expect(field<HTMLInputElement>(fixture, 'rs_due_states').value).toBe('19, 27');
		expect(field<HTMLInputElement>(fixture, 'rs_due_period').value).toBe('');

		// Each entry is drawn before the next, as the browser does after every keystroke.
		const type = async (id: string, value: string) => {
			enter(field(fixture, id), value);
			await drawn(fixture);
		};
		await type('rs_due_return', 'GSTR-9');
		expect(current().returnType).toBe('GSTR-9');
		await type('rs_due_scheme', '');
		expect(current().scheme).toBeNull();
		await type('rs_due_scheme', 'monthly');
		expect(current().scheme).toBe('monthly');
		await type('rs_due_day', '20');
		expect(current().day).toBe(20);
		await type('rs_due_months', '3');
		expect(current().monthsAfter).toBe(3);
		await type('rs_due_states', '19, 27, 33, WB');
		expect(current().states).toEqual(['19', '27', '33']);
		await type('rs_due_period', '2026-11');
		expect(current().period).toBe('2026-11');
		await type('rs_due_period', '');
		expect(current()).toEqual(
			due({ returnType: 'GSTR-9', scheme: 'monthly', day: 20, monthsAfter: 3, states: ['19', '27', '33'] }),
		);
		// Pasted text with a word in it is cleaned to the codes kept, and the rule opens again with them.
		expect(field<HTMLInputElement>(fixture, 'rs_due_states').value).toBe('19, 27, 33');
		page.selected.set('gstr1_monthly');
		await drawn(fixture);
		expect(field<HTMLInputElement>(fixture, 'rs_due_states').value).toBe('');
		page.selected.set('gstr3b_qrmp_22');
		await drawn(fixture);
		expect(field<HTMLInputElement>(fixture, 'rs_due_states').value).toBe('19, 27, 33');
	});

	it('names the rule column and leaves an empty set’s row across all six columns', async () => {
		const { fixture, page } = await open(dueSet([]));
		await drawn(fixture);
		expect(page.nameKey()).toBe('rs_what');
		expect(fixture.nativeElement.querySelectorAll('thead th')).toHaveLength(6);
		expect(field(fixture, 'rs_name')).toBeNull();
		expect(fixture.nativeElement.querySelector('tbody td')?.getAttribute('colspan')).toBe('6');
		page.addEntry();
		await drawn(fixture);
		expect(fixture.nativeElement.querySelector('label[for="rs_name"]')?.textContent?.trim()).toBe('rs_what');
	});

	it('shows the due-date form read-only to someone who may not edit templates', async () => {
		const { fixture, page } = await open(dueSet(), []);
		page.selected.set('gstr1_monthly');
		await drawn(fixture);
		const ids = ['rs_due_return', 'rs_due_scheme', 'rs_due_day', 'rs_due_months', 'rs_due_states', 'rs_due_period'];
		expect(ids.map((id) => field<HTMLInputElement>(fixture, id).disabled)).toEqual(ids.map(() => true));
		expect(field(fixture, 'rs_add')).toBeNull();
	});
});
