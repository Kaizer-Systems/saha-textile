import { Component, TemplateRef, inject, viewChild } from '@angular/core';
import { FormControl, Validators, ReactiveFormsModule } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';

import { Button } from '@shared/ui/button/button';
import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';

@Component({
	selector: 'app-answers-modal',
	templateUrl: './answers-modal.html',
	styleUrls: ['./answers-modal.scss'],
	imports: [Button, ReactiveFormsModule, TranslateModule],
})
export class AnswersModal {
	private modalService = inject(NgbModal);

	public modalOpen: boolean = false;
	public closeResult: string;
	public qna: IQuestionAnswers;
	public answers = new FormControl('', [Validators.required]);

	readonly AnswersModal = viewChild<TemplateRef<string>>('answersModal');

	async openModal(data: IQuestionAnswers) {
		this.modalOpen = true;
		this.qna = data;
		if (data.answer) {
			this.answers.patchValue(data.answer);
		} else {
			this.answers.patchValue('');
		}
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
		if (this.answers.valid) {
			// Submitting an answer has no backend yet — just close the modal.
			this.modalService.dismissAll();
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
