import type { Vendor } from '@saha-textile/release-console-contracts';

export interface MenuSub {
	label: string | null;
	items: string[];
}
export interface MenuGroup {
	label: string;
	subs: MenuSub[];
	/** The provider of a cloud, edge or secrets group, shown as its logo. */
	vendor?: Vendor;
	/** The group of the repository's own menus. */
	own?: boolean;
}
export interface ScreenInfo {
	label: string;
	states: Record<string, string>;
	off: boolean;
	tip: string | null;
	part: string | null;
	offStates: Record<string, string> | null;
	partStates: Record<string, string> | null;
	captions: Record<string, string>;
}
export interface ConsoleMenu {
	menu: MenuGroup[];
	aliases: Record<string, string[]>;
	later: string[];
	screens: Record<string, ScreenInfo>;
}
