import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Store, Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  AddToCompareAction,
  DeleteCompareAction,
  GetCompareAction,
} from '@data-access/actions/compare.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CompareService } from '../services/compare.service';

export class CompareStateModel {
  items: IProduct[];
  total: number;
}

@State<CompareStateModel>({
  name: 'compare',
  defaults: {
    items: [],
    total: 0,
  },
})
@Injectable()
export class CompareState {
  private store = inject(Store);
  router = inject(Router);
  private compareService = inject(CompareService);

  @Selector()
  static compareItems(state: CompareStateModel) {
    return state.items;
  }

  @Selector()
  static compareTotal(state: CompareStateModel) {
    return state.total;
  }

  @Action(GetCompareAction)
  getCompareItems(ctx: StateContext<GetCompareAction>) {
    this.compareService.skeletonLoader = true;
    return this.compareService.getCompareItems().pipe(
      tap({
        next: result => {
          ctx.patchState({
            items: result.data,
            total: result?.total ? result?.total : result.data ? result.data.length : 0,
          });
        },
        complete: () => {
          this.compareService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(AddToCompareAction)
  add(_ctx: StateContext<CompareStateModel>, _action: AddToCompareAction) {
    // Add Compare Logic
    void this.router.navigate(['/compare']);
  }

  @Action(DeleteCompareAction)
  delete(ctx: StateContext<CompareStateModel>, { id }: DeleteCompareAction) {
    const state = ctx.getState();
    let item = state.items.filter(value => value.id !== id);
    ctx.patchState({
      items: item,
      total: state.total - 1,
    });
  }
}
