import { Component, TemplateRef, inject, output, viewChild } from '@angular/core';
import { FormControl, Validators, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IAdminQuestionRow } from '@data-access/interfaces/questions-answers.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-answers-modal',
	templateUrl: './answers-modal.html',
	styleUrls: ['./answers-modal.scss'],
	imports: [Button, ReactiveFormsModule, TranslocoModule],
})
export class AnswersModal {
	private modalService = inject(NgbModal);
	private api = inject(QuestionsAnswersService);
	private notifications = inject(NotificationService);
	private transloco = inject(TranslocoService);

	/** After an answer is saved, so the list can refresh. */
	readonly answered = output<void>();

	public modalOpen: boolean = false;
	public closeResult: string;
	public qna: IAdminQuestionRow;
	public answers = new FormControl('', [Validators.required]);

	readonly AnswersModal = viewChild<TemplateRef<string>>('answersModal');

	async openModal(data: IAdminQuestionRow) {
		this.modalOpen = true;
		this.qna = data;
		this.answers.reset(data.question.answer ?? '');
		this.modalService
			.open(this.AnswersModal(), {
				ariaLabelledBy: 'Payout-Modal',
				centered: true,
				windowClass: 'theme-modal text-center',
			})
			.result.then(
				(result) => {
					`Result ${result}`;
					this.closeResult = `Closed with: ${result}`;
				},
				(reason) => {
					this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
				},
			);
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	submit() {
		this.answers.markAllAsTouched();
		const answer = (this.answers.value ?? '').trim();
		if (!this.answers.valid || !answer || !this.qna) return;
		const first = this.qna.question.status !== 'answered';
		this.api.answer(this.qna.question.id, answer).subscribe(() => {
			this.modalService.dismissAll();
			this.notifications.showSuccess(this.transloco.translate(first ? 'question_answered' : 'answer_updated'));
			this.answered.emit();
		});
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
