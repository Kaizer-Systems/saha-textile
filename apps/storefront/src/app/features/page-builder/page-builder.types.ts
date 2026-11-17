import type { ResolvedBanner } from '@data-access/queries/banner.queries';

/**
 * `StorefrontPageLayout` from `@saha-textile/contracts`, as the shop reads it (the shop declares the API's shapes
 * itself rather than depending on the contracts package).
 */
export interface ResolvedPiecePictureView extends ResolvedBanner {
	spot: string;
	ink: 'brand' | 'brand_dark' | 'ink' | 'white';
	backing: 'none' | 'soft_light' | 'soft_dark';
	decorative: boolean;
}

export interface ResolvedPieceView {
	name: string;
	pictures: ResolvedPiecePictureView[];
	slider: { seconds: number; controls: 'bottom_center' | 'bottom_start' | 'bottom_end'; after: 'loop' | 'stop' };
}

export type SectionTypeView =
	| 'banner_arrangement'
	| 'promo_banners'
	| 'product_row'
	| 'recently_viewed'
	| 'youtube_videos'
	| 'blog_posts'
	| 'newsletter';

export interface ResolvedPageSectionView {
	id: string;
	type: SectionTypeView;
	look: {
		spaceAbove: 'none' | 's' | 'm' | 'l' | 'xl';
		spaceBelow: 'none' | 's' | 'm' | 'l' | 'xl';
		width: 'page' | 'full' | 'narrow';
		align: 'start' | 'center' | 'end';
		background: 'none' | 'soft' | 'brand_tint' | 'dark';
	};
	screens: { phone: boolean; tablet: boolean; computer: boolean };
	arrangement: 'hero_full' | 'hero_main_side' | 'hero_main_stack' | 'hero_center_sides' | null;
	phoneSides: 'below_side_by_side' | 'main_only' | 'swipe_row' | null;
	pieces: ResolvedPieceView[];
	title: string | null;
	description: string | null;
	subtitle: string | null;
	source: 'new_arrivals' | 'bestsellers' | 'on_sale' | 'featured' | 'category' | 'tag' | 'picked' | null;
	sourceIds: string[];
	cards: number | null;
	leaveOutSoldOut: boolean | null;
}

export interface StorefrontPageLayoutView {
	pageType: string;
	revisionId: string | null;
	sections: ResolvedPageSectionView[];
	refreshAt: string | null;
}

const SPACE: Record<ResolvedPageSectionView['look']['spaceBelow'], string> = {
	none: '0',
	s: '2',
	m: '4',
	l: '5',
	xl: '5',
};

/**
 * A section's outer classes from its fixed steps (SG-3): which screen bands draw it (phone below 768 px, tablet to
 * 1199 px, computer from 1200 px; Bootstrap's md and xl), and its space above and below. Only named classes, so
 * the server knows every box before it draws.
 */
export function sectionClasses(section: ResolvedPageSectionView): string {
	const { phone, tablet, computer } = section.screens;
	const show = (on: boolean) => (on ? 'block' : 'none');
	// Display classes only when a band is switched off; every band on draws as any block does.
	const classes =
		phone && tablet && computer ? [] : [`d-${show(phone)}`, `d-md-${show(tablet)}`, `d-xl-${show(computer)}`];
	classes.push(`pt-${SPACE[section.look.spaceAbove]}`, `pb-${SPACE[section.look.spaceBelow]}`);
	if (section.look.spaceBelow === 'xl') classes.push('mb-5');
	if (section.look.spaceAbove === 'xl') classes.push('mt-5');
	return classes.join(' ');
}

/** The container a section's width step asks for. */
export function sectionContainer(section: ResolvedPageSectionView): string {
	return { page: 'container-fluid-lg', full: 'container-fluid px-0', narrow: 'container' }[section.look.width];
}
