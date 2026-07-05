import { Routes } from '@angular/router';

import { CreateRole } from './create-role/create-role';
import { EditRole } from './edit-role/edit-role';
import { Role } from './role';

export default [
	{
		path: '',
		component: Role,
	},
	{
		path: 'create',
		component: CreateRole,
	},
	{
		path: 'edit/:id',
		component: EditRole,
	},
] as Routes;
