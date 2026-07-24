import { Routes } from '@angular/router';

import { Cart } from './cart/cart';
import { Checkout } from './checkout/checkout';
import { Collection } from './collection/collection';
import { Compare } from './compare/compare';
import { Product } from './product/product';
import { Wishlist } from './wishlist/wishlist';
import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { ProductResolver } from '@data-access/resolvers/product.resolver';

// Components

// Product

// Collection

// Checkout

export default [
  {
    path: 'cart',
    component: Cart,
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'wishlist',
    component: Wishlist,
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'compare',
    component: Compare,
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'product/:slug',
    component: Product,
    resolve: {
      data: ProductResolver,
    },
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'collections',
    component: Collection,
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'checkout',
    component: Checkout,
  },
] as Routes;
