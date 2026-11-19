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
] as Routes;
