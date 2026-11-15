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
		path: 'stores',
		loadComponent: () => import('./stores/stores').then((m) => m.StoresSettings),
	},
	{
		path: 'stores/create',
		loadComponent: () =>
			import('./stores/form-store-location/form-store-location').then((m) => m.FormStoreLocation),
	},
	{
		path: 'stores/edit/:id',
		loadComponent: () =>
			import('./stores/form-store-location/form-store-location').then((m) => m.FormStoreLocation),
	},
	{
		path: 'mailboxes',
		loadComponent: () => import('./mailboxes/mailboxes').then((m) => m.MailboxesSettings),
	},
	{
		path: 'languages',
		loadComponent: () => import('./languages/languages').then((m) => m.LanguagesSettings),
	},
	{
		path: 'communications',
		loadComponent: () => import('./communications/communications').then((m) => m.CommunicationsSettings),
	},
	{
		path: 'notifications',
		loadComponent: () =>
			import('./notification-settings/notification-settings').then((m) => m.NotificationSettings),
	},
] as Routes;
