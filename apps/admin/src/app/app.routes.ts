import { Routes } from '@angular/router';

import { AuthGuard } from '@core/guards/auth.guard';

import { content } from './routes/content.routes';
import { full } from './routes/full.routes';

export const routes: Routes = [
	{
		path: '',
		redirectTo: 'auth/login',
		pathMatch: 'full',
	},
	{
		path: 'auth',
		loadChildren: () => import('@features/auth/auth.routes'),
		canActivateChild: [AuthGuard],
	},
	{
		path: '',
		loadComponent: () => import('@layout/content/content').then((m) => m.Content),
		children: content,
	},
	{
		path: '',
		loadComponent: () => import('@layout/full/full').then((m) => m.Full),
		children: full,
	},
	{
		path: '**',
		pathMatch: 'full',
		loadComponent: () => import('@features/errors/error404/error404').then((m) => m.Error404),
	},
];
