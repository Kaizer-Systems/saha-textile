import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { ICategory } from '@data-access/interfaces/category.interface';
import { GetCategoriesAction } from '@data-access/actions/category.action';
import { CategoryService } from '../services/category.service';

export class CategoryStateModel {
  category = {
    data: [] as ICategory[],
    total: 0,
  };
}

@State<CategoryStateModel>({
  name: 'category',
  defaults: {
    category: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class CategoryState {
  private categoryService = inject(CategoryService);

  @Selector()
  static category(state: CategoryStateModel) {
    return state.category;
  }

  @Action(GetCategoriesAction)
  getCategories(ctx: StateContext<CategoryStateModel>, action: GetCategoriesAction) {
    return this.categoryService.getCategories(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            category: {
              data: result.data,
              total: result?.total ? result?.total : result?.data?.length,
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
