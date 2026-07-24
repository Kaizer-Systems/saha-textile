import { AsyncPipe } from '@angular/common';
import { Component, inject, input, SimpleChanges } from '@angular/core';

import {
  NgbNav,
  NgbNavContent,
  NgbNavItem,
  NgbNavItemRole,
  NgbNavLink,
  NgbNavLinkBase,
  NgbNavOutlet,
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
  selector: 'app-product-details-tabs',
  templateUrl: './product-details-tabs.html',
  styleUrls: ['./product-details-tabs.scss'],
  imports: [
    NgbNav,
    NgbNavItem,
    NgbNavItemRole,
    NgbNavLink,
    NgbNavLinkBase,
    NgbNavContent,
    ProductReview,
    QuestionsAnswers,
    NgbNavOutlet,
    AsyncPipe,
    TranslateModule,
  ],
})
export class ProductDetailsTabs {
  private store = inject(Store);

  readonly product = input<IProduct | null>();

  question$: Observable<IQnAModel> = inject(Store).select(QuestionAnswersState.questionsAnswers);
  review$: Observable<IReviewModel> = inject(Store).select(ReviewState.review);

  public active = 'description';

  ngOnChanges(changes: SimpleChanges) {
    let product = changes['product']?.currentValue;
    this.store.dispatch(new GetQuestionAnswersAction({ product_id: product.id }));
    this.store.dispatch(new GetReviewAction({ product_id: product.id }));
  }
}
