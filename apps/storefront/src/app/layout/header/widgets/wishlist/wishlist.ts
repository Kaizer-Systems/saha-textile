import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WishlistFacade } from '@core/state/wishlist/wishlist.store';

@Component({
	selector: 'app-header-wishlist',
	templateUrl: './wishlist.html',
	styleUrls: ['./wishlist.scss'],
	imports: [RouterLink, AsyncPipe],
})
export class Wishlist {
	readonly style = input<string>('basic');

	wishlist$ = inject(WishlistFacade).wishlistItems$;
}
