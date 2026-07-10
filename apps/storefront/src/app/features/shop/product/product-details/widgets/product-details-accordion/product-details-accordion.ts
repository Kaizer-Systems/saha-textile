import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

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

  constructor() {
    // Q&A + reviews load reactively via queries keyed on the product input
    // (was ngOnChanges dispatches). Drive the Q&A widget's skeleton off the query.
    effect(() => {
      this.questionsAnswersService.skeletonLoader = this.qnaQuery.isPending();
    });
  }
}
