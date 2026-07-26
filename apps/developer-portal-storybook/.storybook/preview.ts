import { CurrencyPipe } from '@angular/common';
import { HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component, importProvidersFrom } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { provideState, provideStore } from '@ngrx/store';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { applicationConfig, type Preview } from '@storybook/angular';
import { delay, of } from 'rxjs';
import { themes } from 'storybook/theming';

import { applicationDecorator } from './decorators/application';
import { portalThemeDecorator } from './decorators/theme';
import { installPreviewExperience } from './preview-experience';
import { CART_FEATURE_KEY } from '../../storefront/src/app/core/state/cart/cart.models';
import { cartReducer } from '../../storefront/src/app/core/state/cart/cart.reducer';
import { COMPARE_FEATURE_KEY, compareReducer } from '../../storefront/src/app/core/state/compare/compare.store';
import { WISHLIST_FEATURE_KEY, wishlistReducer } from '../../storefront/src/app/core/state/wishlist/wishlist.store';

installPreviewExperience();

@Component({
	selector: 'storybook-route-sink',
	template: '',
})
class StorybookRouteSink {}

const storybookQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: Number.POSITIVE_INFINITY,
		},
	},
});

const preview: Preview = {
	decorators: [
		applicationConfig({
			providers: [
				CurrencyPipe,
				provideNoopAnimations(),
				provideRouter([{ path: '**', component: StorybookRouteSink }], withDisabledInitialNavigation()),
				provideStore(),
				provideState(CART_FEATURE_KEY, cartReducer),
				provideState(COMPARE_FEATURE_KEY, compareReducer),
				provideState(WISHLIST_FEATURE_KEY, wishlistReducer),
				provideTanStackQuery(storybookQueryClient),
				provideHttpClient(
					withInterceptors([
						(request) =>
							of(
								new HttpResponse({
									status: 200,
									body:
										request.url.includes('country.json') || request.url.includes('state.json')
											? []
											: { data: [], total: 0 },
								}),
							).pipe(delay(0)),
					]),
				),
				importProvidersFrom(
					NgbModule,
					TranslocoTestingModule.forRoot({
						langs: {
							en: {
								addon: 'add-on',
								attributes: 'Attributes',
								attributes_display_note:
									'These details describe this product and help catalogue filtering.',
								add: 'Add',
								base: 'base',
								choose: 'Choose',
								customer_support_24_7: 'Customer support',
								download_app: 'Download the app',
								email_address: 'Email address',
								enter: 'Enter',
								fastkart: 'Saha Textile',
								fill_measurements_to_add: 'Complete the measurements before adding this configuration.',
								free: 'Free',
								in_stock: 'in stock',
								includes: 'Includes',
								loading: 'Loading interface',
								measurements: 'Measurements',
								measurements_note: 'Measurements are stored with this configured line item.',
								measurements_required: 'Measurements required',
								measurements_required_for_selection: 'Measurements required for this selection',
								'No records found': 'No records found',
								option: 'Option',
								out_of_stock: 'Out of stock',
								price: 'Price',
								'Product title': 'Product title',
								required_addon: 'Required add-on',
								select_option: 'Select option',
								stay_connected: 'Stay connected',
								sku: 'SKU',
								stock: 'Stock',
								total_price: 'Total price',
								variation: 'Variation',
							},
						},
						translocoConfig: {
							availableLangs: ['en'],
							defaultLang: 'en',
						},
						preloadLangs: true,
					}),
				),
			],
		}),
		portalThemeDecorator,
		applicationDecorator,
	],
	globalTypes: {
		portalTheme: {
			description: 'Shared developer-portal color theme',
			toolbar: {
				title: 'Portal theme',
				icon: 'contrast',
				items: [
					{ value: 'dark', title: 'Dark' },
					{ value: 'light', title: 'Light' },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: {
		portalTheme: 'dark',
	},
	parameters: {
		application: 'shared',
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		docs: {
			theme: themes.dark,
		},
		options: {
			storySort: {
				order: ['Storefront', 'Admin', 'Shared'],
			},
		},
		layout: 'fullscreen',
	},
};

export default preview;
