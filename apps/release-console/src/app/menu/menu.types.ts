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
	/** A plan lock on the whole screen: its badge shows until the provider says the feature is on. */
	plan?: PlanLock | null;
	/** Plan locks on single tabs. */
	planStates?: Record<string, PlanLock> | null;
}
/**
 * A paid plan or add-on a screen or tab needs (brief legend: "Plan locks keep their own badge and unlock
 * after an upgrade"); `feature` is a key of the provider's live plan answer (API cfplan › status).
 */
export interface PlanLock {
	feature: string;
	needs: string;
	tier: 'pro' | 'biz' | 'ent' | 'addon';
}
export interface ConsoleMenu {
	menu: MenuGroup[];
	aliases: Record<string, string[]>;
	later: string[];
	screens: Record<string, ScreenInfo>;
}
