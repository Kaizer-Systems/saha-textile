import { type Repository, VENDOR_NAMES, vendorScreens } from '@saha-textile/release-console-contracts';

import { CONSOLE_MENU } from './console-menu.data';

import type { ConsoleMenu, MenuGroup, ScreenInfo } from './menu.types';

const groupOf = (label: string): MenuGroup | undefined => CONSOLE_MENU.menu.find((g) => g.label === label);

/** The screen key of a cloud or edge slot whose vendor has no screens yet. */
export const laterKey = (slotId: string): string => `later-${slotId}`;

function laterScreen(
	vendorName: string,
	shows = 'Its environments, servers and costs show here once its adapter reads them.',
): ScreenInfo {
	const caption = `${vendorName} screens are built the way ${vendorName} works when this repository first needs them. ${shows}`;
	return {
		label: 'Screens later',
		states: { list: 'Screens later' },
		off: false,
		tip: null,
		part: null,
		offStates: null,
		partStates: null,
		captions: { list: caption },
	};
}

/**
 * One repository's menu: Overview, its own menus (from `.release-console.json`), Ship, Watch,
 * Run, one group per cloud slot, edge slot and secrets manager, and Governance. The screens map holds only
 * what this menu shows, so search never finds another repository's screens.
 */
export function repositoryMenu(repo: Repository): ConsoleMenu {
	const groups: MenuGroup[] = [];
	const extra: Record<string, ScreenInfo> = {};
	const own = repo.menus.filter((k) => CONSOLE_MENU.screens[k]);
	if (own.length) groups.push({ label: repo.name, subs: [{ label: 'only in this repository', items: own }] });
	for (const label of ['Ship', 'Watch', 'Run']) {
		const g = groupOf(label);
		if (g) groups.push(g);
	}
	for (const slot of repo.cloud) {
		const name = VENDOR_NAMES[slot.vendor];
		const full = slot.vendor === 'digitalocean' ? groupOf('DigitalOcean') : undefined;
		if (full && vendorScreens(slot.vendor) === 'full') groups.push({ ...full, label: `Cloud · ${name}` });
		else {
			extra[laterKey(slot.id)] = laterScreen(name);
			groups.push({ label: `Cloud · ${name}`, subs: [{ label: null, items: [laterKey(slot.id)] }] });
		}
	}
	for (const slot of repo.edge) {
		const name = VENDOR_NAMES[slot.vendor];
		const full = slot.vendor === 'cloudflare' ? groupOf('Cloudflare') : undefined;
		if (full && vendorScreens(slot.vendor) === 'full')
			groups.push({
				label: `Edge · ${name}`,
				subs: full.subs.map((s) =>
					s.label?.startsWith('Domain:') ? { ...s, label: `Domain: ${slot.zones[0] ?? 'none'} ▾` } : s,
				),
			});
		else {
			extra[laterKey(slot.id)] = laterScreen(name);
			groups.push({ label: `Edge · ${name}`, subs: [{ label: null, items: [laterKey(slot.id)] }] });
		}
	}
	for (const slot of repo.secrets) {
		const name = VENDOR_NAMES[slot.vendor];
		extra[laterKey(slot.id)] = laterScreen(
			name,
			'Each environment’s secret names, when each was last changed and which are missing show here, never their values.',
		);
		groups.push({ label: `Secrets · ${name}`, subs: [{ label: null, items: [laterKey(slot.id)] }] });
	}
	const governance = groupOf('Governance');
	if (governance) groups.push(governance);

	const keys = new Set(['overview', ...groups.flatMap((g) => g.subs.flatMap((s) => s.items))]);
	const screens: Record<string, ScreenInfo> = {};
	for (const k of keys) {
		const s = CONSOLE_MENU.screens[k] ?? extra[k];
		if (s) screens[k] = s;
	}
	const aliases = Object.fromEntries(Object.entries(CONSOLE_MENU.aliases).filter(([k]) => keys.has(k)));
	return { menu: groups, aliases, later: CONSOLE_MENU.later.filter((k) => keys.has(k)), screens };
}
