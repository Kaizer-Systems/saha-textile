import { AsyncPipe, SlicePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { CartFacade } from '@core/state/cart/cart.facade';
import { ICart } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { Button } from '../button/button';

@Component({
	selector: 'app-sticky-cart',
	templateUrl: './sticky-cart.html',
	styleUrls: ['./sticky-cart.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Button, RouterLink, AsyncPipe, SlicePipe, TranslocoModule, CurrencySymbolPipe],
})
export class StickyCart {
	private cartFacade = inject(CartFacade);
	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
	cartTotal$: Observable<number> = this.cartFacade.cartTotal$;
	stickyCart$: Observable<boolean> = this.cartFacade.stickyCart$;

	public isOpen: boolean;

	constructor() {
		this.stickyCart$.subscribe((value) => (this.isOpen = value));
	}

	openCart(isOpen: boolean) {
		this.isOpen = isOpen;
	}
}
