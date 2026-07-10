import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { WishlistService } from '@data-access/services/wishlist.service';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';

@Component({
  selector: 'app-wishlist',
  templateUrl: './wishlist.html',
  styleUrls: ['./wishlist.scss'],
  imports: [Breadcrumb, SkeletonProductBox, ProductBox, NoData, AsyncPipe],
})
export class Wishlist {
  private wishlistFacade = inject(WishlistFacade);
  wishlistService = inject(WishlistService);

  wishlistItems$ = this.wishlistFacade.wishlistItems$;

  public breadcrumb: IBreadcrumb = {
    title: 'Wishlist',
    items: [{ label: 'Wishlist', active: true }],
  };

  public skeletonItems = Array.from({ length: 12 }, (_, index) => index);

  constructor() {
    this.wishlistFacade.getWishlist();
  }
}
