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
		path: 'image-profiles',
		loadComponent: () => import('./image-profiles/image-profiles').then((m) => m.ImageProfilesSettings),
	},
	{
		path: 'image-profiles/create',
		loadComponent: () =>
			import('./image-profiles/image-profile-form/image-profile-form').then((m) => m.ImageProfileForm),
	},
	{
		path: 'image-profiles/edit/:key',
		loadComponent: () =>
			import('./image-profiles/image-profile-form/image-profile-form').then((m) => m.ImageProfileForm),
	},
	{
		path: 'communications',
		loadComponent: () => import('./communications/communications').then((m) => m.CommunicationsSettings),
	},
	{
		path: 'purchases',
		loadComponent: () => import('./purchases/purchase-settings').then((m) => m.PurchaseSettings),
	},
	{
		path: 'shop-details',
		loadComponent: () => import('./shop-details/shop-details').then((m) => m.ShopDetailsSettings),
	},
	{
		// Accounts brief J3 (owner-approved 2026-11-23).
		path: 'features',
		loadComponent: () => import('./company/feature-switches').then((m) => m.FeatureSwitchesSettings),
	},
	{
		path: 'document-formats',
		loadComponent: () => import('./document-formats/document-formats').then((m) => m.DocumentFormatsSettings),
	},
	{
		path: 'document-formats/:id',
		loadComponent: () => import('./document-formats/format-builder/format-builder').then((m) => m.FormatBuilder),
	},
	{
		path: 'notifications',
		loadComponent: () =>
			import('./notification-settings/notification-settings').then((m) => m.NotificationSettings),
	},
] as Routes;
