import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { FormControl } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable, Subject } from 'rxjs';

import { GetUserDetailsAction } from '@data-access/actions/account.action';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { NoData } from '@shared/ui/no-data/no-data';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQnAModel, IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { AccountState } from '@data-access/states/account.state';

@Component({
  selector: 'app-questions-answers',
  templateUrl: './questions-answers.html',
  styleUrls: ['./questions-answers.scss'],
  imports: [NoData, QuestionModal, AsyncPipe, TranslateModule],
})
export class QuestionsAnswers {
  private store = inject(Store);
  private queryClient = injectQueryClient();
  questionAnswersService = inject(QuestionsAnswersService);

  public user: IAccountUser;
  public question = new FormControl();
  public isLogin: boolean = false;
  public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
  private destroy$ = new Subject<void>();

  readonly product = input<IProduct>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly questionAnswers = input<IQuestionAnswers[]>();

  readonly QuestionModal = viewChild<QuestionModal>('questionModal');

  user$: Observable<IAccountUser> = inject(Store).select(
    AccountState.user,
  ) as Observable<IAccountUser>;

  constructor() {
    this.isLogin = !!this.store.selectSnapshot(state => state.auth && state.auth.access_token);
    if (this.isLogin) {
      this.store.dispatch(new GetUserDetailsAction());
    }
  }

  // Optimistic like/dislike on the cached Q&A list (was the NGXS FeedbackAction
  // reducer). No backend yet — mutate the ['qna', productId] query cache in place.
  feedback(qna: IQuestionAnswers, value: string) {
    const productId = this.product()?.id;
    this.queryClient.setQueryData<IQnAModel>(['qna', productId], old => {
      if (!old) return old;
      const data = old.data.map(q => ({ ...q }));
      const index = data.findIndex(item => Number(item.id) === Number(qna.id));
      if (index === -1) return old;

      const currentReaction = data[index].reaction;
      if (currentReaction === value) {
        if (value === 'liked') data[index].total_likes -= 1;
        else data[index].total_dislikes -= 1;
        data[index].reaction = null;
      } else {
        if (currentReaction === 'liked') data[index].total_likes -= 1;
        else if (currentReaction === 'disliked') data[index].total_dislikes -= 1;
        if (value === 'liked') data[index].total_likes += 1;
        else data[index].total_dislikes += 1;
        data[index].reaction = value;
      }
      return { ...old, data };
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
