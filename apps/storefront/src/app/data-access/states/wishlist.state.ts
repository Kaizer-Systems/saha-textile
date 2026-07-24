import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  AddToWishlistAction,
  DeleteWishlistAction,
  GetWishlistAction,
} from '@data-access/actions/wishlist.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { WishlistService } from '../services/wishlist.service';

export class WishlistStateModel {
  wishlist = {
    data: [] as IProduct[],
    total: 0,
  };
}

@State<WishlistStateModel>({
  name: 'wishlist',
  defaults: {
    wishlist: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class WishlistState {
  router = inject(Router);
  private wishlistService = inject(WishlistService);

  @Selector()
  static wishlistItems(state: WishlistStateModel) {
    return state.wishlist;
  }

  @Action(GetWishlistAction)
  getWishlistItems(ctx: StateContext<GetWishlistAction>) {
    this.wishlistService.skeletonLoader = true;
    return this.wishlistService.getWishlistItems().pipe(
      tap({
        next: result => {
          ctx.patchState({
            wishlist: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.wishlistService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(AddToWishlistAction)
  add(_ctx: StateContext<WishlistStateModel>, _action: AddToWishlistAction) {
    // Add Wishlist Logic Here
    void void this.router.navigate(['/wishlist']);
  }

  @Action(DeleteWishlistAction)
  delete(ctx: StateContext<WishlistStateModel>, { id }: DeleteWishlistAction) {
    const state = ctx.getState();
    let item = state.wishlist.data.filter(value => value.id !== id);
    ctx.patchState({
      wishlist: {
        data: item,
        total: state.wishlist.total - 1,
      },
    });
  }
}
