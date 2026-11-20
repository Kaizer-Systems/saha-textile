import { computed } from '@angular/core';

import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';

import type { AdminCartWrite, BusinessBuyerOption, CustomerBuyerOption } from '@saha-textile/contracts';

/** Who the order is for (oc01, oc03): a shop customer or a business, as the picker found them. */
export type DraftBuyer =
	{ kind: 'person'; customer: CustomerBuyerOption } | { kind: 'business'; business: BusinessBuyerOption };

/** One cart line before the server prices it; fabric by the metre counts tenths of a metre. */
export interface DraftLine {
	key: string;
	productId: string;
	variationId: string | null;
	quantity: number;
	soldBy: 'piece' | 'metre';
}

/** oo02 "Add pieces": the open order the cart is being added to, instead of a new order. */
export interface DraftAddingTo {
	orderId: string;
	orderNumber: string;
	buyerName: string;
}

interface OrderDraftState {
	buyerKind: 'person' | 'business';
	buyer: DraftBuyer | null;
	currency: string;
	lines: DraftLine[];
	addingTo: DraftAddingTo | null;
}

const STORAGE_KEY = 'st_admin_order_draft';
const EMPTY: OrderDraftState = { buyerKind: 'person', buyer: null, currency: 'INR', lines: [], addingTo: null };

const keyOf = (productId: string, variationId: string | null): string => `${productId}:${variationId ?? '-'}`;

/** The draft lives for this browser tab, so going to checkout and back (or a reload) keeps it. */
function load(): OrderDraftState {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY;
		const parsed = JSON.parse(raw) as Partial<OrderDraftState>;
		return {
			buyerKind: parsed.buyerKind === 'business' ? 'business' : 'person',
			buyer: parsed.buyer ?? null,
			currency: typeof parsed.currency === 'string' ? parsed.currency : 'INR',
			lines: Array.isArray(parsed.lines) ? parsed.lines : [],
			addingTo: parsed.addingTo ?? null,
		};
	} catch {
		return EMPTY;
	}
}

function save(state: OrderDraftState): void {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Private windows and blocked storage: the draft simply isn't kept across reloads.
	}
}

/**
 * The order being put together on Create order and Checkout (brief oc01–oc03, ck01–ck08): the buyer,
 * the currency and the lines. Prices are never kept here; the server prices the cart every time.
 */
export const OrderDraftStore = signalStore(
	{ providedIn: 'root' },
	withState<OrderDraftState>(EMPTY),
	withComputed((store) => ({
		businessId: computed(() => {
			const buyer = store.buyer();
			return buyer?.kind === 'business' ? buyer.business.id : null;
		}),
		/** What the server prices: the same body for the cart, the cards and the checkout. */
		cartWrite: computed<AdminCartWrite>(() => {
			const buyer = store.buyer();
			return {
				buyer: !buyer
					? null
					: buyer.kind === 'person'
						? { kind: 'person', customerId: buyer.customer.id }
						: { kind: 'business', businessId: buyer.business.id },
				currency: store.currency(),
				lines: store.lines().map((line) => ({
					productId: line.productId,
					variationId: line.variationId,
					quantity: line.quantity,
					addons: [],
				})),
			};
		}),
		count: computed(() => store.lines().length),
	})),
	withMethods((store) => {
		const commit = (patch: Partial<OrderDraftState>) => {
			patchState(store, patch);
			save({
				buyerKind: store.buyerKind(),
				buyer: store.buyer(),
				currency: store.currency(),
				lines: store.lines(),
				addingTo: store.addingTo(),
			});
		};
		return {
			setBuyerKind(kind: 'person' | 'business'): void {
				if (store.buyerKind() === kind) return;
				commit({ buyerKind: kind, buyer: null });
			},
			setBuyer(buyer: DraftBuyer | null): void {
				commit({ buyer, buyerKind: buyer?.kind ?? store.buyerKind() });
			},
			setCurrency(currency: string): void {
				commit({ currency });
			},
			/** Adds pieces (or tenths of a metre); the same piece again adds to its line. */
			add(line: Omit<DraftLine, 'key'>): void {
				const key = keyOf(line.productId, line.variationId);
				const existing = store.lines().find((row) => row.key === key);
				commit({
					lines: existing
						? store
								.lines()
								.map((row) =>
									row.key === key ? { ...row, quantity: row.quantity + line.quantity } : row,
								)
						: [...store.lines(), { ...line, key }],
				});
			},
			/** Changes a line by `step`; at zero the line goes. */
			change(key: string, step: number): void {
				commit({
					lines: store
						.lines()
						.map((row) => (row.key === key ? { ...row, quantity: row.quantity + step } : row))
						.filter((row) => row.quantity > 0),
				});
			},
			remove(key: string): void {
				commit({ lines: store.lines().filter((row) => row.key !== key) });
			},
			clear(): void {
				commit({ ...EMPTY });
			},
			/** Starts adding pieces to an open order (oo02): its buyer, in ₹, with an empty cart. */
			startAddingTo(addingTo: DraftAddingTo, buyer: DraftBuyer): void {
				commit({ ...EMPTY, buyer, buyerKind: buyer.kind, currency: 'INR', addingTo });
			},
		};
	}),
	withHooks({
		onInit(store) {
			patchState(store, load());
		},
	}),
);

export const draftLineKey = keyOf;
