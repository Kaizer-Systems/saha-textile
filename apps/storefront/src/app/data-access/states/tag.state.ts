import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetTagsAction } from '@data-access/actions/tag.action';
import { ITag } from '@data-access/interfaces/tag.interface';
import { TagService } from '../services/tag.service';

export class TagStateModel {
  tag = {
    data: [] as ITag[],
    total: 0,
  };
}

@State<TagStateModel>({
  name: 'tag',
  defaults: {
    tag: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class TagState {
  private tagService = inject(TagService);

  @Selector()
  static tag(state: TagStateModel) {
    return state.tag;
  }

  @Action(GetTagsAction)
  getTags(ctx: StateContext<TagStateModel>, action: GetTagsAction) {
    return this.tagService.getTags(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            tag: {
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
}
