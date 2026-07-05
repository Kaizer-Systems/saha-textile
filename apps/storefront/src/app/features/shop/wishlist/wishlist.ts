import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IWishlistModel } from '@data-access/interfaces/wishlist.interface';
import { WishlistService } from '@data-access/services/wishlist.service';
import { WishlistState } from '@data-access/states/wishlist.state';
import { GetWishlistAction } from '@data-access/actions/wishlist.action';

@Component({
  selector: 'app-wishlist',
  templateUrl: './wishlist.html',
  styleUrls: ['./wishlist.scss'],
  imports: [Breadcrumb, SkeletonProductBox, ProductBox, NoData, AsyncPipe],
})
export class Wishlist {
  private store = inject(Store);
  wishlistService = inject(WishlistService);

  wishlistItems$: Observable<IWishlistModel> = inject(Store).select(WishlistState.wishlistItems);

  public breadcrumb: IBreadcrumb = {
    title: 'Wishlist',
    items: [{ label: 'Wishlist', active: true }],
  };

  public skeletonItems = Array.from({ length: 12 }, (_, index) => index);

  constructor() {
    this.store.dispatch(new GetWishlistAction());
  }
}
