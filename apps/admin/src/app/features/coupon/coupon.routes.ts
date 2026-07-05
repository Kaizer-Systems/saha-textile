import { Routes } from '@angular/router';

import { Coupon } from './coupon';
import { CreateCoupon } from './create-coupon/create-coupon';
import { EditCoupon } from './edit-coupon/edit-coupon';

export default [
	{
		path: '',
		component: Coupon,
	},
	{
		path: 'create',
		component: CreateCoupon,
	},
	{
		path: 'edit/:id',
		component: EditCoupon,
	},
] as Routes;
