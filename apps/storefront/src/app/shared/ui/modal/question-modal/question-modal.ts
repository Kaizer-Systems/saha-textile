import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';

import {
  SendQuestionAction,
  UpdateQuestionAnswersAction,
} from '@data-access/actions/questions-answers.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '../../button/button';

@Component({
  selector: 'app-question-modal',
  templateUrl: './question-modal.html',
  styleUrls: ['./question-modal.scss'],
  providers: [CurrencySymbolPipe],
  imports: [Button, ReactiveFormsModule, FormsModule, TranslateModule, CurrencySymbolPipe],
})
export class QuestionModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);

  readonly QuestionModal = viewChild<TemplateRef<string>>('questionModal');

  public closeResult: string;
  public modalOpen: boolean = false;

  public product: IProduct;
  public question = new FormControl();
  public type = 'crate';
  public id: number;

  async openModal(product: IProduct, qna?: IQuestionAnswers) {
    if (isPlatformBrowser(this.platformId)) {
      if (qna) {
        this.type = 'edit';
        this.id = qna.id;
        this.question.patchValue(qna.question);
      }
      this.product = product;
      this.modalOpen = true;
      this.modalService
        .open(this.QuestionModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal',
        })
        .result.then(
          result => {
            `Result ${result}`;
          },
          reason => {
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
    let data = {
      question: this.question.value,
      product_id: this.product.id,
      answer: '',
    };
    let action = new SendQuestionAction(data);
    if (data.question || data.product_id) {
      if (this.type == 'edit' && this.id) {
        action = new UpdateQuestionAnswersAction(data, this.id);
      }
      this.store.dispatch(action).subscribe({
        complete: () => {
          this.modalService.dismissAll();
        },
      });
    }
  }
}
