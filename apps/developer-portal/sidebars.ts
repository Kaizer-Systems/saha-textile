import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
	portalSidebar: [
		'intro',
		{
			type: 'category',
			label: 'Getting Started',
			items: ['getting-started/overview', 'getting-started/local-development'],
		},
		{
			type: 'category',
			label: 'System Architecture',
			items: ['architecture/system-overview', 'architecture/monorepo-map'],
		},
		{
			type: 'category',
			label: 'Business Processes',
			items: ['business-flows/overview', 'business-flows/checkout'],
		},
		{
			type: 'category',
			label: 'Storefront',
			items: ['storefront/overview'],
		},
		{
			type: 'category',
			label: 'Admin Panel',
			items: ['admin/overview'],
		},
		{
			type: 'category',
			label: 'API',
			items: ['api/overview'],
		},
		{
			type: 'category',
			label: 'Database',
			items: ['database/overview'],
		},
		{
			type: 'category',
			label: 'Deployment and Operations',
			items: ['deployment/overview', 'operations/overview'],
		},
		{
			type: 'category',
			label: 'Troubleshooting',
			items: ['troubleshooting/overview'],
		},
		{
			type: 'category',
			label: 'Architecture Decisions',
			items: ['decisions/developer-portal-now'],
		},
		{
			type: 'category',
			label: 'Maintenance and Upgrades',
			items: ['maintenance/overview'],
		},
	],
};

export default sidebars;
