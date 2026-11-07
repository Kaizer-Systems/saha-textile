import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { QuestionModal } from './question-modal';

const render = (email = '', platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const ask = vi.fn(() => of({}));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: QuestionsAnswersService, useValue: { ask } },
			{ provide: AuthStore, useValue: { email: signal(email) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(QuestionModal, { set: { imports: [], template: '' } });
	return { modal: TestBed.createComponent(QuestionModal).componentInstance, open, dismissAll, ask };
};
const product = { slug: 'red-saree' } as never;

describe('QuestionModal.openModal', () => {
	it('opens nothing on the server', async () => {
		const { modal, open } = render('', 'server');
		await modal.openModal(product);
		expect(open).not.toHaveBeenCalled();
	});

	it('prefills from the signed-in address', async () => {
		const { modal, open } = render('asha@b.co');
		await modal.openModal(product);
		expect(open).toHaveBeenCalledOnce();
		expect(modal.askerName.value).toBe('asha');
		expect(modal.askerEmail.value).toBe('asha@b.co');
		expect(modal.type).toBe('crate');
	});

	it('leaves the fields empty for a guest', async () => {
		const { modal } = render();
		await modal.openModal(product);
		expect(modal.askerName.value).toBe('');
	});

	it('loads an existing question for editing', async () => {
		const { modal } = render();
		await modal.openModal(product, { id: 4, question: 'Is it silk?' } as never);
		expect(modal.type).toBe('edit');
		expect(modal.id).toBe(4);
		expect(modal.question.value).toBe('Is it silk?');
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render('', 'browser', Promise.reject(reason));
		await modal.openModal(product);
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});
});

describe('QuestionModal.submit', () => {
	const filled = () => {
		const parts = render();
		parts.modal.product = product;
		parts.modal.question.setValue('  Is it silk?  ');
		parts.modal.askerName.setValue(' Asha ');
		parts.modal.askerEmail.setValue(' a@b.co ');
		return parts;
	};

	it('sends the trimmed question and closes', () => {
		const { modal, ask, dismissAll } = filled();
		modal.stayAnonymous.setValue(true);
		modal.submit();
		expect(ask).toHaveBeenCalledWith({
			productSlug: 'red-saree',
			question: 'Is it silk?',
			askerName: 'Asha',
			askerEmail: 'a@b.co',
			isAnonymous: true,
		});
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it.each(['question', 'askerName', 'askerEmail'] as const)('needs %s', (field) => {
		const { modal, ask } = filled();
		modal[field].setValue(null);
		modal.submit();
		expect(ask).not.toHaveBeenCalled();
	});

	it('needs a product', () => {
		const { modal, ask } = filled();
		modal.product = undefined as never;
		modal.submit();
		modal.product = {} as never;
		modal.submit();
		expect(ask).not.toHaveBeenCalled();
	});
});
