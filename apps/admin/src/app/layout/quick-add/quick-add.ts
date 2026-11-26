import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { filter, map } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';

/** One quick action: where it goes, who may use it, and how it is drawn and named. */
export interface QuickAddAction {
	readonly id: 'product' | 'order';
	readonly link: string;
	readonly permission: string;
	readonly icon: string;
	readonly label: string;
}

/** The two actions that left the header (Admin Quick Add brief, approved 24 Nov 2026). */
export const QUICK_ADD_ACTIONS: readonly QuickAddAction[] = [
	{
		id: 'product',
		link: '/product/create',
		permission: 'product.create',
		icon: 'ri-t-shirt-line',
		label: 'add_product',
	},
	{
		id: 'order',
		link: '/order/create',
		permission: 'order.create',
		icon: 'ri-shopping-cart-line',
		label: 'add_order',
	},
];

/** The address without its query or fragment. */
const pathOf = (url: string): string => url.replace(/[?#].*$/, '');

/**
 * The floating "+" at the bottom right of every admin page (Admin Quick Add brief, Q1 B): one round
 * button that opens Add Product and Add Order above it. Each action follows its permission; with
 * one action left, the "+" goes straight there; on an action's own page that action is left out
 * (Q3 A). Escape, a click outside, or the × closes the two.
 */
@Component({
	selector: 'app-quick-add',
	templateUrl: './quick-add.html',
	styleUrls: ['./quick-add.scss'],
	imports: [RouterLink, TranslocoModule],
	host: {
		'(document:keydown.escape)': 'close()',
		'(document:click)': 'clickedOutside($event)',
	},
})
export class QuickAdd {
	private readonly authStore = inject(AuthStore);
	private readonly router = inject(Router);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

	/** Whether the two named actions are open above the "+". */
	readonly open = signal(false);

	private readonly path = toSignal(
		this.router.events.pipe(
			filter((event) => event instanceof NavigationEnd),
			map(() => pathOf(this.router.url)),
		),
		{ initialValue: pathOf(this.router.url) },
	);

	/** The actions this person may use, minus the one whose page is open. */
	readonly actions = computed(() =>
		QUICK_ADD_ACTIONS.filter(
			(action) => this.authStore.permissions().includes(action.permission) && this.path() !== action.link,
		),
	);

	toggle(): void {
		this.open.update((open) => !open);
	}

	close(): void {
		this.open.set(false);
	}

	clickedOutside(event: Event): void {
		if (this.open() && !this.host.nativeElement.contains(event.target as Node | null)) this.close();
	}
}
