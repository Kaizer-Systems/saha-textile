import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, signal } from '@angular/core';

import { STEP_ICONS, iconUrl } from './vendor-logo';

import type { PipelineStage } from '@saha-textile/release-console-contracts';

/**
 * Icons for menus, pages, tabs, panels and stages. Like the provider logos, nothing is stored: each
 * is an Iconify image (https://api.iconify.design) that the browser loads and caches. An icon is
 * painted in the colour of its text through a CSS mask, so it dims, lights and turns green or red
 * with the item it belongs to. Offline, the icon is simply not drawn.
 */
@Component({
	selector: 'rc-icon',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		class: 'rc-icon',
		'aria-hidden': 'true',
		'[class.flush]': 'flush()',
		'[style.--rc-icon]': 'mask()',
		'[style.width.px]': 'size()',
		'[style.height.px]': 'size()',
	},
	template: '',
})
export class Icon {
	/** `set/name`, for example `tabler/rocket`. */
	readonly name = input.required<string>();
	/** Pixels; by default the icon follows the text size. */
	readonly size = input<number | null>(null);
	/** No space after the icon (inside a row that already spaces its items). */
	readonly flush = input(false, { transform: booleanAttribute });
	protected readonly mask = computed(() => `url("https://api.iconify.design/${this.name()}.svg")`);
}

/**
 * A product's own logo in its colours (Docker, MongoDB, Redis…), optionally followed by a label;
 * the label stands alone when the logo cannot load.
 */
@Component({
	selector: 'rc-brand-logo',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'rc-vlogo', '[class.bare]': '!label()' },
	template: `
		@if (!failed()) {
			<img
				[src]="src()"
				[attr.height]="size()"
				alt=""
				referrerpolicy="no-referrer"
				(error)="failed.set(true)"
			/>
		}
		@if (label()) {
			<span>{{ label() }}</span>
		}
	`,
})
export class BrandLogo {
	readonly name = input.required<string>();
	readonly label = input('');
	readonly size = input(16);
	readonly color = input<string | undefined>(undefined);
	protected readonly failed = signal(false);
	/** One-colour logos (Simple Icons) are drawn light so they show on the dark console. */
	protected readonly src = computed(() =>
		iconUrl(
			this.name(),
			this.size(),
			this.color() ?? (this.name().startsWith('simple-icons/') ? '#d9f4ff' : undefined),
		),
	);
}

/** Console-level menus. */
export const CONSOLE_PAGE_ICONS: Record<string, string> = {
	projects: 'tabler/layout-grid',
	add: 'tabler/square-rounded-plus',
	attention: 'tabler/bell-ringing',
	audit: 'tabler/history',
	settings: 'tabler/settings',
};

/** Project-level menus. */
export const PROJECT_PAGE_ICONS: Record<string, string> = {
	overview: 'tabler/layout-dashboard',
	repositories: 'tabler/brand-git',
	environments: 'tabler/stack-2',
	attention: 'tabler/bell-ringing',
	audit: 'tabler/history',
	settings: 'tabler/adjustments-horizontal',
};

/** Project settings tabs. */
export const SETTINGS_TAB_ICONS: Record<string, string> = {
	connections: 'tabler/plug-connected',
	repositories: 'tabler/brand-git',
	environments: 'tabler/stack-2',
	menus: 'tabler/list-details',
	remove: 'tabler/trash',
};

/** Repository menu groups; cloud, edge and secrets groups show their provider's logo instead. */
export const GROUP_ICONS: Record<string, string> = {
	Ship: 'tabler/rocket',
	Watch: 'tabler/eye',
	Run: 'tabler/player-play',
	Shop: 'tabler/building-store',
	Governance: 'tabler/shield-check',
};
/** The group of a repository's own menus. */
export const OWN_GROUP_ICON = 'tabler/puzzle';

