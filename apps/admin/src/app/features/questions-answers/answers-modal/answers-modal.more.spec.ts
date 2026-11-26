import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from '@data-access/services/notification.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';

import { AnswersModal } from './answers-modal';

describe('the answer popup edges', () => {
	it('sends nothing for a cleared answer, and leaves other popups alone when it never opened', () => {
		const dismissAll = vi.fn();
		const answer = vi.fn();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbModal, useValue: { open: vi.fn(), dismissAll } },
				{ provide: QuestionsAnswersService, useValue: { answer } },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(AnswersModal, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(AnswersModal);
		const popup = fixture.componentInstance;
		popup.answers.setValue(null);
		popup.submit();
		expect(answer).not.toHaveBeenCalled();
		fixture.destroy();
		expect(dismissAll).not.toHaveBeenCalled();
	});
});
