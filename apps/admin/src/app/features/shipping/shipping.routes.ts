import { Routes } from '@angular/router';

import { Shipping } from './shipping';
import { ShippingCountry } from './shipping-country/shipping-country';

export default [
	{
		path: '',
		component: Shipping,
	},
	{
		path: 'edit/:id',
		component: ShippingCountry,
	},
] as Routes;
