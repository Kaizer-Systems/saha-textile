import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { VENDOR_NAMES, type Repository, type Vendor } from '@saha-textile/release-console-contracts';
import { describe, expect, it } from 'vitest';

import {
	ALL_ICONS,
	CONSOLE_PAGE_ICONS,
	GROUP_ICONS,
	PROJECT_PAGE_ICONS,
	SCREEN_ICONS,
	SETTINGS_TAB_ICONS,
	environmentIcon,
	screenIcon,
	serviceLogo,
} from './icons';
import { VENDOR_LOGOS } from './vendor-logo';
import { CONSOLE_MENU } from '../menu/console-menu.data';
import { repositoryMenu } from '../menu/repo-menu';
import { CONSOLE_PAGES, PROJECT_PAGES, SETTINGS_TABS } from '../shell/shell';

describe('icons', () => {
	it('gives every menu screen, page, tab and group its own icon', () => {
		const missing = Object.keys(CONSOLE_MENU.screens).filter((k) => !SCREEN_ICONS[k]);
		expect(missing).toEqual([]);
		expect(CONSOLE_PAGES.filter(([k]) => !CONSOLE_PAGE_ICONS[k])).toEqual([]);
		expect(PROJECT_PAGES.filter(([k]) => !PROJECT_PAGE_ICONS[k])).toEqual([]);
		expect(SETTINGS_TABS.filter(([k]) => !SETTINGS_TAB_ICONS[k])).toEqual([]);
		for (const g of ['Ship', 'Watch', 'Run', 'Shop', 'Governance']) expect(GROUP_ICONS[g]).toBeTruthy();
		expect(screenIcon('later-aws')).toBe('tabler/circle-dashed');
	});

	it('uses only Iconify names, so nothing is stored with the app', () => {
		const all = [
			...Object.values(SCREEN_ICONS),
			...Object.values(CONSOLE_PAGE_ICONS),
			...Object.values(PROJECT_PAGE_ICONS),
			...Object.values(SETTINGS_TAB_ICONS),
			...Object.values(GROUP_ICONS),
			...Object.values(VENDOR_LOGOS).flatMap((l) => (l.icon ? [l.icon] : [])),
		];
		for (const name of all) expect(name).toMatch(/^(tabler|logos|simple-icons)\/[a-z0-9-]+$/);
		expect(Object.keys(VENDOR_LOGOS).sort()).toEqual(Object.keys(VENDOR_NAMES).sort());
	});

	it('tells environments apart: this computer, staging, production, another server', () => {
		expect(environmentIcon('local', true)).toBe('tabler/device-laptop');
		expect(environmentIcon('staging', false)).toBe('tabler/flask');
		expect(environmentIcon('production', false)).toBe('tabler/world');
		expect(environmentIcon('eu-mirror', false)).toBe('tabler/server');
	});

	it('shows the product each container runs', () => {
		expect(serviceLogo('saha-textile-stack-mongo-1')).toBe('logos/mongodb-icon');
		expect(serviceLogo('saha-textile-stack-api-1')).toBe('logos/nestjs');
		expect(serviceLogo('saha-textile-stack-worker-1')).toBe('logos/nodejs-icon');
		expect(serviceLogo('saha-textile-search')).toBe('logos/meilisearch');
		expect(serviceLogo('something-else')).toBe('logos/docker-icon');
	});

	it('marks cloud, edge and secrets groups with their provider', () => {
		const repo: Repository = {
			id: 'shop',
			name: 'shop',
			role: '',
			sourceCode: { vendor: 'github', repository: 'acme/shop', keyId: null },
			environments: [],
			cloud: [{ id: 'aws', vendor: 'aws', account: '', keyIds: [] }],
			edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: [] }],
			secrets: [{ id: 'doppler', vendor: 'doppler', address: '', keyIds: [] }],
			menus: ['payments'],
		};
		const groups = repositoryMenu(repo).menu;
		const vendorOf = (label: string): Vendor | undefined => groups.find((g) => g.label === label)?.vendor;
		expect(vendorOf('Cloud · AWS')).toBe('aws');
		expect(vendorOf('Edge · Cloudflare')).toBe('cloudflare');
		expect(vendorOf('Secrets · Doppler')).toBe('doppler');
		expect(groups[0]?.own).toBe(true);
	});

	it('fetches every icon a template names when the console opens', () => {
		const root = join(process.cwd(), 'src', 'app');
		const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
			(f) => (f.endsWith('.ts') || f.endsWith('.html')) && !f.endsWith('.spec.ts'),
		);
		const named = new Set(
			files.flatMap((f) =>
				[...readFileSync(join(root, f), 'utf8').matchAll(/tabler\/[a-z0-9-]+/g)].map((m) => m[0]),
			),
		);
		expect([...named].filter((n) => !ALL_ICONS.includes(n))).toEqual([]);
	});
});
