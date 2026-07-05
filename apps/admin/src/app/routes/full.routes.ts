import { Routes } from '@angular/router';

export const full: Routes = [
	{
		path: 'error',
		loadChildren: () => import('@features/errors/errors.routes'),
	},
	{
		path: 'auth',
		loadChildren: () => import('@features/auth/auth.routes'),
	},
];
