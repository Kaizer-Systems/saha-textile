import { Routes } from '@angular/router';

import { CreateCustomer } from './create-customer/create-customer';
import { Customer } from './customer';
import { EditCustomer } from './edit-customer/edit-customer';

export default [
	{
		path: '',
		component: Customer,
	},
	{
		path: 'create',
		component: CreateCustomer,
	},
	{
		path: 'edit/:id',
		component: EditCustomer,
	},
] as Routes;
