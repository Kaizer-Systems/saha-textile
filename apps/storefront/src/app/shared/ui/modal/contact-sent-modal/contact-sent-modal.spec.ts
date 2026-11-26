import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ContactSentModal } from './contact-sent-modal';

describe('ContactSentModal', () => {
	it('closes from its cross', () => {
		const active = { dismiss: vi.fn() };
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: active }] });
		TestBed.overrideComponent(ContactSentModal, { set: { imports: [], template: '' } });
		const modal = TestBed.createComponent(ContactSentModal).componentInstance;
		modal.modal.dismiss('Cross click');
		expect(active.dismiss).toHaveBeenCalledWith('Cross click');
	});
});
