import { Routes } from '@angular/router';

import { CreateProduct } from './create-product/create-product';
import { EditProduct } from './edit-product/edit-product';
import { Product } from './product';

export default [
	{
		path: '',
		component: Product,
	},
	{
		path: 'create',
		component: CreateProduct,
	},
	{
		path: 'edit/:id',
		component: EditProduct,
	},
] as Routes;
