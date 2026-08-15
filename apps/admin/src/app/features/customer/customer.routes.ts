import { Routes } from '@angular/router';

import { CreateCustomer } from './create-customer/create-customer';
import { EditCustomer } from './edit-customer/edit-customer';
import { Customer } from './customer';

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
