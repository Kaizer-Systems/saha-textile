import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { RefundModal } from './refund-modal';

const render = (platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { translate: (key: string) => `t:${key}` } },
		],
	});
	TestBed.overrideComponent(RefundModal, { set: { imports: [], template: '' } });
	return { modal: TestBed.createComponent(RefundModal).componentInstance, open, dismissAll };
};

describe('RefundModal', () => {
	it('translates the options', () => {
		expect(render().modal.option[0]).toEqual({ label: 't:wallet', value: 'wallet' });
	});

	it('opens nothing on the server', async () => {
		const { modal, open } = render('server');
		await modal.openModal({ id: 1 } as never);
		expect(modal.isBrowser).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	it('opens for a product', async () => {
		const { modal, open } = render();
		await modal.openModal({ id: 1 } as never);
		expect(open).toHaveBeenCalledOnce();
		expect(modal.form.value.product_id).toBe(1);
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render('browser', Promise.reject(reason));
		await modal.openModal({ id: 1 } as never);
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});

	it('holds an incomplete request', () => {
		const { modal, dismissAll } = render();
		modal.sendRequest();
		expect(dismissAll).not.toHaveBeenCalled();
	});

	it('closes a complete request', () => {
		const { modal, dismissAll } = render();
		modal.form.patchValue({ reason: 'Torn', payment_type: 'wallet' });
		modal.sendRequest();
		expect(dismissAll).toHaveBeenCalledOnce();
		expect(modal.form.value.reason).toBeNull();
	});
});
