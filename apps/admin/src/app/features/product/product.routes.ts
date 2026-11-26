import { Routes } from '@angular/router';

import { CreateProduct } from './create-product/create-product';
import { EditProduct } from './edit-product/edit-product';
import { Product } from './product';
import { ProductDrafts } from './product-drafts/product-drafts';
import { productLeaveGuard } from './product-leave.guard';

export default [
	{
		path: '',
		component: Product,
	},
	{
		path: 'create',
		component: CreateProduct,
		canDeactivate: [productLeaveGuard],
	},
	{
		path: 'edit/:id',
		component: EditProduct,
		canDeactivate: [productLeaveGuard],
	},
	{
		path: 'drafts',
		component: ProductDrafts,
	},
	// The bundle builder (bundle builder brief, approved 2026-11-22).
	{
		path: 'bundles',
		loadComponent: () => import('./bundles/bundle-list').then((m) => m.BundleList),
	},
	{
		path: 'bundle/:id',
		loadComponent: () => import('./bundles/bundle-builder').then((m) => m.BundleBuilder),
	},
	{
		path: 'bundle-price-methods',
		loadComponent: () => import('./bundles/price-method-list').then((m) => m.PriceMethodList),
	},
	{
		path: 'bundle-price-methods/:id',
		loadComponent: () => import('./bundles/price-method-builder').then((m) => m.PriceMethodBuilder),
	},
] as Routes;
