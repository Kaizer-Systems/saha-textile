import { AsyncPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { firstValueFrom, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { money } from '@core/orders/order-format';
import { injectAdminCardsQuery, injectAdminCartQuery, OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { LoaderStore } from '@core/state/loader.store';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { Loader } from '@layout/loader/loader';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ProductBoxSkeleton } from '@shared/ui/skeleton/product-box-skeleton/product-box-skeleton';

import { OrderBuyerCard } from './order-buyer-card';
import { OrderProductCard } from './order-product-card';
import { OrderVariantPopup } from './order-variant-popup';

import type { AdminCartLine, AdminProductCard, AdminVariantChoice } from '@saha-textile/contracts';

const PAGE_SIZE = 24;

/** A cart line as the screen shows it: the draft line and the server's price for it. */
export interface CartRow {
	key: string;
	quantity: number;
	soldBy: 'piece' | 'metre';
	priced: AdminCartLine | null;
}

/**
 * Admin › Orders › Create order (brief oc01–oc03): the ported theme screen made real. Who the order is
 * for and its currency sit on top; the categories, search and product cards come from the server,
 * priced for that buyer (a business by its zone); the cart is priced by the server exactly as the
 * shop prices it, and is kept for this tab while staff go to checkout and back.
 */
@Component({
	selector: 'app-create-order',
	templateUrl: './create-order.html',
	styleUrls: ['./create-order.scss'],
	imports: [
		Loader,
		CarouselModule,
		ReactiveFormsModule,
		FormsModule,
		AdvancedDropdown,
		ProductBoxSkeleton,
		Pagination,
		NoData,
		Button,
		HasPermissionDirective,
		RouterModule,
		TranslocoModule,
		AsyncPipe,
		OrderBuyerCard,
		OrderProductCard,
	],
})
export class CreateOrder {
	readonly draft = inject(OrderDraftStore);
	readonly loader = inject(LoaderStore);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(OrdersGateway);
	private readonly notifier = inject(NotificationService);
	/** True while the cart is being added to an open order. */
	readonly addingBusy = signal(false);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);

	readonly search = signal('');
	readonly categoryId = signal<string | null>(null);
	readonly page = signal(1);
	readonly pageSize = PAGE_SIZE;
	readonly skeletonItems = Array.from({ length: 8 }, (_, index) => index);

	readonly cards = injectAdminCardsQuery(() => ({
		page: this.page(),
		pageSize: PAGE_SIZE,
		currency: this.draft.currency(),
		...(this.search() ? { q: this.search() } : {}),
		...(this.categoryId() ? { categoryId: this.categoryId() as string } : {}),
		...(this.draft.businessId() ? { businessId: this.draft.businessId() as string } : {}),
	}));
	readonly cart = injectAdminCartQuery(() => this.draft.cartWrite());

	/** The server answers line for line, in the order the lines were sent. */
	readonly rows = computed<CartRow[]>(() => {
		const priced = this.cart.data()?.lines ?? [];
		const sent = this.draft.lines();
		return sent.map((line, index) => ({
			key: line.key,
			quantity: line.quantity,
			soldBy: line.soldBy,
			priced: priced.length === sent.length ? (priced[index] ?? null) : null,
		}));
	});
	readonly subtotal = computed(() => {
		const view = this.cart.data();
		return view && this.draft.count() ? this.money(view.subtotal) : this.money(0);
	});
	/** Checkout needs a buyer and every line sellable. */
	readonly canCheckout = computed(
		() =>
			!!this.draft.buyer() &&
			this.draft.count() > 0 &&
			!this.cart.isFetching() &&
			this.rows().every((row) => row.priced && !this.blocked(row.priced)),
	);

	activeCategory: ICategory | null = null;
	selectedCategory: number[] = [];
	readonly term = new FormControl('');

	readonly customOptions: OwlOptions = {
		loop: true,
		margin: 15,
		dots: false,
		navSpeed: 700,
		responsive: { 0: { items: 1 }, 400: { items: 2 }, 740: { items: 3 }, 940: { items: 5 } },
		nav: true,
	};

	constructor() {
		this.term.valueChanges.pipe(debounceTime(400), distinctUntilChanged()).subscribe((value) => {
			this.search.set((value ?? '').trim());
			this.page.set(1);
		});
		const addTo = this.route.snapshot?.queryParamMap?.get('addTo');
		if (addTo && this.draft.addingTo()?.orderId !== addTo) void this.startAddingTo(addTo);
	}

	/** oo02 "Add pieces": the open order's buyer (found by the picker's own search), in ₹, an empty cart. */
	async startAddingTo(orderId: string): Promise<void> {
		try {
			const { order } = await firstValueFrom(this.gateway.detail(orderId));
			const buyer = order.buyer;
			if (order.status !== 'open' || !buyer) return;
			if (buyer.kind === 'business' && buyer.businessId) {
				const found = await firstValueFrom(this.gateway.searchBusinesses(buyer.gstin ?? buyer.name));
				const business = found.find((row) => row.id === buyer.businessId);
				if (!business) return;
				this.draft.startAddingTo(
					{ orderId, orderNumber: order.orderNumber, buyerName: buyer.name },
					{ kind: 'business', business },
				);
				return;
			}
			const found = await firstValueFrom(this.gateway.searchCustomers(buyer.email ?? buyer.name));
			const customer = found.find((row) => row.id === buyer.customerId);
			if (!customer) return;
			this.draft.startAddingTo(
				{ orderId, orderNumber: order.orderNumber, buyerName: buyer.name },
				{ kind: 'person', customer },
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	stopAdding(): void {
		this.draft.clear();
	}

	/** Adds the cart's lines to the open order; they are held from now on. */
	async addToOrder(): Promise<void> {
		const adding = this.draft.addingTo();
		const write = this.draft.cartWrite();
		if (!adding || !write || !this.canCheckout()) return;
		this.addingBusy.set(true);
		try {
			const { order } = await firstValueFrom(this.gateway.detail(adding.orderId));
			await firstValueFrom(
				this.gateway.addOpenLines(adding.orderId, { lines: write.lines, revision: order.revision }),
			);
			this.draft.clear();
			this.notifier.showSuccess(this.transloco.translate('ord_pieces_added'));
			await this.router.navigate(['/order/details', adding.orderId]);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.addingBusy.set(false);
		}
	}

	money(amount: number): string {
		return money(amount, this.draft.currency(), this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN');
	}

	quantityWords(row: CartRow): string {
		return row.soldBy === 'metre'
			? this.transloco.translate('ord_metres', { metres: (row.quantity / 10).toLocaleString('en-IN') })
			: String(row.quantity);
	}

	blocked(line: AdminCartLine): boolean {
		return line.problem === 'unavailable' || line.problem === 'out_of_stock' || line.problem === 'noZonePrice';
	}

	selectCategory(category: ICategory): void {
		this.activeCategory = this.activeCategory?.id !== category?.id ? category : null;
		this.selectedCategory = [];
		this.categoryId.set(this.activeCategory ? String(this.activeCategory.id) : null);
		this.page.set(1);
	}

	selectCategoryItem(ids: number[]): void {
		this.activeCategory = null;
		this.categoryId.set(ids.length ? String(ids[0]) : null);
		this.page.set(1);
	}

	setPaginate(page: number): void {
		this.page.set(page);
	}

	/** Add from a card: a product with variants opens the variant picker first. */
	async add(card: AdminProductCard): Promise<void> {
		const step = card.soldBy === 'metre' ? (card.shortestCutTenths ?? 10) : 1;
		if (!card.hasVariants) {
			this.draft.add({ productId: card.productId, variationId: null, quantity: step, soldBy: card.soldBy });
			return;
		}
		const popup = this.modals.open(OrderVariantPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_variant_popup_title',
		});
		await (popup.componentInstance as OrderVariantPopup).start(
			card,
			this.draft.currency(),
			this.draft.businessId(),
		);
		const chosen = (await popup.result.catch(() => null)) as AdminVariantChoice | null;
		if (chosen) {
			this.draft.add({
				productId: card.productId,
				variationId: chosen.variationId,
				quantity: step,
				soldBy: card.soldBy,
			});
		}
	}

	change(row: CartRow, direction: 1 | -1): void {
		this.draft.change(row.key, direction);
	}
}
