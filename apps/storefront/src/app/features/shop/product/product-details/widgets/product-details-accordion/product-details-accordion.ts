import { AsyncPipe } from '@angular/common';
import { Component, inject, input, SimpleChanges } from '@angular/core';

import {
  NgbAccordionBody,
  NgbAccordionButton,
  NgbAccordionCollapse,
  NgbAccordionDirective,
  NgbAccordionHeader,
  NgbAccordionItem,
  NgbAccordionToggle,
  NgbCollapse,
} from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetQuestionAnswersAction } from '@data-access/actions/questions-answers.action';
import { GetReviewAction } from '@data-access/actions/review.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQnAModel } from '@data-access/interfaces/questions-answers.interface';
import { IReviewModel } from '@data-access/interfaces/review.interface';
import { QuestionAnswersState } from '@data-access/states/questions-answers.state';
import { ReviewState } from '@data-access/states/review.state';
import { ProductReview } from '../product-review/product-review';
import { QuestionsAnswers } from '../questions-answers/questions-answers';

@Component({
  selector: 'app-product-details-accordion',
  templateUrl: './product-details-accordion.html',
  styleUrls: ['./product-details-accordion.scss'],
  imports: [
    NgbAccordionDirective,
    NgbAccordionItem,
    NgbAccordionHeader,
    NgbAccordionToggle,
    NgbAccordionButton,
    NgbCollapse,
    NgbAccordionCollapse,
    NgbAccordionBody,
    ProductReview,
    QuestionsAnswers,
    AsyncPipe,
    TranslateModule,
  ],
})
export class ProductDetailsAccordion {
  private store = inject(Store);

  readonly product = input<IProduct | null>();

  question$: Observable<IQnAModel> = inject(Store).select(QuestionAnswersState.questionsAnswers);
  review$: Observable<IReviewModel> = inject(Store).select(ReviewState.review);

  ngOnChanges(changes: SimpleChanges) {
    let product = changes['product']?.currentValue;
    this.store.dispatch(new GetQuestionAnswersAction({ product_id: product.id }));
    this.store.dispatch(new GetReviewAction({ product_id: product.id }));
  }
}
