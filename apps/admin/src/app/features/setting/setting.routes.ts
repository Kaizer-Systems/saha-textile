import { Routes } from '@angular/router';

import { Setting } from './setting';

export default [
	{
		path: '',
		component: Setting,
	},
	{
		path: 'brand',
		loadComponent: () => import('./brand-kit/brand-kit').then((m) => m.BrandKit),
	},
	{
		path: 'notifications',
		loadComponent: () =>
			import('./notification-settings/notification-settings').then((m) => m.NotificationSettings),
	},
] as Routes;
