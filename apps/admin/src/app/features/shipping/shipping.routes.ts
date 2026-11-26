import { Routes } from '@angular/router';

import { Shipping } from './shipping';
import { ShippingCountry } from './shipping-country/shipping-country';

/**
 * Admin › Shipping (brief approved 2026-11-19). The theme's country list and country page stay
 * reachable under `countries`; they are on the end-of-project cleanup list, replaced by these pages.
 */
export default [
	{
		path: '',
		loadComponent: () => import('./overview/shipping-overview').then((m) => m.ShippingOverview),
	},
	{
		path: 'rule-sets',
		loadComponent: () => import('./rule-sets/rule-sets').then((m) => m.ShippingRuleSets),
	},
	{
		path: 'rule-sets/new',
		loadComponent: () => import('./rule-sets/new-rule-set').then((m) => m.NewRuleSet),
	},
	{
		path: 'rule-sets/:id',
		loadComponent: () => import('./builder/rule-builder').then((m) => m.RuleBuilder),
	},
	{
		path: 'where-rules-apply',
		loadComponent: () => import('./where-rules-apply/where-rules-apply').then((m) => m.WhereRulesApply),
	},
	{
		path: 'couriers',
		loadComponent: () => import('./couriers/couriers').then((m) => m.ShippingCouriers),
	},
	{
		path: 'orders-abroad',
		loadComponent: () => import('./orders-abroad/orders-abroad').then((m) => m.OrdersAbroad),
	},
	{
		path: 'countries',
		component: Shipping,
	},
	{
		path: 'edit/:id',
		component: ShippingCountry,
	},
] as Routes;
