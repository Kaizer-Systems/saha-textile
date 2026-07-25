import type { StorybookConfig } from '@storybook/angular';

process.env.STORYBOOK_DISABLE_TELEMETRY = '1';

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|mdx)'],
	staticDirs: [{ from: '../.generated', to: '/portal-application-styles' }],
	addons: ['@storybook/addon-docs'],
	framework: {
		name: '@storybook/angular',
		options: {},
	},
	core: {
		disableTelemetry: true,
	},
};

export default config;
