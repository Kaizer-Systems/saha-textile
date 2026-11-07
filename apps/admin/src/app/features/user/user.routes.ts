import { Routes } from '@angular/router';

import { CreateAdminUser } from './create-user/create-user';
import { EditAdminUser } from './edit-user/edit-user';
import { AdminUsers } from './user';

export default [
	{
		path: '',
		component: AdminUsers,
	},
	{
		path: 'create',
		component: CreateAdminUser,
	},
	{
		path: 'edit/:id',
		component: EditAdminUser,
	},
] as Routes;
