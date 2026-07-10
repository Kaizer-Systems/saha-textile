import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

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
import { Observable } from 'rxjs';

import { injectQuestionAnswersQuery } from '@data-access/queries/questions-answers.queries';
import { injectReviewQuery } from '@data-access/queries/review.queries';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQnAModel } from '@data-access/interfaces/questions-answers.interface';
import { IReviewModel } from '@data-access/interfaces/review.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
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
  private questionsAnswersService = inject(QuestionsAnswersService);

  readonly product = input<IProduct | null>();

  private readonly qnaQuery = injectQuestionAnswersQuery(() => this.product()?.id);
  question$: Observable<IQnAModel> = toObservable(
    computed(() => this.qnaQuery.data() ?? { data: [], total: 0 }),
  );
  private readonly reviewQuery = injectReviewQuery(() => this.product()?.id);
  review$: Observable<IReviewModel> = toObservable(
    computed(() => this.reviewQuery.data() ?? { data: [], total: 0 }),
  );

  public active = 'description';

  constructor() {
    // Q&A + reviews load reactively via queries keyed on the product input
    // (was ngOnChanges dispatches). Drive the Q&A widget's skeleton off the query.
    effect(() => {
      this.questionsAnswersService.skeletonLoader = this.qnaQuery.isPending();
    });
  }
}
