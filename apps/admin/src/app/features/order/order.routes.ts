import { Routes } from '@angular/router';

import { Checkout } from './checkout/checkout';
import { CreateOrder } from './create-order/create-order';
import { Details } from './details/details';
import { Order } from './order';

export default [
	{
		path: '',
		component: Order,
	},
	{
		path: 'details/:id',
		component: Details,
	},
	{
		path: 'create',
		component: CreateOrder,
	},
	{
		path: 'checkout',
		component: Checkout,
	},
] as Routes;
