import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { IWishlistModel } from '@data-access/interfaces/wishlist.interface';
import { WishlistState } from '@data-access/states/wishlist.state';

@Component({
  selector: 'app-header-wishlist',
  templateUrl: './wishlist.html',
  styleUrls: ['./wishlist.scss'],
  imports: [RouterLink, AsyncPipe],
})
export class Wishlist {
  readonly style = input<string>('basic');

  wishlist$: Observable<IWishlistModel> = inject(Store).select(WishlistState.wishlistItems);
}