/** Every repository screen, by its key. */
export const SCREEN_ICONS: Record<string, string> = {
	overview: 'tabler/layout-dashboard',
	settings: 'tabler/settings',
	// Ship
	pulls: 'tabler/git-pull-request',
	pipeline: 'tabler/route-2',
	logs: 'tabler/file-text',
	approvals: 'tabler/circle-check',
	deploy: 'tabler/rocket',
	steps: 'tabler/list-numbers',
	changes: 'tabler/git-compare',
	impact: 'tabler/chart-line',
	rollback: 'tabler/arrow-back-up',
	calendar: 'tabler/calendar',
	rehearsal: 'tabler/repeat',
	loadtest: 'tabler/gauge',
	images: 'tabler/box',
	deps: 'tabler/packages',
	// Watch
	issues: 'tabler/bug',
	alerts: 'tabler/alert-triangle',
	incident: 'tabler/urgent',
	apm: 'tabler/activity',
	traces: 'tabler/timeline',
	queries: 'tabler/database-search',
	rum: 'tabler/mood-smile',
	health: 'tabler/heartbeat',
	uptime: 'tabler/clock-check',
	slo: 'tabler/target',
	dashboards: 'tabler/layout-dashboard',
	// Run
	services: 'tabler/apps',
	processes: 'tabler/binary-tree',
	infra: 'tabler/topology-star-3',
	server: 'tabler/device-desktop',
	terminal: 'tabler/terminal-2',
	tail: 'tabler/logs',
	network: 'tabler/network',
	cdn: 'tabler/world-bolt',
	database: 'tabler/database',
	search: 'tabler/search',
	media: 'tabler/photo',
	queues: 'tabler/stack-push',
	cron: 'tabler/clock-hour-4',
	flags: 'tabler/toggle-right',
	secrets: 'tabler/key',
	drift: 'tabler/arrows-diff',
	// DigitalOcean
	droplets: 'tabler/droplet',
	doautoscale: 'tabler/arrows-maximize',
	kubernetes: 'tabler/steering-wheel',
	apps: 'tabler/apps',
	functions: 'tabler/math-function',
	spaces: 'tabler/bucket',
	volumes: 'tabler/cylinder',
	nfs: 'tabler/folders',
	dobackups: 'tabler/device-floppy',
	databases: 'tabler/database',
	registry: 'tabler/container',
	cloudnet: 'tabler/network',
	donetadv: 'tabler/arrows-exchange',
	loadbalancers: 'tabler/scale',
	dodns: 'tabler/world-www',
	certificates: 'tabler/certificate',
	inference: 'tabler/brain',
	domonitoring: 'tabler/chart-area-line',
	dosecrets: 'tabler/key',
	security: 'tabler/shield-lock',
	doaccount: 'tabler/user-circle',
	doteam: 'tabler/users',
	dosupport: 'tabler/lifebuoy',
	// Cloudflare
	cfhome: 'tabler/home',
	cforgs: 'tabler/building',
	cfprofile: 'tabler/user',
	cfdomains: 'tabler/world',
	cfbuild: 'tabler/hammer',
	cfprotect: 'tabler/shield',
	cfzt: 'tabler/lock-access',
	cfdev: 'tabler/code',
	cfaccount: 'tabler/settings',
	cfoverview: 'tabler/layout-dashboard',
	cfaicrawl: 'tabler/robot',
	cfagent: 'tabler/robot-face',
	cfanalytics: 'tabler/chart-bar',
	cfobs: 'tabler/eye',
	dns: 'tabler/world-www',
	cfemail: 'tabler/mail',
	cfssl: 'tabler/lock',
	cfwaf: 'tabler/shield-check',
	cfbots: 'tabler/shield-cog',
	cfaccess: 'tabler/door-enter',
	cfspeed: 'tabler/bolt',
	cfcache: 'tabler/database-export',
	cfroutes: 'tabler/route',
	cfrules: 'tabler/filter',
	cferror: 'tabler/error-404',
	cfnetwork: 'tabler/network',
	cftraffic: 'tabler/traffic-lights',
	cfweb3: 'tabler/currency-ethereum',
	// Shop
	payments: 'tabler/credit-card',
	messages: 'tabler/message',
	clients: 'tabler/devices',
	seo: 'tabler/world-search',
	// Governance
	access: 'tabler/users',
	audit: 'tabler/history',
	privacy: 'tabler/eye-off',
	costs: 'tabler/coin',
	domains: 'tabler/at',
};

/** A screen's icon; screens without one (a provider's "screens later") get a generic mark. */
export const screenIcon = (key: string): string => SCREEN_ICONS[key] ?? 'tabler/circle-dashed';

const ENVIRONMENT_ICONS = ['tabler/device-laptop', 'tabler/world', 'tabler/flask', 'tabler/server'] as const;

