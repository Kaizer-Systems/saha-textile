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
				{
					name: 'local',
					label: 'Local',
					cloudId: null,
					domains: ['localhost'],
					secretsId: null,
					secretsPath: '',
					branch: '',
				},
				{
					name: 'staging',
					label: 'Staging',
					cloudId: 'digitalocean',
					domains: ['staging.sahatextile.com'],
					secretsId: null,
					secretsPath: '',
					branch: '',
				},
				{
					name: 'production',
					label: 'Production',
					cloudId: 'digitalocean',
					domains: ['sahatextile.com'],
					secretsId: null,
					secretsPath: '',
					branch: '',
				},
			],
			cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
			edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['sahatextile.com'], keyIds: [] }],
			secrets: [],
			menus: ['payments', 'messages', 'clients', 'seo'],
		},
	],
};
