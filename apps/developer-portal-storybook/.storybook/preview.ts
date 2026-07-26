import { importProvidersFrom } from '@angular/core';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { applicationConfig, type Preview } from '@storybook/angular';
import { themes } from 'storybook/theming';

import { applicationDecorator } from './decorators/application';
import { portalThemeDecorator } from './decorators/theme';
import { installPreviewExperience } from './preview-experience';

installPreviewExperience();

const preview: Preview = {
	decorators: [
		applicationConfig({
			providers: [
				importProvidersFrom(
					TranslocoTestingModule.forRoot({
						langs: {
							en: {
								fastkart: 'Saha Textile',
								loading: 'Loading interface',
								'No records found': 'No records found',
								'Product title': 'Product title',
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