/** An environment's icon: this computer, a staging copy, production, or another server. */
export function environmentIcon(name: string, onThisComputer: boolean): string {
	const [here, production, staging, server] = ENVIRONMENT_ICONS;
	if (onThisComputer) return here;
	if (/prod/i.test(name)) return production;
	if (/stag|test|qa|preview/i.test(name)) return staging;
	return server;
}

/** The local pipeline's stages. */
export const STAGE_ICONS: Record<PipelineStage, string> = {
	checks: 'tabler/list-check',
	proof: 'tabler/test-pipe',
	images: 'tabler/brand-docker',
	release: 'tabler/package',
	deploy: 'tabler/rocket',
	record: 'tabler/notebook',
};

/** The product a container or service runs, by its name, as a logo in its own colours. */
export function serviceLogo(name: string): string {
	const n = name.toLowerCase();
	if (n.includes('mongo')) return 'logos/mongodb-icon';
	if (n.includes('redis')) return 'logos/redis';
	if (n.includes('meili') || n.includes('search')) return 'logos/meilisearch';
	if (n.includes('edge') || n.includes('nginx')) return 'logos/nginx';
	if (n.includes('worker')) return 'logos/nodejs-icon';
	if (n.includes('api')) return 'logos/nestjs';
	if (n.includes('storefront') || n.includes('admin') || n.includes('shop')) return 'logos/angular-icon';
	return 'logos/docker-icon';
}

/** Icons named in templates rather than in the maps above (kept whole by a test). */
export const INLINE_ICONS = [
	'tabler/send',
	'tabler/versions',
	'tabler/arrows-exchange',
	'tabler/file-x',
	'tabler/world-search',
	'tabler/adjustments-horizontal',
	'tabler/git-branch',
	'tabler/sitemap',
	'tabler/receipt',
	'tabler/certificate',
	'tabler/shield-check',
	'tabler/git-compare',
	'tabler/refresh',
	'tabler/external-link',
	'tabler/x',
	'tabler/user-check',
	'tabler/bell-ringing',
	'tabler/brand-docker',
	'tabler/brand-git',
	'tabler/briefcase',
	'tabler/chart-line',
	'tabler/circle',
	'tabler/circle-check',
	'tabler/clock',
	'tabler/cloud',
	'tabler/coin',
	'tabler/cpu',
	'tabler/device-floppy',
	'tabler/device-laptop',
	'tabler/device-sd-card',
	'tabler/dialpad',
	'tabler/download',
	'tabler/droplet',
	'tabler/file-certificate',
	'tabler/folder',
	'tabler/folders',
	'tabler/gauge',
	'tabler/heart-broken',
	'tabler/heartbeat',
	'tabler/history',
	'tabler/key',
	'tabler/layout-dashboard',
	'tabler/layout-grid',
	'tabler/link',
	'tabler/list',
	'tabler/list-details',
	'tabler/lock',
	'tabler/logs',
	'tabler/password',
	'tabler/pencil',
	'tabler/player-play',
	'tabler/plug-connected',
	'tabler/receipt',
	'tabler/rocket',
	'tabler/route',
	'tabler/route-2',
	'tabler/server',
	'tabler/server-2',
	'tabler/settings',
	'tabler/square-rounded-plus',
	'tabler/stack-2',
	'tabler/target',
	'tabler/terminal-2',
	'tabler/trash',
	'tabler/upload',
	'tabler/users',
	'tabler/world',
	'tabler/world-www',
];

/** Every one-colour icon the console can show. */
export const ALL_ICONS: string[] = [
	...new Set([
		...Object.values(CONSOLE_PAGE_ICONS),
		...Object.values(PROJECT_PAGE_ICONS),
		...Object.values(SETTINGS_TAB_ICONS),
		...Object.values(GROUP_ICONS),
		OWN_GROUP_ICON,
		...Object.values(SCREEN_ICONS),
		'tabler/circle-dashed',
		...ENVIRONMENT_ICONS,
		...Object.values(STAGE_ICONS),
		...STEP_ICONS,
		...INLINE_ICONS,
	]),
];

/**
 * Fetches every icon once, quietly, while the lock screen shows, so menus and screens open with
 * their icons already in the browser's cache (Iconify keeps them for a week) instead of popping in.
 */
export function warmIcons(): void {
	if (typeof fetch !== 'function') return;
	for (const name of ALL_ICONS)
		void fetch(`https://api.iconify.design/${name}.svg`, { mode: 'cors', priority: 'low' } as RequestInit).catch(
			() => undefined,
		);
}
