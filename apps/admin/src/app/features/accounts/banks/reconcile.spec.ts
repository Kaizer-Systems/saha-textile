import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BanksGateway } from '@core/accounts/banks.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { LinkPopup } from './link-popup';
import { MatchingRulesPage } from './matching-rules';
import { ReconcilePage, chargeSplit, sureness } from './reconcile-page';

/** Reconciling a bank account (accounts brief BA7, BA8, BA10). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const match = (over: Record<string, unknown> = {}) => ({
	voucherIds: ['jv_upi'],
	why: 'upi_ref',
	sure: true,
	by: null,
	at: null,
	entry: null,
	gstPercent: null,
	ruleId: 'rule_upi_ref',
	...over,
});
const row = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	bankAccountId: 'bank_1',
	date: '2026-11-26',
	description: 'UPI/409912345678/SHREYA G',
	reference: '',
	outPaise: 0,
	inPaise: 150_000,
	balancePaise: null,
	key: `k_${id}`,
	importId: 'imp_1',
	status: 'suggested',
	match: match(),
	rejectedKeys: [],
	createdAt: '2026-11-28T06:00:00.000Z',
	entries: [
		{
			voucherId: 'jv_upi',
			number: 'RC/26-27/000016',
			date: '2026-11-26',
			narration: 'Payment received',
			inPaise: 150_000,
			outPaise: 0,
		},
	],
	...over,
});
const ROWS = [
	row('l_upi'),
	row('l_weave', { match: match({ voucherIds: ['jv_w'], why: 'amount_party', sure: false }) }),
	row('l_sms', {
		description: 'SMS ALERT CHG',
		inPaise: 0,
		outPaise: 5_900,
		entries: [],
		match: match({ voucherIds: [], why: 'rule:SMS ALERT', sure: false, entry: 'bank_charge', gstPercent: 18 }),
	}),
	row('l_int', {
		description: 'INT CR',
		inPaise: 41_200,
		entries: [],
		match: match({ voucherIds: [], why: 'rule:INT CR', sure: false, entry: 'interest' }),
	}),
	row('l_nadia', { status: 'unmatched', match: null, entries: [], inPaise: 0, outPaise: 1_200_000 }),
	row('l_done', { status: 'accepted', match: match({ why: 'linked' }) }),
];

function mount<T>(component: Type<T>, gateway: Record<string, unknown>, id = 'bank_1') {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const opened: { componentInstance: { start: ReturnType<typeof vi.fn> } }[] = [];
	let result: Promise<unknown> = Promise.resolve(true);
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			provideRouter([]),
			{ provide: BanksGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn(() => {
						const ref = { componentInstance: { start: vi.fn() }, result };
						opened.push(ref);
						return ref;
					}),
				},
			},
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } },
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return {
		fixture,
		page: fixture.componentInstance,
		notifier,
		navigate,
		opened,
		closeWith: (value: Promise<unknown>): void => {
			result = value;
		},
	};
}

describe('how sure a match is, and bank charges', () => {
	it('words sure, unsure, rule and not matched, and takes the GST out of a charge', () => {
		expect(ROWS.map((r) => sureness(r as never))).toEqual(['sure', 'unsure', 'rule', 'rule', 'none', 'sure']);
		expect(chargeSplit(5_900, 18)).toEqual({ taxable: 5_000, tax: 900 });
		expect(chargeSplit(100, null)).toEqual({ taxable: 100, tax: 0 });
	});
});

describe('the reconcile page (BA7)', () => {
	const gateway = (over: Record<string, unknown> = {}) => ({
		one: vi.fn(() =>
			of({ id: 'bank_1', shortName: 'HDFC · Barasat', ledgerId: 'led_bank', locationId: 'loc_bar' }),
		),
		reconcile: vi.fn(() => of({ items: ROWS, counts: { suggested: 4, unmatched: 1, accepted: 1 }, sure: 1 })),
		accept: vi.fn(() => of({})),
		reject: vi.fn(() => of({})),
		unmatch: vi.fn(() => of({})),
		acceptSure: vi.fn(() => of({ accepted: 1 })),
		...over,
	});

	it('shows each line with its match, why and how sure, and the actions each one allows', async () => {
		const { fixture, page, navigate } = mount(ReconcilePage, gateway());
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('RC/26-27/000016 · Payment received');
		expect(text).toContain('bank_new_bank_charge');
		expect(text).toContain('bank_sure_unsure');
		expect(page.amount({ inPaise: 0, outPaise: 5_900 })).toBe('−₹59.00');
		expect(page.matchText(ROWS[4] as never)).toBe('—');
		expect(page.matchText(ROWS[3] as never)).toBe('bank_new_interest');
		expect([
			page.whyText(ROWS[0] as never),
			page.whyText(ROWS[2] as never),
			page.whyText(ROWS[4] as never),
		]).toEqual(['bank_why_upi_ref', 'bank_why_rule', 'bank_why_none']);
		const titles = [...fixture.nativeElement.querySelectorAll('tbody button')].map((b) => (b as HTMLElement).title);
		expect(titles).toEqual([
			'bank_accept',
			'bank_reject',
			'bank_accept',
			'bank_relink',
			'bank_accept',
			'bank_reject',
			'bank_accept',
			'bank_reject',
			'bank_make_entry',
			'bank_link',
			'bank_unmatch',
		]);
		page.makeEntry(ROWS[4] as never);
		expect(navigate).toHaveBeenCalledWith(['/accounts/vouchers/new'], {
			queryParams: {
				bankLedger: 'led_bank',
				location: 'loc_bar',
				way: 'out',
				amount: 12_000,
				date: '2026-11-26',
				narration: 'UPI/409912345678/SHREYA G',
			},
		});
		page.makeEntry(ROWS[0] as never);
		expect(navigate.mock.lastCall?.[1]).toMatchObject({ queryParams: { way: 'in', amount: 1_500 } });
		page.setPeriod({ period: 'last_month' });
		page.tab.set('accepted');
		await settle(fixture);
		expect(page.view.data()?.counts['accepted']).toBe(1);
	});

	it('accepts, turns down, breaks a match and accepts all sure ones, saying why when refused', async () => {
		const g = gateway({
			reject: vi.fn(() => throwError(() => ({ error: { message: 'bank_line_nothing_to_reject' } }))),
			acceptSure: vi
				.fn()
				.mockReturnValueOnce(of({ accepted: 3 }))
				.mockReturnValueOnce(throwError(() => new Error('down'))),
		});
		const { fixture, page, notifier } = mount(ReconcilePage, g);
		await settle(fixture);
		expect(await page.accept(ROWS[0] as never)).toBe(true);
		expect(g.accept).toHaveBeenCalledWith('bank_1', 'l_upi', page.range());
		expect(await page.reject(ROWS[1] as never)).toBe(false);
		expect(notifier.showError).toHaveBeenCalledWith('bank_problem_bank_line_nothing_to_reject');
		expect(await page.unmatch(ROWS[5] as never)).toBe(true);
		await page.acceptSure();
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('bank_accepted_n');
		notifier.showSuccess.mockClear();
		await page.acceptSure();
		expect(notifier.showSuccess).not.toHaveBeenCalled();
	});

	it('links a line elsewhere: a suggestion is turned down first, and a line with none opens the search at once', async () => {
		const g = gateway({
			reject: vi
				.fn()
				.mockReturnValueOnce(of({}))
				.mockReturnValueOnce(throwError(() => new Error('x'))),
		});
		const harness = mount(ReconcilePage, g);
		await settle(harness.fixture);
		await harness.page.relink(ROWS[1] as never);
		expect(harness.opened[0]?.componentInstance.start).toHaveBeenCalledWith({
			bankAccountId: 'bank_1',
			line: ROWS[1],
			removed: 'RC/26-27/000016 · Payment received',
		});
		const closed = Promise.reject(new Error('closed'));
		void closed.catch(() => undefined);
		harness.closeWith(closed);
		await harness.page.relink(ROWS[4] as never);
		expect(harness.opened[1]?.componentInstance.start).toHaveBeenCalledWith(
			expect.objectContaining({ removed: null }),
		);
		await harness.page.relink(ROWS[1] as never);
		expect(harness.opened).toHaveLength(2);
	});

	it('works with no account read yet', async () => {
		const { page, navigate } = mount(ReconcilePage, gateway({ one: vi.fn(() => of(undefined)) }));
		page.makeEntry(ROWS[4] as never);
		expect(navigate.mock.lastCall?.[1]).toMatchObject({ queryParams: { bankLedger: '', location: '' } });
		const none = mount(ReconcilePage, gateway(), '');
		expect(none.page.id()).toBe('');
	});
});

describe('the link popup (BA8)', () => {
	const entries = [
		{
			voucherId: 'jv_a',
			number: 'RC/1',
			date: '2026-11-20',
			narration: 'Weave Studio',
			inPaise: 400_000,
			outPaise: 0,
		},
		{
			voucherId: 'jv_b',
			number: 'RC/2',
			date: '2026-11-21',
			narration: 'Weave Studio',
			inPaise: 200_000,
			outPaise: 0,
		},
		{ voucherId: 'jv_c', number: 'PV/1', date: '2026-11-21', narration: 'Rent', inPaise: 0, outPaise: 100 },
	];

	it('finds entries, adds up the ones picked, and links only when they come to the line', async () => {
		const link = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'bank_link_amount_differs:400000' } })))
			.mockReturnValueOnce(of({}));
		const found = vi.fn(() => of(entries));
		const { fixture, page } = mount(LinkPopup, { entries: found, link });
		await page.link();
		page.start({
			bankAccountId: 'bank_1',
			line: { id: 'l_w', date: '2026-11-27', description: 'IMPS CR WEAVE ST', inPaise: 600_000, outPaise: 0 },
			removed: 'Weave Studio · TI/26-27/000140',
		});
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('bank_link_removed');
		expect(fixture.nativeElement.textContent).toContain('−₹1.00');
		page.q.set('weave');
		await settle(fixture);
		expect(found).toHaveBeenLastCalledWith('bank_1', 'weave');
		page.toggle(entries[0] as never);
		expect([page.pickedNet(), page.ready()]).toEqual([400_000, false]);
		await page.link();
		expect(link).not.toHaveBeenCalled();
		page.toggle(entries[1] as never);
		page.toggle(entries[2] as never);
		page.toggle(entries[2] as never);
		expect(page.ready()).toBe(true);
		await page.link();
		expect(page.problem()).toEqual({
			key: 'bank_problem_bank_link_amount_differs',
			params: { amount: '₹4,000.00' },
		});
		await page.link();
		expect(link).toHaveBeenLastCalledWith('bank_1', 'l_w', ['jv_a', 'jv_b']);
		expect(TestBed.inject(NgbActiveModal).close).toHaveBeenCalledWith(true);
		expect(page.day('2026-11-27')).toBe('27 Nov 2026');
	});

	it('shows nothing found, and works with no line yet', async () => {
		const { fixture, page } = mount(LinkPopup, { entries: vi.fn(() => of([])) });
		expect(page.lineNet()).toBe(0);
		page.start({
			bankAccountId: 'bank_1',
			line: { id: 'l', date: '2026-11-27', description: 'X', inPaise: 0, outPaise: 100 },
			removed: null,
		});
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('bank_link_none');
		expect(page.lineNet()).toBe(-100);
	});
});

describe('the matching rules page (BA10)', () => {
	const rule = (over: Record<string, unknown>) => ({
		id: 'rule_x',
		order: 0,
		builtIn: true,
		when: 'gateway_ref',
		words: [],
		onlyIn: false,
		then: 'match',
		gstPercent: null,
		on: true,
		updatedAt: '2026-11-24T00:00:00.000Z',
		...over,
	});
	const RULES = [
		rule({ id: 'rule_gateway_ref' }),
		rule({ id: 'rule_upi_ref', when: 'upi_ref', then: 'suggest' }),
		rule({ id: 'rule_amount_party', when: 'amount_party', then: 'suggest' }),
		rule({
			id: 'rule_bank_charges',
			when: 'words',
			words: ['SMS ALERT', 'CHG'],
			then: 'bank_charge',
			gstPercent: 18,
		}),
		rule({ id: 'rule_interest', when: 'words', words: ['INT CR'], onlyIn: true, then: 'interest' }),
		rule({ id: 'mr_1', builtIn: false, when: 'words', words: ['CASH DEP'], then: 'leave' }),
	];

	it('lists every rule in words with its switch, and the rest left for a person', async () => {
		const saveRule = vi
			.fn()
			.mockReturnValueOnce(of({}))
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'match_rule_unknown' } })));
		const { fixture, page, notifier } = mount(MatchingRulesPage, { rules: vi.fn(() => of(RULES)), saveRule });
		await settle(fixture);
		const rules = page.rules.data() as never[];
		expect(rules.map((r) => page.whenText(r))).toEqual([
			'bank_rule_when_gateway_ref',
			'bank_rule_when_upi_ref',
			'bank_rule_when_amount_party',
			'bank_rule_when_words',
			'bank_rule_when_words_in',
			'bank_rule_when_words',
		]);
		expect(rules.map((r) => page.resultText(r))).toEqual([
			'bank_rule_result_sure',
			'bank_rule_result_unsure',
			'bank_rule_result_party',
			'bank_rule_result_rule',
			'bank_rule_result_rule',
			'bank_rule_result_none',
		]);
		expect(page.thenText(rules[3] as never)).toBe('bank_rule_then_bank_charge');
		expect(page.thenText(rules[0] as never)).toBe('bank_rule_then_match');
		expect(fixture.nativeElement.textContent).toContain('bank_rule_anything_else');
		(fixture.nativeElement.querySelector('#bank_rule_on_rule_upi_ref') as HTMLInputElement).click();
		await settle(fixture);
		expect(saveRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule_upi_ref', on: false }));
		expect(notifier.showSuccess).toHaveBeenCalledWith('bank_rule_saved');
		expect(await page.toggle(rules[0] as never)).toBe(false);
		expect(notifier.showError).toHaveBeenCalledWith('bank_problem_match_rule_unknown');
	});

	it('adds a rule of words and changes one, sending its words and its GST only for bank charges', async () => {
		const saveRule = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'match_rule_needs_words' } })))
			.mockReturnValue(of({}));
		const { fixture, page } = mount(MatchingRulesPage, { rules: vi.fn(() => of(RULES)), saveRule });
		await settle(fixture);
		await page.save();
		expect(saveRule).not.toHaveBeenCalled();
		(fixture.nativeElement.querySelector('#bank_rule_add') as HTMLButtonElement).click();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('#bank_rule_gst')).toBeTruthy();
		await page.save();
		expect(page.editing()).not.toBeNull();
		page.wordsText.set(' ATM FEE , , DC CHG ');
		page.set('gstPercent', 18);
		page.set('onlyIn', true);
		await page.save();
		expect(saveRule).toHaveBeenLastCalledWith(
			expect.objectContaining({
				id: null,
				words: ['ATM FEE', 'DC CHG'],
				then: 'bank_charge',
				gstPercent: 18,
				onlyIn: true,
			}),
		);
		expect(page.editing()).toBeNull();
		page.edit(RULES[5] as never);
		expect(page.wordsText()).toBe('CASH DEP');
		page.set('then', 'interest');
		await page.save();
		expect(saveRule).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: 'mr_1', then: 'interest', gstPercent: null }),
		);
		page.edit(RULES[3] as never);
		page.cancel();
		expect(page.editing()).toBeNull();
		page.set('then', 'leave');
		expect(page.editing()).toBeNull();
	});
});
