import type { PageTypeKind, SectionType } from '@saha-textile/contracts';

/**
 * Page types are registered, not built (Page Builder brief PG-4): a type names its address, its slots and the
 * section types each slot takes, where its one main heading comes from, and its budget. Layouts, revisions,
 * schedules, checks and screens are shared by every type.
 */
export interface PageBudget {
	/** Pictures asked for before the page draws: one per screen band, a real picture in the HTML (FX-13). */
	readonly earlyPicturesPerBand: number;
	/** Builder code at first load, KB compressed. */
	readonly firstLoadCodeKb: number;
	/** Header, footer, data copy and the rest of the page around the sections, KB compressed (baseline). */
	readonly surroundHtmlKb: number;
	/**
	 * The page's HTML in section allowances (KB, each section at its budget, plus the surround): Go Live waits above
	 * it (SG-9, Q15 A). Allowances are ceilings, well above what sections really send.
	 */
	readonly pageHtmlKb: number;
}

export interface PageTypeRules {
	readonly key: string;
	readonly kind: PageTypeKind;
	/** Slots and the section types each takes, in the order the outline lists them. */
	readonly slots: Readonly<Record<string, readonly SectionType[]>>;
	/** Home's H1 comes from Page settings; listing and item pages use the item's own name. */
	readonly mainHeading: 'page_settings' | 'item_name';
	readonly indexable: boolean;
	readonly budget: PageBudget;
}

const HOME: PageTypeRules = {
	key: 'home',
	kind: 'whole_page',
	slots: {
		main: [
			'banner_arrangement',
			'promo_banners',
			'product_row',
			'recently_viewed',
			'youtube_videos',
			'blog_posts',
			'newsletter',
		],
	},
	mainHeading: 'page_settings',
	indexable: true,
	// 17 Nov baseline (production build, brotli): the home page is 27–30 KB, of which about 16 KB is not sections.
	// "Today's home page" comes to about 83 KB in section allowances (the brief's ceilings, roughly 2.8 times what
	// its sections really send); 100 leaves room for one more product row and a promo pair, never a second page.
	budget: { earlyPicturesPerBand: 1, firstLoadCodeKb: 10, surroundHtmlKb: 16, pageHtmlKb: 100 },
};

const REGISTRY = new Map<string, PageTypeRules>([[HOME.key, HOME]]);

/**
 * Registers a page type: its address rules, slots, heading and budget. Everything else (store, API, screens, checks,
 * schedules, permission) is shared, which is what the test-only page type proves (PG-8). Answers a function that
 * takes it off again. A key already registered is refused.
 */
export function registerPageType(rules: PageTypeRules): () => void {
	if (REGISTRY.has(rules.key)) throw new Error(`Page type ${rules.key} is already registered`);
	REGISTRY.set(rules.key, rules);
	return () => void REGISTRY.delete(rules.key);
}

/** The rules of a registered page type, or null for an unknown key. */
export function pageTypeRules(key: string): PageTypeRules | null {
	return REGISTRY.get(key) ?? null;
}

/** Every registered page type, Home first. */
export function registeredPageTypes(): readonly PageTypeRules[] {
	return [...REGISTRY.values()];
}

/** Whether a slot of a page type takes a section type. */
export function sectionAllowed(rules: PageTypeRules, slot: string, type: SectionType): boolean {
	return rules.slots[slot]?.includes(type) ?? false;
}
