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
		// Accounts brief J1 and addendum CT1–CT6 (owner-approved 2026-11-23).
		path: 'company',
		loadComponent: () => import('./company/company-profile').then((m) => m.CompanyProfileSettings),
	},
	{
		// Accounts brief J2, G1, G2 (owner-approved 2026-11-23).
		path: 'gst-registrations',
		loadComponent: () => import('./company/gst-registrations').then((m) => m.GstRegistrationsSettings),
	},
	{
		// Accounts brief addendum 2, EI1–EI2 (owner-approved 2026-11-23, AE1–AE9).
		path: 'edocs',
		loadComponent: () => import('./edocs/edoc-settings').then((m) => m.EDocSettingsPage),
	},
	{
		// Addendum 2, EI14.
		path: 'edocs/activity',
		loadComponent: () => import('./edocs/edoc-activity').then((m) => m.EDocActivityPage),
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
