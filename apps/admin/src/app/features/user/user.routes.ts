import { Routes } from '@angular/router';

import { CreateUser } from './create-user/create-user';
import { EditUser } from './edit-user/edit-user';
import { User } from './user';

export default [
	{
		path: '',
		component: User,
	},
	{
		path: 'create',
		component: CreateUser,
	},
	{
		path: 'edit/:id',
		component: EditUser,
	},
] as Routes;
