import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
	title: 'Saha Textile Developer Portal',
	tagline: 'Private operating manual for the Saha Textile platform.',
	favicon: 'img/logo.svg',
	url: 'https://developers.sahatextile.com',
	baseUrl: '/',
	organizationName: 'Kaizer-Systems',
	projectName: 'saha-textile',
	onBrokenLinks: 'throw',
	trailingSlash: false,
	markdown: {
		mermaid: true,
		hooks: {
			onBrokenMarkdownLinks: 'warn',
		},
	},
	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},
	presets: [
		[
			'classic',
			{
				docs: {
					path: '../../docs',
					routeBasePath: '/',
					sidebarPath: './sidebars.ts',
					editUrl: undefined,
					showLastUpdateAuthor: true,
					showLastUpdateTime: true,
				},
				blog: false,
				theme: {
					customCss: [
						require.resolve('@fontsource-variable/inter/index.css'),
						require.resolve('@fontsource-variable/jetbrains-mono/index.css'),
						'./src/css/custom.css',
					],
				},
				sitemap: false,
			} satisfies Preset.Options,
		],
	],
	themes: ['@docusaurus/theme-mermaid'],
	themeConfig: {
		image: 'img/social-card.png',
		colorMode: {
			defaultMode: 'dark',
			disableSwitch: false,
			respectPrefersColorScheme: false,
		},
		docs: {
			sidebar: {
				hideable: false,
				autoCollapseCategories: false,
			},
		},
		navbar: {
			title: 'Saha Textile',
			logo: {
				alt: 'Saha Textile',
				src: 'img/logo.svg',
			},
			items: [
				{
					to: '/',
					label: 'Home',
					position: 'left',
					exact: true,
				},
				{
					to: '/getting-started/choose-your-path',
					position: 'left',
					label: 'Start here',
				},
				{
					to: '/architecture/system-overview',
					position: 'left',
					label: 'Architecture',
				},
				{
					to: '/business-flows/overview',
					position: 'left',
					label: 'Journeys',
				},
				{
					to: '/backend/overview',
					position: 'left',
					label: 'Backend',
				},
				{
					to: '/operations/overview',
					position: 'left',
					label: 'Operations',
				},
				{
					to: '/decisions/developer-portal-now',
					label: 'ADRs',
					position: 'left',
				},
			],
		},
		footer: {
			style: 'dark',
			links: [
				{
					title: 'Start',
					items: [
						{ label: 'Choose your path', to: '/getting-started/choose-your-path' },
						{ label: 'Local development', to: '/getting-started/local-development' },
					],
				},
				{
					title: 'Build',
					items: [
						{ label: 'Architecture', to: '/architecture/system-overview' },
						{ label: 'Business journeys', to: '/business-flows/overview' },
						{ label: 'Backend atlas', to: '/backend/overview' },
						{ label: 'API', to: '/api/overview' },
						{ label: 'Database', to: '/database/overview' },
					],
				},
				{
					title: 'Operate',
					items: [
						{ label: 'Deployment', to: '/deployment/overview' },
						{ label: 'Operations', to: '/operations/overview' },
						{ label: 'Troubleshooting', to: '/troubleshooting/overview' },
					],
				},
				{
					title: 'Govern',
					items: [
						{ label: 'Status model', to: '/governance/status-model' },
						{ label: 'Documentation standard', to: '/governance/contribution-standard' },
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Saha Textile. Private engineering system.`,
		},
		prism: {
			theme: require('prism-react-renderer').themes.github,
			darkTheme: require('prism-react-renderer').themes.dracula,
		},
		mermaid: {
			theme: { light: 'neutral', dark: 'dark' },
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
