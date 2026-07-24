import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext, Store } from '@ngxs/store';
import { of, tap } from 'rxjs';

import {
  AddToCartAction,
  AddToCartLocalStorageAction,
  ClearCartAction,
  CloseStickyCartAction,
  DeleteCartAction,
  GetCartItemsAction,
  ReplaceCartAction,
  ToggleSidebarCartAction,
  UpdateCartAction,
} from '@data-access/actions/cart.action';
import { ICart, ICartModel } from '@data-access/interfaces/cart.interface';
import { CartService } from '../services/cart.service';
import { NotificationService } from '../services/notification.service';

export interface CartStateModel {
  items: ICart[];
  total: number;
  stickyCartOpen: boolean;
  sidebarCartOpen: boolean;
}

@State<CartStateModel>({
  name: 'cart',
  defaults: {
    items: [],
    total: 0,
    stickyCartOpen: false,
    sidebarCartOpen: false,
  },
})
@Injectable()
export class CartState {
  private cartService = inject(CartService);
  private notificationService = inject(NotificationService);
  private store = inject(Store);

  ngxsOnInit(ctx: StateContext<CartStateModel>) {
    ctx.dispatch(new ToggleSidebarCartAction(false));
    ctx.dispatch(new CloseStickyCartAction());
  }

  @Selector()
  static cartItems(state: CartStateModel) {
    return state.items;
  }

  @Selector()
  static cartTotal(state: CartStateModel) {
    return state.total;
  }

  @Selector()
  static stickyCart(state: CartStateModel) {
    return state.stickyCartOpen;
  }

  @Selector()
  static sidebarCartOpen(state: CartStateModel) {
    return state.sidebarCartOpen;
  }

