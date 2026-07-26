import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/angular';
import webpack from 'webpack';

process.env.STORYBOOK_DISABLE_TELEMETRY = '1';

const storybookRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(storybookRoot, '../..');

const applicationSourceRoots = {
	storefront: path.join(repositoryRoot, 'apps/storefront/src/app'),
	admin: path.join(repositoryRoot, 'apps/admin/src/app'),
} as const;

const applicationAliases = new Set(['core', 'data-access', 'features', 'layout', 'shared']);
const storybookStateShims = new Map([
	['@core/state/account.store', path.join(storybookRoot, 'src/type-shims/core/state/account.store.ts')],
	['@core/state/loader.store', path.join(storybookRoot, 'src/type-shims/core/state/loader.store.ts')],
	['@core/state/menu.store', path.join(storybookRoot, 'src/type-shims/core/state/menu.store.ts')],
	['@core/state/setting.store', path.join(storybookRoot, 'src/type-shims/core/state/setting.store.ts')],
	[
		'@data-access/queries/notification.queries',
		path.join(storybookRoot, 'src/type-shims/data-access/queries/notification.queries.ts'),
	],
	[
		'@data-access/queries/product.queries',
		path.join(storybookRoot, 'src/type-shims/data-access/queries/product.queries.ts'),
	],
	[
		'@data-access/queries/blog.queries',
		path.join(storybookRoot, 'src/type-shims/data-access/queries/blog.queries.ts'),
	],
	[
		'@data-access/queries/category.queries',
		path.join(storybookRoot, 'src/type-shims/data-access/queries/category.queries.ts'),
	],
]);
const { NormalModuleReplacementPlugin } = webpack;

function resolveApplicationAlias(resource: { context: string; request: string; contextInfo?: { issuer?: string } }) {
	const stateShim = storybookStateShims.get(resource.request);
	if (stateShim) {
		resource.request = stateShim;
		return;
	}

	const match = resource.request.match(/^@([^/]+)\/(.+)$/);
	if (!match || !applicationAliases.has(match[1])) {
		return;
	}

	const issuer = resource.contextInfo?.issuer ?? resource.context;
	const application = issuer.includes('/apps/admin/')
		? 'admin'
		: issuer.includes('/apps/storefront/')
			? 'storefront'
			: null;
	if (!application) {
		return;
	}

	resource.request = path.join(applicationSourceRoots[application], match[1], match[2]);
}

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|mdx)'],
	staticDirs: [
		{ from: '../.generated', to: '/portal-application-styles' },
		{ from: '../../storefront/public', to: '/' },
		{ from: '../../admin/public', to: '/admin-assets' },
	],
	addons: ['@storybook/addon-docs'],
	framework: {
		name: '@storybook/angular',
		options: {},
	},
	core: {
		disableTelemetry: true,
	},
	webpackFinal: async (webpackConfig) => {
		webpackConfig.plugins = webpackConfig.plugins ?? [];
		webpackConfig.plugins.push(
			new NormalModuleReplacementPlugin(/^@(core|data-access|features|layout|shared)\//, resolveApplicationAlias),
		);
		return webpackConfig;
	},
};

export default config;
