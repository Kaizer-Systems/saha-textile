import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { AuthStore } from '@core/state/auth.store';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { Button } from '../../button/button';

@Component({
	selector: 'app-question-modal',
	templateUrl: './question-modal.html',
	styleUrls: ['./question-modal.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Button, ReactiveFormsModule, FormsModule, TranslocoModule, CurrencySymbolPipe],
})
export class QuestionModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private questionsApi = inject(QuestionsAnswersService);
	private authStore = inject(AuthStore);
	private toastr = inject(ToastrService);
	private transloco = inject(TranslocoService);

	readonly QuestionModal = viewChild<TemplateRef<string>>('questionModal');

	public closeResult: string;
	public modalOpen: boolean = false;

	public product: IProduct;
	public question = new FormControl();
	public askerName = new FormControl('');
	public askerEmail = new FormControl('');
	public stayAnonymous = new FormControl(false);
	async openModal(product: IProduct) {
		if (isPlatformBrowser(this.platformId)) {
			this.product = product;
			this.askerName.patchValue(this.authStore.email() ? this.authStore.email().split('@')[0] : '');
			this.askerEmail.patchValue(this.authStore.email());
			this.modalOpen = true;
			this.modalService
				.open(this.QuestionModal(), {
					ariaLabelledBy: 'profile-Modal',
					centered: true,
					windowClass: 'theme-modal',
				})
				.result.then(
					(result) => {
						`Result ${result}`;
					},
					(reason) => {
						this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
					},
				);
		}
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
		const question = String(this.question.value ?? '').trim();
		const askerName = String(this.askerName.value ?? '').trim();
		const askerEmail = String(this.askerEmail.value ?? '').trim();
		if (!question || !askerName || !askerEmail || !this.product?.slug) return;
		this.questionsApi
			.ask({
				productSlug: this.product.slug,
				question,
				askerName,
				askerEmail,
				isAnonymous: this.stayAnonymous.value === true,
			})
			.subscribe(() => {
				this.modalService.dismissAll();
				this.question.reset('');
				// The theme toast; the question shows on the page once the shop answers it.
				this.toastr.success(this.transloco.translate('question_sent'));
			});
	}
}
