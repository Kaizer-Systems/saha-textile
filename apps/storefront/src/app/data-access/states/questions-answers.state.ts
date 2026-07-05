import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  FeedbackAction,
  GetQuestionAnswersAction,
  SendQuestionAction,
  UpdateQuestionAnswersAction,
} from '@data-access/actions/questions-answers.action';
import { IQuestionAnswers } from '@data-access/interfaces/questions-answers.interface';
import { QuestionsAnswersService } from '../services/questions-answers.service';

export class QuestionStateModel {
  question = {
    data: [] as IQuestionAnswers[],
    total: 0,
  };
}

@State<QuestionStateModel>({
  name: 'question',
  defaults: {
    question: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class QuestionAnswersState {
  private questionsAnswersService = inject(QuestionsAnswersService);

  @Selector()
  static questionsAnswers(state: QuestionStateModel) {
    return state.question;
  }

  @Action(GetQuestionAnswersAction)
  getQuestionAnswers(ctx: StateContext<QuestionStateModel>, action: GetQuestionAnswersAction) {
    this.questionsAnswersService.skeletonLoader = true;
    return this.questionsAnswersService.getQuestionAnswers(action.slug).pipe(
      tap({
        next: result => {
          ctx.patchState({
            question: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.questionsAnswersService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(SendQuestionAction)
  sendQuestion(_ctx: StateContext<QuestionStateModel>, _action: SendQuestionAction) {
    // Submit Question Logic Here
  }

  @Action(UpdateQuestionAnswersAction)
  update(
    _ctx: StateContext<QuestionStateModel>,
    { payload: _payload, id: _id }: UpdateQuestionAnswersAction,
  ) {
    // Update Question Logic Here
  }

  @Action(FeedbackAction)
  Feedback(ctx: StateContext<QuestionStateModel>, action: FeedbackAction) {
    const state = ctx.getState();
    const question = [...state.question.data];
    const index = question.findIndex(
      item => Number(item.id) === Number(action.payload['question_and_answer_id']),
    );

    if (action.type === 'liked' || action.type === 'disliked') {
      const currentReaction = question[index].reaction;
      const newReaction = action.payload['reaction'];
      if (currentReaction === newReaction) {
        if (action.type === 'liked') {
          question[index].total_likes -= 1;
        } else {
          question[index].total_dislikes -= 1;
        }
        question[index].reaction = null;
        action.payload['reaction'] = null;
      } else {
        if (currentReaction === 'liked') {
          question[index].total_likes -= 1;
        } else if (currentReaction === 'disliked') {
          question[index].total_dislikes -= 1;
        }
        if (action.type === 'liked') {
          question[index].total_likes += 1;
        } else {
          question[index].total_dislikes += 1;
        }
        question[index].reaction = newReaction;
        action.payload['reaction'] = newReaction;
      }
    }

    ctx.patchState({
      ...state,
      question: {
        data: question,
        total: state.question.total,
      },
    });
  }
}
