import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MoneyLandingGateway } from '@core/accounts/money-landing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { LANDING_FIELDS, MoneyLandingCard } from './money-landing-card';

/** Accounts › Ledgers › "Where money lands" (Postings and Convert brief AP1, AP-D1). */

const landing = {
	receivedByGateway: null,
	receivedByUpi: 'led_hdfc',
	receivedByBank: 'led_hdfc',
	cashOnDelivery: null,
	paidByBank: 'led_hdfc',
	paidInCash: null,
	updatedAt: '2026-11-24T04:00:00.000Z',
	updatedBy: 'adm_1',
};

const chart = {
	groups: [
		{ id: 'g_cash', systemKey: 'cash_in_hand', parentId: null },
		{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null },
		{ id: 'g_exp', systemKey: 'indirect_expenses', parentId: null },
	],
	ledgers: [
		{ id: 'led_cash', groupId: 'g_cash', active: true, name: 'Cash' },
		{ id: 'led_hdfc', groupId: 'g_bank', active: true, name: 'HDFC current account' },
		{ id: 'led_rent', groupId: 'g_exp', active: true, name: 'Rent' },
		{ id: 'led_old', groupId: 'g_exp', active: false, name: 'Old' },
	],
};

function setup(saveFails?: unknown) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		get: vi.fn(() => of(landing)),
		save: vi.fn(() => (saveFails ? throwError(() => saveFails) : of(landing))),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [MoneyLandingCard, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: MoneyLandingGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(MoneyLandingCard);
	fixture.componentRef.setInput('chart', chart);
	fixture.componentRef.setInput('canEdit', true);
	return { fixture, card: fixture.componentInstance, gateway, notifier };
}

const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });

describe('where money lands card', () => {
	it('fills the form from the saved choices and offers banks, cash or any active ledger', async () => {
		const { fixture, card } = setup();
		expect(card.fields).toBe(LANDING_FIELDS);
		await card.save();
		card.set('paidInCash', 'led_cash');
		expect(card.form()).toBeNull();
		fixture.detectChanges();
		await vi.waitFor(() => expect(card.form()).not.toBeNull());
		expect(card.form()).not.toHaveProperty('updatedAt');
		expect(card.form()?.receivedByBank).toBe('led_hdfc');
		expect(card.options('bank').map((l) => l.id)).toEqual(['led_hdfc']);
		expect(card.options('cash').map((l) => l.id)).toEqual(['led_cash']);
		expect(card.options('any').map((l) => l.id)).toEqual(['led_cash', 'led_hdfc', 'led_rent']);
		card.set('paidInCash', 'led_cash');
		card.set('receivedByUpi', '');
		expect(card.form()?.paidInCash).toBe('led_cash');
		expect(card.form()?.receivedByUpi).toBeNull();
		fixture.componentRef.setInput('chart', undefined);
		expect(card.options('any')).toEqual([]);
	});

	it('saves, and says why a save is refused in words', async () => {
		const { fixture, card, gateway, notifier } = setup();
		fixture.detectChanges();
		await vi.waitFor(() => expect(card.form()).not.toBeNull());
		await card.save();
		expect(gateway.save).toHaveBeenCalledWith(expect.objectContaining({ receivedByBank: 'led_hdfc' }));
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('ml_saved'));
		expect(card.busy()).toBe(false);

		const cases: [unknown, string][] = [
			[refused('money_landing_wrong_ledger:paidInCash'), 'ml_wrong_ledger'],
			[refused('money_landing_changed'), 'ml_changed'],
			[refused('Network down'), 'Network down'],
			[new Error('offline'), 'ord_action_failed'],
		];
		for (const [error, words] of cases) {
			const failing = setup(error);
			failing.fixture.detectChanges();
			await vi.waitFor(() => expect(failing.card.form()).not.toBeNull());
			await failing.card.save();
			expect(failing.notifier.showError).toHaveBeenCalledWith(expect.stringContaining(words));
			expect(failing.card.busy()).toBe(false);
		}
	});
});
