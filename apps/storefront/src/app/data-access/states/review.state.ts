import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetReviewAction, SendReviewAction, UpdateReviewAction } from '@data-access/actions/review.action';
import { IReview } from '@data-access/interfaces/review.interface';
import { ReviewService } from '../services/review.service';

export class ReviewStateModel {
  review = {
    data: [] as IReview[],
    total: 0,
  };
}

@State<ReviewStateModel>({
  name: 'review',
  defaults: {
    review: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class ReviewState {
  private reviewsService = inject(ReviewService);

  @Selector()
  static review(state: ReviewStateModel) {
    return state.review;
  }

  @Action(GetReviewAction)
  getReview(ctx: StateContext<ReviewStateModel>, action: GetReviewAction) {
    return this.reviewsService.getReview(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            review: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(SendReviewAction)
  sendReview(_ctx: StateContext<ReviewStateModel>, _action: SendReviewAction) {
    // Submit Review Logic Here
  }

  @Action(UpdateReviewAction)
  update(_ctx: StateContext<ReviewStateModel>, { payload: _payload, id: _id }: UpdateReviewAction) {
    // Update Review Logic Here
  }
}
