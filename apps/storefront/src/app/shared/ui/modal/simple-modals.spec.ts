import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';

import { ConfirmationModal } from './confirmation-modal/confirmation-modal';
import { DeleteModal } from './delete-modal/delete-modal';
import { PayModal } from './pay-modal/pay-modal';

const reasons: [unknown, string][] = [
	[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
	[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
	['cross', 'Dismissed with: cross'],
];

const render = <T>(type: new () => T, platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: SettingStore, useValue: { setting: signal(null) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	return { fixture, modal: fixture.componentInstance, open, dismissAll };
};
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe('ConfirmationModal', () => {
	it('opens nothing on the server', async () => {
		const { modal, open } = render(ConfirmationModal, 'server');
		await modal.openModal();
		expect(open).not.toHaveBeenCalled();
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(ConfirmationModal, 'browser', Promise.reject(reason));
		await modal.openModal();
		await settle();
		expect(modal.closeResult).toBe(text);
	});

	it('confirms and closes', async () => {
		const { modal, open, dismissAll } = render(ConfirmationModal);
		const seen: boolean[] = [];
		modal.confirmed.subscribe((value) => seen.push(value));
		await modal.openModal();
		expect(open).toHaveBeenCalledOnce();
		modal.confirm();
		expect(seen).toEqual([true]);
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it('closes an open dialog when destroyed, and leaves others alone', async () => {
		const closed = render(ConfirmationModal);
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const open = render(ConfirmationModal);
		await open.modal.openModal();
		open.fixture.destroy();
		expect(open.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('DeleteModal', () => {
	it('opens nothing on the server', async () => {
		const { modal, open } = render(DeleteModal, 'server');
		await modal.openModal('delete', { id: 1 });
		expect(open).not.toHaveBeenCalled();
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(DeleteModal, 'browser', Promise.reject(reason));
		await modal.openModal('delete', { id: 1 });
		await settle();
		expect(modal.closeResult).toBe(text);
	});

	it('hands back what was opened for deletion', async () => {
		const { modal } = render(DeleteModal);
		const seen: unknown[] = [];
		modal.deleteItem.subscribe((value) => seen.push(value));
		await modal.openModal('delete', { id: 1 });
		modal.delete();
		expect(seen).toEqual([{ actionToPerform: 'delete', data: { id: 1 } }]);
	});

	it('closes an open dialog when destroyed, and leaves others alone', async () => {
		const closed = render(DeleteModal);
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const open = render(DeleteModal);
		await open.modal.openModal('delete', {});
		open.fixture.destroy();
		expect(open.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('PayModal', () => {
	const order = { order_number: 1 } as never;

	it('opens nothing on the server', async () => {
		const { modal, open } = render(PayModal, 'server');
		await modal.openModal(order);
		expect(open).not.toHaveBeenCalled();
	});

	it('opens for an order', async () => {
		const { modal, open } = render(PayModal);
		await modal.openModal(order);
		expect(open).toHaveBeenCalledOnce();
		expect(modal.order).toBe(order);
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(PayModal, 'browser', Promise.reject(reason));
		await modal.openModal(order);
		await settle();
		expect(modal.closeResult).toBe(text);
	});

	it('waits for a payment type', () => {
		const { modal, dismissAll } = render(PayModal);
		modal.submit();
		expect(dismissAll).not.toHaveBeenCalled();
		modal.paymentType.setValue('paypal');
		modal.submit();
		expect(dismissAll).toHaveBeenCalledOnce();
	});
});
