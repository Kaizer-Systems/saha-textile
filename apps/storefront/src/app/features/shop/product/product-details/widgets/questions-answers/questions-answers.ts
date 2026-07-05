import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { FormControl } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable, Subject } from 'rxjs';

import { GetUserDetailsAction } from '@data-access/actions/account.action';
import { FeedbackAction } from '@data-access/actions/questions-answers.action';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { NoData } from '@shared/ui/no-data/no-data';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
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

  feedback(qna: IQuestionAnswers, value: string) {
    const data = {
      question_and_answer_id: qna.id,
      reaction: value,
    };
    this.store.dispatch(new FeedbackAction(data, value));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
