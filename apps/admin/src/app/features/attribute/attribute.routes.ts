import { Routes } from '@angular/router';

import { Attribute } from './attribute';
import { CreateAttribute } from './create-attribute/create-attribute';
import { EditAttribute } from './edit-attribute/edit-attribute';

export default [
	{
		path: '',
		component: Attribute,
	},
	{
		path: 'create',
		component: CreateAttribute,
	},
	{
		path: 'edit/:id',
		component: EditAttribute,
	},
] as Routes;
