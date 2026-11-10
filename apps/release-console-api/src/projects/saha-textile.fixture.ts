import type { NewProject } from '@saha-textile/release-console-contracts';

/** Test data only (left out of the build): the project as the owner adds it with the wizard. */
export const SAHA_TEXTILE: NewProject = {
	id: 'saha-textile',
	name: 'Saha Textile',
	workspace: 'Kaizer Systems',
	repositories: [
		{
			id: 'saha-textile',
			name: 'saha-textile',
			role: 'monorepo: shop, admin, API, worker',
			sourceCode: { vendor: 'github', repository: 'Kaizer-Systems/saha-textile', keyId: null },
			environments: [
				{ name: 'local', label: 'Local', cloudId: null, domains: ['localhost'] },
				{ name: 'staging', label: 'Staging', cloudId: 'digitalocean', domains: ['staging.sahatextile.com'] },
				{ name: 'production', label: 'Production', cloudId: 'digitalocean', domains: ['sahatextile.com'] },
			],
			cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
			edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['sahatextile.com'], keyIds: [] }],
			menus: ['payments', 'messages', 'clients', 'seo'],
		},
	],
};
