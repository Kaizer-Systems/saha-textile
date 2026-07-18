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
					customCss: './src/css/custom.css',
				},
				sitemap: false,
			} satisfies Preset.Options,
		],
	],
	themes: ['@docusaurus/theme-mermaid'],
	themeConfig: {
		image: 'img/social-card.png',
		navbar: {
			title: 'Saha Textile Dev',
			logo: {
				alt: 'Saha Textile',
				src: 'img/logo.svg',
			},
			items: [
				{
					type: 'docSidebar',
					sidebarId: 'portalSidebar',
					position: 'left',
					label: 'Docs',
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
					title: 'Operate',
					items: [
						{ label: 'Getting Started', to: '/getting-started/overview' },
						{ label: 'Deployment', to: '/deployment/overview' },
						{ label: 'Troubleshooting', to: '/troubleshooting/overview' },
					],
				},
				{
					title: 'Build',
					items: [
						{ label: 'Architecture', to: '/architecture/system-overview' },
						{ label: 'API', to: '/api/overview' },
						{ label: 'Database', to: '/database/overview' },
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Saha Textile.`,
		},
		prism: {
			theme: require('prism-react-renderer').themes.github,
			darkTheme: require('prism-react-renderer').themes.dracula,
		},
		mermaid: {
			theme: { light: 'neutral', dark: 'forest' },
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
