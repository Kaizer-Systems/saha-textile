import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { WishlistStore } from '@core/state/wishlist/wishlist.store';

@Component({
	selector: 'app-header-wishlist',
	templateUrl: './wishlist.html',
	styleUrls: ['./wishlist.scss'],
	imports: [RouterLink, TranslocoModule],
})
export class Wishlist {
	readonly style = input<string>('basic');

	readonly wishlist = inject(WishlistStore);
}
