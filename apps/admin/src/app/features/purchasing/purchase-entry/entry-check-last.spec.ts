import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EntryCheck } from './entry-check';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const line = (lineId: string, over: Record<string, unknown> = {}) => ({
	lineId,
	variantId: `v_${lineId}`,
	sku: `ST-${lineId}`,
	supplierItemCode: null,
	soldBy: 'piece',
	quantity: 4,
	accepted: null,
	damaged: 0,
	missing: 0,
	damageReason: null,
	damageNote: null,
	damagePhotoAssetIds: [],
	...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
	id: 'pe_1',
	number: null,
	status: 'draft',
	version: 2,
	lines: [line('a'), line('b', { supplierItemCode: 'K-118', soldBy: 'metre', quantity: 25 })],
	...over,
});

interface Options {
	id?: string | null;
	permissions?: string[];
	results?: unknown[];
	gateway?: Record<string, unknown>;
}

function check(options: Options = {}) {
	const results = [...(options.results ?? [])];
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const next = results.shift();
			const result = next ? Promise.resolve(next) : Promise.reject(new Error('closed'));
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	const gateway = {
		entry: vi.fn(() => of(entry())),
		checkGoods: vi.fn(() => of(entry({ status: 'checked', version: 3 }))),
		postPreview: vi.fn(() => of({ warnings: [] })),
		...options.gateway,
	};
	const router = { navigate: vi.fn() };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { paramMap: convertToParamMap(options.id === null ? {} : { id: options.id ?? 'pe_1' }) },
				},
			},
			{ provide: Router, useValue: router },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) },
			},
			{ provide: QueryClient, useValue: queries },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['purchase.post']) } },
		],
	});
	TestBed.overrideComponent(EntryCheck, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(EntryCheck).componentInstance;
	return { page, gateway, modals, instance, router, notifier, queries };
}
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('Check goods (p08): the last cases', () => {
	it('opens nothing without an id, a posted entry on its page, and says why one cannot be read', async () => {
		const none = check({ id: null, permissions: [] });
		expect([none.page.entry(), none.page.canPost()]).toEqual([null, false]);
		none.page.back();
		expect(none.router.navigate).not.toHaveBeenCalled();
		const posted = check({ gateway: { entry: vi.fn(() => of(entry({ status: 'void' }))) } });
		await settle();
		expect(posted.router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_1'], { replaceUrl: true });
		const failing = check({ gateway: { entry: vi.fn(() => throwError(() => new Error('down'))) } });
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
	});

	it('counts each line up and down, gives damage a reason and a note, and goes back to the form', async () => {
		const { page, router } = check();
		await settle();
		expect(page.canPost()).toBe(true);
		page.step(0, 'damaged', 1);
		page.step(9, 'good', 1);
		page.set(1, 'missing', '5');
		page.setReason(0, 'other');
		expect(page.problems()[0]).toBe('count_note_for_other');
		page.setNote(0, 'Torn border');
		expect(page.problems()).toEqual([null, null]);
		expect(page.lines()[0]).toMatchObject({ good: 3, damaged: 1, reason: 'other', note: 'Torn border' });
		expect(page.words(page.totals().intoStock)).toEqual(expect.any(String));
		page.back();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_1', 'edit']);
	});

	it('adds damage photos, six at most, and nothing when the picker is closed', async () => {
		const many = Array.from({ length: 7 }, (_, i) => ({ assetId: `med_${i}`, name: `p${i}.jpg` }));
		const { page, instance } = check({ results: [undefined, [], many] });
		await settle();
		await page.addPhotos(9);
		await page.addPhotos(0);
		await page.addPhotos(0);
		await page.addPhotos(0);
		expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ already: 0, max: 6 }));
		expect(page.lines()[0]?.photos).toHaveLength(6);
		expect(page.lines()[1]?.photos).toEqual([]);
	});

	it('a scan jumps to its line by SKU or the supplier’s code, and says when the code is not on this bill', async () => {
		const target = document.createElement('div');
		target.id = 'count-b';
		target.scrollIntoView = vi.fn();
		document.body.appendChild(target);
		const { page, notifier } = check({ results: [undefined, 'k-118', 'NOPE', 'st-a'] });
		await settle();
		await page.scan();
		expect(page.highlighted()).toBeNull();
		await page.scan();
		expect(page.highlighted()).toBe('b');
		expect(target.scrollIntoView).toHaveBeenCalled();
		await page.scan();
		expect(notifier.showError).toHaveBeenCalledWith('scan_not_on_this_bill:{"code":"NOPE"}');
		await page.scan();
		expect(page.highlighted()).toBe('a');
		target.remove();
	});

	it('Save only: waits while busy, refuses an unfinished count, and leaves for the entry once saved', async () => {
		const { page, router, notifier, gateway, queries } = check();
		await page.saveOnly();
		expect(gateway.checkGoods).not.toHaveBeenCalled();
		await settle();
		page.busy.set(true);
		await page.saveOnly();
		page.busy.set(false);
		page.setReason(0, 'other');
		page.step(0, 'damaged', 1);
		await page.saveOnly();
		expect(gateway.checkGoods).not.toHaveBeenCalled();
		page.setNote(0, 'Torn');
		await page.saveOnly();
		expect(gateway.checkGoods).toHaveBeenCalledWith('pe_1', expect.objectContaining({ version: 2 }));
		expect(queries.invalidateQueries).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('count_saved_waiting_to_post');
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_1']);
	});

	it('a refused count marks its lines, and is told aloud when it names none or another admin saved first', async () => {
		const lineIssue = { error: { issues: [{ code: 'x', message: 'Too many', path: ['lines', 'a'] }] } };
		const plain = { error: { issues: [{ code: 'x', message: 'Not now' }] } };
		const stale = { status: 409, error: { issues: [{ code: 'x', message: 'Changed', path: ['lines', 'a'] }] } };
		const checkGoods = vi
			.fn()
			.mockReturnValueOnce(throwError(() => lineIssue))
			.mockReturnValueOnce(throwError(() => plain))
			.mockReturnValueOnce(throwError(() => stale));
		const { page, notifier } = check({ gateway: { checkGoods } });
		await settle();
		await page.saveOnly();
		expect(page.lineErrors()).toEqual({ a: 'Too many' });
		expect(notifier.showError).not.toHaveBeenCalled();
		await page.saveOnly();
		expect(page.lineErrors()).toEqual({ _: 'Not now' });
		await page.saveOnly();
		expect(notifier.showError.mock.calls).toEqual([['Not now'], ['Changed']]);
	});

	it('Post: saves, shows what changes, and posts; a closed confirmation or a failed preview posts nothing', async () => {
		const posted = entry({
			status: 'posted',
			number: 'PE/26-27/00031',
			lines: [line('a', { accepted: 4 }), line('b', { accepted: null, soldBy: 'metre' })],
		});
		const { page, notifier, router, queries, gateway, instance } = check({ results: [undefined, posted] });
		await settle();
		await page.post();
		expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ status: 'checked' }), { warnings: [] });
		expect(router.navigate).not.toHaveBeenCalled();
		await page.post();
		expect(queries.invalidateQueries).toHaveBeenCalledTimes(5);
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('PE/26-27/00031'));
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_1']);
		gateway.postPreview.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.post();
		expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		page.busy.set(true);
		await page.post();
		expect(gateway.checkGoods).toHaveBeenCalledTimes(3);
	});

	it('Post with an unfinished count stops before the preview; a posted entry with no number still says so', async () => {
		const { page, gateway, notifier } = check({
			results: [entry({ status: 'posted', number: null, lines: [line('a', { accepted: 0 })] })],
		});
		await settle();
		page.setReason(0, 'other');
		page.step(0, 'damaged', 1);
		await page.post();
		expect(gateway.postPreview).not.toHaveBeenCalled();
		page.setNote(0, 'Torn');
		await page.post();
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('"number":""'));
	});
});
