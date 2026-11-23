import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReturnsGateway } from '@core/accounts/returns.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ReturnPage } from './return-page';

import type { OrderReturn } from '@saha-textile/contracts';

const entry = (status: OrderReturn['status']) =>
	({
		id: 'ret_1',
		status,
		lines: [
			{ lineId: 'a', outcome: null, note: '' },
			{ lineId: 'b', outcome: 'damaged', note: 'torn' },
		],
		timeline: [{ status: 'asked', at: '2026-11-22T05:00:00.000Z' }],
	}) as unknown as OrderReturn;

function setup(status: OrderReturn['status'] = 'received', fail = false, id: string | null = 'ret_1') {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		getReturn: () => of(entry(status)),
		step: vi.fn(() => of(entry('received'))),
		check: vi.fn(() =>
			fail
				? throwError(() => ({ error: { error: { message: 'return_check_incomplete' } } }))
				: of(entry('checked')),
		),
		creditNoteFromReturn: vi.fn(() => (fail ? throwError(() => new Error('down')) : of({ id: 'cn_1' }))),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [ReturnPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } },
			{ provide: ReturnsGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(ReturnPage);
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	return { fixture, page: fixture.componentInstance, gateway, notifier, navigate };
}

describe('a return’s page (B3)', () => {
	it('loads the return, shows each step’s day, and lets a received one be checked', async () => {
		const { fixture, page } = setup();
		expect(page.checkable()).toBe(false);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.entry.data()).toBeTruthy());
		expect(page.checkable()).toBe(true);
		expect(page.reached(entry('asked'), 'asked')).toBe('22 Nov');
		expect(page.reached(entry('asked'), 'checked')).toBeNull();
		expect(setup('asked', false, null).page.id()).toBe('');
	});

	it('keeps each piece’s choice, defaulting to back to stock or what was saved', () => {
		const { page } = setup();
		const [a, b] = entry('received').lines;
		expect(page.choice('a', a!)).toEqual({ outcome: 'restock', note: '' });
		expect(page.choice('b', b!)).toEqual({ outcome: 'damaged', note: 'torn' });
		page.setChoice('a', a!, { outcome: 'write_off' });
		page.setChoice('a', a!, { note: 'stained' });
		expect(page.choice('a', a!)).toEqual({ outcome: 'write_off', note: 'stained' });
	});

	it('moves it on, saves the check, and makes the credit note (checking first when needed)', async () => {
		const { page, gateway, navigate, notifier } = setup();
		await page.step('received');
		expect(gateway.step).toHaveBeenCalledWith('ret_1', { to: 'received' });
		await page.saveCheck(entry('received'));
		expect(notifier.showSuccess).toHaveBeenCalled();
		await page.makeCreditNote(entry('received'));
		expect(gateway.check).toHaveBeenCalledTimes(2);
		await page.makeCreditNote(entry('checked'));
		expect(gateway.check).toHaveBeenCalledTimes(2);
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/credit-notes', 'cn_1']);
	});

	it('says why a check or a credit note was refused', async () => {
		const { page, notifier } = setup('received', true);
		await page.saveCheck(entry('received'));
		await page.makeCreditNote(entry('checked'));
		expect(notifier.showError).toHaveBeenCalledTimes(2);
	});
});
