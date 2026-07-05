import { Routes } from '@angular/router';

import { CreateTax } from './create-tax/create-tax';
import { EditTax } from './edit-tax/edit-tax';
import { Tax } from './tax';

export default [
	{
		path: '',
		component: Tax,
	},
	{
		path: 'create',
		component: CreateTax,
	},
	{
		path: 'edit/:id',
		component: EditTax,
	},
] as Routes;
