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
		// Postings and Convert brief AC2 (owner-approved 2026-11-24).
		path: 'company/convert',
		loadComponent: () => import('./company/convert-page').then((m) => m.ConvertPage),
	},
	{
		// Accounts brief J2, G1, G2 (owner-approved 2026-11-23).
		path: 'gst-registrations',
		loadComponent: () => import('./company/gst-registrations').then((m) => m.GstRegistrationsSettings),
	},
	{
		// Accounts templates AT2 (owner-approved 2026-11-24).
		path: 'accounts-templates',
		loadComponent: () =>
			import('./accounts-templates/accounts-templates-page').then((m) => m.AccountsTemplatesPage),
	},
	{
		// Accounts templates AT4: roles in this company's books (owner-approved 2026-11-24).
		path: 'accounts-templates/roles',
		loadComponent: () => import('./accounts-templates/roles-page').then((m) => m.RolesPage),
	},
	{
		// Accounts templates AT3: one template, the chart builder (owner-approved 2026-11-24).
		path: 'accounts-templates/:code',
		loadComponent: () => import('./accounts-templates/template-builder').then((m) => m.TemplateBuilderPage),
	},
	{
		// Accounts brief M2 (owner-approved 2026-11-23).
		path: 'order-routing',
		loadComponent: () => import('./order-routing/order-routing').then((m) => m.OrderRoutingPage),
	},
	{
		// Accounts brief K1 (owner-approved 2026-11-23).
		path: 'locations',
		loadComponent: () => import('./locations/locations-list').then((m) => m.LocationsListPage),
	},
	{
		// Accounts brief K2: 'new' or a location id.
		path: 'locations/:id',
		loadComponent: () => import('./locations/location-form').then((m) => m.LocationFormPage),
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
