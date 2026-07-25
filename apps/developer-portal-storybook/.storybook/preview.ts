import type { Preview } from '@storybook/angular';

import { applicationDecorator } from './decorators/application';
import { portalThemeDecorator } from './decorators/theme';

const preview: Preview = {
	decorators: [portalThemeDecorator, applicationDecorator],
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
		options: {
			storySort: {
				order: ['Storefront', 'Admin', 'Shared'],
			},
		},
		layout: 'fullscreen',
	},
};

export default preview;