  @Action(GetCartItemsAction)
  getCartItems(ctx: StateContext<CartStateModel>) {
    return this.cartService.getCartItems().pipe(
      tap({
        next: result => {
          // Set Selected Varaint
          result?.items?.filter((item: ICart) => {
            if (item?.variation) {
              item.variation.selected_variation = item?.variation?.attribute_values
                ?.map(values => values?.value)
                .join('/');
            }
          });
          ctx.patchState(result);
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(AddToCartAction)
  add(ctx: StateContext<CartStateModel>, action: AddToCartAction) {
    if (action.payload.id) {
      return this.store.dispatch(new UpdateCartAction(action.payload));
    }
    return this.store.dispatch(new AddToCartLocalStorageAction(action.payload));
  }

  @Action(AddToCartLocalStorageAction)
  addToLocalStorage(ctx: StateContext<CartStateModel>, action: AddToCartLocalStorageAction) {
    let salePrice = action.payload.variation
      ? action.payload.variation.sale_price
      : action.payload.product?.sale_price;
    let result: ICartModel = {
      items: [
        {
          id: Number(
            Math.floor(Math.random() * 10000)
              .toString()
              .padStart(4, '0'),
          ), // Generate Random Id
          quantity: action.payload.quantity,
          sub_total: salePrice ? salePrice * action.payload.quantity : 0,
          product: action.payload.product!,
          product_id: action.payload.product_id,
          variation: action.payload.variation!,
          variation_id: action.payload.variation_id,
        },
      ],
    };

    const state = ctx.getState();
    const cart = [...state.items];
    const index = cart.findIndex(item => item.id === result.items[0].id);

    let output = { ...state };

    if (index == -1) {
      output.items = [...state.items, ...result.items];
    }

    // Set Selected Varaint
    output.items.filter(item => {
      if (item?.variation) {
        item.variation.selected_variation = item?.variation?.attribute_values
          ?.map(values => values.value)
          .join('/');
      }
    });

    // Calculate Total
    output.total = output.items.reduce((prev, curr: ICart) => {
      return prev + Number(curr.sub_total);
    }, 0);

    output.stickyCartOpen = true;
    output.sidebarCartOpen = true;
    ctx.patchState(output);

    setTimeout(() => {
      this.store.dispatch(new CloseStickyCartAction());
    }, 1500);
  }

  @Action(UpdateCartAction)
  update(ctx: StateContext<CartStateModel>, action: UpdateCartAction) {
    const state = ctx.getState();
    const cart = [...state.items];
    const index = cart.findIndex(item => Number(item.id) === Number(action.payload.id));

    if (
      cart[index]?.variation &&
      action.payload.variation_id &&
      Number(cart[index].id) === Number(action.payload.id) &&
      Number(cart[index]?.variation_id) != Number(action.payload.variation_id)
    ) {
      return this.store.dispatch(new ReplaceCartAction(action.payload));
    }

    const productQty = cart[index]?.variation
      ? cart[index]?.variation?.quantity
      : cart[index]?.product?.quantity;

    if (productQty < cart[index]?.quantity + action?.payload.quantity) {
      this.notificationService.showError(
        `You can not add more items than available. In stock ${productQty} items.`,
      );
      return false;
    }

    if (cart[index]?.variation) {
      cart[index].variation.selected_variation = cart[index]?.variation?.attribute_values
        ?.map(values => values.value)
        .join('/');
    }
    cart[index].quantity = cart[index]?.quantity + action?.payload.quantity;
    cart[index].sub_total =
      cart[index]?.quantity *
      (cart[index]?.variation
        ? cart[index]?.variation?.sale_price
        : cart[index].product.sale_price);

    if (cart[index].quantity < 1) {
      this.store.dispatch(new DeleteCartAction(action.payload.id!));
      return of();
    }

    let total = state.items.reduce((prev, curr: ICart) => {
      return prev + Number(curr.sub_total);
    }, 0);

    ctx.patchState({
      ...state,
      total: total,
    });

    return true;
  }

  @Action(ReplaceCartAction)
  replace(ctx: StateContext<CartStateModel>, action: ReplaceCartAction) {
    const state = ctx.getState();
    const cart = [...state.items];
    const index = cart.findIndex(item => Number(item.id) === Number(action.payload.id));

    // Update Cart If cart id same but variant id is different
    if (
      cart[index]?.variation &&
      action.payload.variation_id &&
      Number(cart[index].id) === Number(action.payload.id) &&
      Number(cart[index]?.variation_id) != Number(action.payload.variation_id)
    ) {
      cart[index].variation = action.payload.variation!;
      cart[index].variation_id = action.payload.variation_id;
      cart[index].variation.selected_variation = cart[index]?.variation?.attribute_values
        ?.map(values => values.value)
        .join('/');
    }

    cart[index].quantity = 0;

    const productQty = cart[index]?.variation
      ? cart[index]?.variation?.quantity
      : cart[index]?.product?.quantity;

    if (productQty < cart[index]?.quantity + action?.payload.quantity) {
      this.notificationService.showError(
        `You can not add more items than available. In stock ${productQty} items.`,
      );
      return false;
    }

    cart[index].quantity = cart[index]?.quantity + action?.payload.quantity;
    cart[index].sub_total =
      cart[index]?.quantity *
      (cart[index]?.variation
        ? cart[index]?.variation?.sale_price
        : cart[index].product.sale_price);

    if (cart[index].quantity < 1) {
      this.store.dispatch(new DeleteCartAction(action.payload.id!));
      return of();
    }

    let total = state.items.reduce((prev, curr: ICart) => {
      return prev + Number(curr.sub_total);
    }, 0);

    ctx.patchState({
      ...state,
      total: total,
    });

    return true;
  }

  @Action(DeleteCartAction)
  delete(ctx: StateContext<CartStateModel>, { id }: DeleteCartAction) {
    const state = ctx.getState();

    let cart = state.items.filter(value => value.id !== id);
    let total = cart.reduce((prev, curr: ICart) => {
      return prev + Number(curr.sub_total);
    }, 0);

    ctx.patchState({
      items: cart,
      total: total,
    });
  }

  @Action(CloseStickyCartAction)
  closeStickyCart(ctx: StateContext<CartStateModel>) {
    const state = ctx.getState();
    ctx.patchState({
      ...state,
      stickyCartOpen: false,
    });
  }

  @Action(ToggleSidebarCartAction)
  toggleSidebarCart(ctx: StateContext<CartStateModel>, { value }: ToggleSidebarCartAction) {
    const state = ctx.getState();
    ctx.patchState({
      ...state,
      sidebarCartOpen: value,
    });
  }

  @Action(ClearCartAction)
  clearCart(ctx: StateContext<CartStateModel>) {
    ctx.getState();
    ctx.patchState({
      items: [],
      total: 0,
    });
  }
}
