import { EntityState, createEntityAdapter } from '@ngrx/entity';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';

/**
 * Classic-NgRx cart feature state (replaces NGXS CartState). Cart is heavily
 * client-mutated (optimistic add/update/replace/delete with per-item totals), so
 * it's modelled with @ngrx/entity — a normalized entities/ids collection + adapter
 * ops (setAll/addOne/updateOne/removeOne) — matching the admin app and the locked
 * "Store / Effects / Entity" stack. The imperative logic lives in the effects (the
 * old NGXS @Action methods were already effect-like); the reducer applies pure
 * adapter ops. Beyond the entity collection it also tracks the running `total` and
 * the sticky/sidebar drawer flags (storefront-only, no admin equivalent).
 */
export const CART_FEATURE_KEY = 'cart';

export const cartAdapter = createEntityAdapter<ICart>();

export interface CartStateModel extends EntityState<ICart> {
	total: number;
	stickyCartOpen: boolean;
	sidebarCartOpen: boolean;
}

export const initialCartState: CartStateModel = cartAdapter.getInitialState({
	total: 0,
	stickyCartOpen: false,
	sidebarCartOpen: false,
});

const { selectAll } = cartAdapter.getSelectors();

export const calcCartTotal = (state: CartStateModel): number =>
	selectAll(state).reduce((prev, curr) => prev + Number(curr.sub_total), 0);

export const variationLabel = (variation: ICart['variation'] | undefined | null): string =>
	variation?.attribute_values?.map((values) => values.value).join('/') ?? '';

/**
 * Per-unit price for a line: the composed `unit_price` (base + add-on/bundle
 * deltas) when the PDP supplied it, else the plain variation/product sale price.
 */
export const lineUnitPrice = (line: ICart | ICartAddOrUpdate): number =>
	line.unit_price ?? (line.variation ? line.variation.sale_price : (line.product?.sale_price ?? 0));
