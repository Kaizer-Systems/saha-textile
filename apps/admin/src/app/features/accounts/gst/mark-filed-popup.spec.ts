import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker } from '@features/media/file-manager/fm-picker';

import { MarkFiledPopup, type MarkFiledStart } from './mark-filed-popup';

/** G8 Mark filed and lock, the pop-up every return page opens. */

const ABOUT: MarkFiledStart = {
	gstRegistrationId: 'r1',
	gstin: '19ABCDE1234F1Z5',
	returnType: 'GSTR-3B',
	month: '2026-10',
	monthName: 'October 2026',
};

function mount(markFiled: ReturnType<typeof vi.fn> = vi.fn(() => of({}))) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const active = { close: vi.fn(), dismiss: vi.fn() };
	const queries = new QueryClient();
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const pickers: { content: unknown; componentInstance: { start: ReturnType<typeof vi.fn> } }[] = [];
	let picked: Promise<unknown> = Promise.resolve(null);
	TestBed.configureTestingModule({
		imports: [
			MarkFiledPopup,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			{ provide: LedgerGateway, useValue: { markFiled } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbActiveModal, useValue: active },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown) => {
						const ref = { content, componentInstance: { start: vi.fn() }, result: picked };
						pickers.push(ref);
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(MarkFiledPopup);
	fixture.detectChanges();
	return {
		fixture,
		popup: fixture.componentInstance,
		notifier,
		active,
		invalidate,
		pickers,
		markFiled,
		pickWith: (value: Promise<unknown>): void => {
			picked = value;
		},
	};
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const type = (control: HTMLElement | null, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

describe('the Mark filed pop-up (G8)', () => {
	it('shows nothing and saves nothing until it is told which return it files', async () => {
		const { fixture, popup, markFiled } = mount();
		expect(el(fixture, '#gst_arn')).toBeNull();
		expect(popup.lockBody()).toBe('accounts_gst_change_lock_body');
		await popup.save();
		expect(markFiled).not.toHaveBeenCalled();
	});

	it('says what filing locks: sales for GSTR-1, sales and purchases for GSTR-3B', () => {
		const { fixture, popup } = mount();
		popup.start({ ...ABOUT, returnType: 'GSTR-1' });
		expect(popup.lockBody()).toBe('gstr1_change_lock_body');
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain('gstr1_change_lock_body');
		popup.start(ABOUT);
		expect(popup.lockBody()).toBe('accounts_gst_change_lock_body');
		fixture.detectChanges();
		expect(el(fixture, '.modal-title')?.textContent).toContain('gst_mark_filed_title');
		expect(fixture.nativeElement.textContent).toContain('accounts_gst_change_lock_body');
	});

	it('attaches the portal’s acknowledgement, removes it, and keeps none when the picker is closed or empty', async () => {
		const harness = mount();
		const { fixture, popup, pickers } = harness;
		popup.start(ABOUT);
		fixture.detectChanges();
		harness.pickWith(Promise.resolve([{ assetId: 'a1', versionId: null, name: 'ack.pdf', thumbnailUrl: null }]));
		(el(fixture, '#gst_ack') as HTMLAnchorElement).click();
		await vi.waitFor(() => expect(popup.acknowledgement()).toEqual({ assetId: 'a1', name: 'ack.pdf' }));
		expect(pickers[0]?.content).toBe(FmPicker);
		expect(pickers[0]?.componentInstance.start).toHaveBeenCalledWith({
			title: 'accounts_ack_file',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain('ack.pdf');
		expect(el(fixture, '#gst_ack')).toBeNull();
		(el(fixture, 'a[title="accounts_remove_attachment"]') as HTMLAnchorElement).click();
		expect(popup.acknowledgement()).toBeNull();
		fixture.detectChanges();
		expect(el(fixture, '#gst_ack')).not.toBeNull();

		const closed = Promise.reject(new Error('closed'));
		void closed.catch(() => undefined);
		harness.pickWith(closed);
		await popup.attachAck();
		harness.pickWith(Promise.resolve([]));
		await popup.attachAck();
		expect(popup.acknowledgement()).toBeNull();
	});

	it('files the return once an ARN of ten characters or more is typed, refreshes the books and closes', async () => {
		const { fixture, popup, markFiled, invalidate, notifier, active } = mount();
		popup.start(ABOUT);
		popup.acknowledgement.set({ assetId: 'a1', name: 'ack.pdf' });
		fixture.detectChanges();
		await fixture.whenStable();
		expect((el(fixture, '#gst_filed_on') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const confirm = el(fixture, '#gst_file_confirm') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		type(el(fixture, '#gst_arn'), '  AA1911260  ');
		fixture.detectChanges();
		expect(confirm.disabled).toBe(true);
		type(el(fixture, '#gst_arn'), 'AA191126054321Z');
		type(el(fixture, '#gst_filed_on'), '2026-11-20');
		fixture.detectChanges();
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await vi.waitFor(() => expect(active.close).toHaveBeenCalledWith(true));
		expect(markFiled).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'GSTR-3B',
			month: '2026-10',
			arn: 'AA191126054321Z',
			filedOn: '2026-11-20',
			acknowledgement: { assetId: 'a1', name: 'ack.pdf' },
		});
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'periods'] });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('accounts_gst_filed_saved');
		expect(popup.busy()).toBe(false);
	});

	it('stays open with the reason when filing is refused, and closes on its close button', async () => {
		const { fixture, popup, notifier, active } = mount(
			vi.fn(() => throwError(() => ({ error: { message: 'arn_shape' } }))),
		);
		popup.start(ABOUT);
		popup.arn.set('AA191126054321Z');
		await popup.save();
		expect(notifier.showError).toHaveBeenCalledWith('gst_problem_arn_shape');
		expect(active.close).not.toHaveBeenCalled();
		expect(popup.busy()).toBe(false);
		fixture.detectChanges();
		(el(fixture, '.btn-close') as HTMLButtonElement).click();
		expect(active.dismiss).toHaveBeenCalled();
	});
});
