import { Routes } from '@angular/router';

import { CreateStore } from './create-store/create-store';
import { EditStore } from './edit-store/edit-store';
import { Stores } from './stores';

export default [
	{
		path: '',
		component: Stores,
	},
	{
		path: 'create',
		component: CreateStore,
	},
	{
		path: 'edit/:id',
		component: EditStore,
	},
] as Routes;
