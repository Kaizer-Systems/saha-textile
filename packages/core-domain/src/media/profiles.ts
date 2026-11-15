import type {
	ImageDerivative,
	MediaAsset,
	MediaFill,
	MediaProfile,
	MediaPurpose,
	MediaVersion,
	MediaVersionId,
} from '@saha-textile/contracts';

import type { MediaProfileRepository } from '../ports/media-profile.repository';
import { MEDIA_INGEST_POLICY, aspectDeviation } from './policy';
import { SEEDED_MEDIA_ROLES } from './seeded-roles';

const MB = 1024 * 1024;
const ACCEPTS = ['image/jpeg', 'image/png'];

/** Each family's widths as the seeded ladder has them, so a profile shows and edits its own sizes (F02). */
export const seededWidths = (roles: readonly string[]): Record<string, number[]> =>
	Object.fromEntries(
		roles.flatMap((key) => {
			const role = SEEDED_MEDIA_ROLES.find((row) => row.key === key);
			return role ? [[key, [...role.widths]]] : [];
		}),
	);

const profile = (
	definition: Omit<
		MediaProfile,
		'version' | 'updatedAt' | 'maxBytes' | 'accepts' | 'enabled' | 'mainPhotoOnly' | 'widths' | 'quality'
	> &
		Partial<Pick<MediaProfile, 'mainPhotoOnly'>>,
): MediaProfile => ({
	maxBytes: 25 * MB,
	accepts: ACCEPTS,
	enabled: true,
	mainPhotoOnly: false,
	...definition,
	widths: seededWidths(definition.roles),
	quality: null,
	version: 1,
});

/**
 * The image profiles a new database starts with (Media brief F01 and the fills table, R4-1/R4-10; the owner added
 * “Banner (keep shape)” on 16 Nov 2026). Each is a bundle of today's size families (`mediaRoles`), so the files
 * a version holds are the same files the shop already reads. The smallest-photo rules are today's: a hard floor
 * for product and category photos, warnings elsewhere.
 *
 * Built-in profiles can be edited and switched off but never deleted; the others are ordinary profiles that
 * happen to be there on day one.
 */
export const SEEDED_MEDIA_PROFILES: readonly MediaProfile[] = [
	profile({
		key: 'product_3x4',
		name: 'Product 3:4',
		builtIn: true,
		shape: { width: 3, height: 4 },
		roles: ['thumb', 'card', 'gallery', 'zoom', 'swatch_image', 'swatch_image_v2'],
		fills: ['white', 'blur', 'crop'],
		minSize: { edge: 'short', px: 1600, mode: 'refuse' },
	}),
	profile({
		key: 'category_3x4',
		name: 'Category 3:4',
		builtIn: true,
		shape: { width: 3, height: 4 },
		roles: ['thumb', 'card'],
		fills: ['white', 'blur', 'crop'],
		minSize: { edge: 'short', px: 1600, mode: 'refuse' },
	}),
	profile({
		key: 'hero_21x9',
		name: 'Hero 21:9',
		builtIn: false,
		shape: { width: 21, height: 9 },
		roles: ['banner'],
		fills: ['crop', 'blur', 'colour'],
		minSize: { edge: 'width', px: 2560, mode: 'warn' },
	}),
	profile({
		key: 'hero_16x9',
		name: 'Hero 16:9',
		builtIn: false,
		shape: { width: 16, height: 9 },
		roles: ['banner'],
		fills: ['crop', 'blur', 'colour'],
		minSize: { edge: 'width', px: 1920, mode: 'warn' },
	}),
	profile({
		key: 'phone_banner_4x5',
		name: 'Phone banner 4:5',
		builtIn: false,
		shape: { width: 4, height: 5 },
		roles: ['banner'],
		fills: ['crop', 'blur'],
		minSize: { edge: 'width', px: 1080, mode: 'warn' },
	}),
	profile({
		key: 'banner_keep_shape',
		name: 'Banner (keep shape)',
		builtIn: true,
		shape: null,
		roles: ['banner'],
		fills: [],
		minSize: null,
	}),
	profile({
		key: 'blog_cover_2x1',
		name: 'Blog cover 2:1',
		builtIn: true,
		shape: { width: 2, height: 1 },
		roles: ['blog'],
		fills: ['crop', 'blur'],
		minSize: { edge: 'width', px: MEDIA_INGEST_POLICY.blogRecommendedWidth, mode: 'warn' },
	}),
	profile({
		key: 'store_photo_4x3',
		name: 'Store photo 4:3',
		builtIn: true,
		shape: { width: 4, height: 3 },
		roles: ['store_photo'],
		fills: ['crop', 'blur', 'white'],
		minSize: { edge: 'width', px: MEDIA_INGEST_POLICY.storeRecommendedWidth, mode: 'warn' },
	}),
	profile({
		key: 'square_1x1',
		name: 'Square 1:1',
		builtIn: false,
		shape: { width: 1, height: 1 },
		roles: ['avatar', 'category_icon'],
		fills: ['white', 'colour', 'crop'],
		minSize: { edge: 'short', px: 512, mode: 'warn' },
	}),
	profile({
		key: 'browser_icon_1x1',
		name: 'Browser icon 1:1',
		builtIn: true,
		shape: { width: 1, height: 1 },
		roles: ['brand_icon'],
		fills: ['white', 'brand'],
		minSize: { edge: 'short', px: 512, mode: 'warn' },
	}),
	profile({
		key: 'logo_keep_shape',
		name: 'Logo (keep shape)',
		builtIn: true,
		shape: null,
		roles: ['brand_logo'],
		fills: [],
		minSize: { edge: 'width', px: 480, mode: 'warn' },
	}),
	profile({
		key: 'link_preview',
		name: 'Link preview 1.91:1',
		builtIn: true,
		shape: { width: 1200, height: 630 },
		roles: ['share'],
		fills: ['blur'],
		minSize: { edge: 'width', px: 1200, mode: 'warn' },
		mainPhotoOnly: true,
	}),
];

/**
 * Pictures made once per photo, never per version (R4-1): the link preview, status card, feed square and email
 * picture of a product's main photo, and the shop's own link preview. Review photos stay outside profiles too.
 */
export const PER_PHOTO_ROLES: ReadonlySet<string> = new Set([
	'share',
	'story',
	'feed_square',
	'email_thumb',
	'site_share',
	'review_thumb',
	'review_full',
]);

export const versionIdOf = (profileKey: string, fill: MediaFill): MediaVersionId =>
	`${profileKey}.${fill}` as MediaVersionId;

/** The storage folder a version's new files go under: `hero-21x9-crop` (R4-1). */
export const versionFolder = (versionId: string): string => versionId.replace(/[._]/g, '-');

/** True when a photo already has the profile's shape, within the 5% the rest of the pipeline uses. */
export const fitsProfileShape = (
	source: { width: number; height: number },
	shape: { width: number; height: number } | null,
): boolean => !shape || aspectDeviation(source.width, source.height, shape) <= MEDIA_INGEST_POLICY.aspectWarnTolerance;

/** The profile today's purpose-based pipeline made a role's files for. Null: made once per photo. */
const profileForRole = (purpose: MediaPurpose, role: string): string | null => {
	if (PER_PHOTO_ROLES.has(role) || purpose === 'review') return null;
	switch (purpose) {
		case 'product':
			return 'product_3x4';
		case 'category':
			return 'category_3x4';
		case 'banner':
			return 'banner_keep_shape';
		case 'blog':
			return 'blog_cover_2x1';
		case 'store':
			return 'store_photo_4x3';
		case 'avatar':
		case 'icon':
			return 'square_1x1';
		case 'brand':
			return role === 'brand_icon' ? 'browser_icon_1x1' : role === 'brand_logo' ? 'logo_keep_shape' : null;
		default:
			return null;
	}
};

/** The fill today's pipeline used: white padding for off-shape photos, a crop for avatars, white behind icons. */
const fillForRole = (asset: Pick<MediaAsset, 'purpose' | 'warnings' | 'width' | 'height'>, profileKey: string) => {
	const shape = SEEDED_MEDIA_PROFILES.find((entry) => entry.key === profileKey)?.shape ?? null;
	if (!shape) return 'as_is' as const;
	// The browser icon is always laid on white: an iPhone fills see-through gaps with black.
	if (profileKey === 'browser_icon_1x1') return 'white' as const;
	const offShape =
		asset.warnings.includes('letterboxed') ||
		(!!asset.width && !!asset.height && !fitsProfileShape({ width: asset.width, height: asset.height }, shape));
	if (!offShape) return 'as_is' as const;
	return asset.purpose === 'avatar' ? ('crop' as const) : ('white' as const);
};

/**
 * Names the versions a photo's files already are (R4-1: “today's photos become the version they already are;
 * nothing is remade”). Every file keeps its key; it only learns which version it belongs to. A version that
 * already exists keeps its id, state and date, so running this twice changes nothing.
 */
export const assignExistingVersions = (
	asset: Pick<
		MediaAsset,
		'kind' | 'purpose' | 'warnings' | 'width' | 'height' | 'derivatives' | 'versions' | 'createdAt' | 'processing'
	>,
	at: string,
	profileVersions: ReadonlyMap<string, number> = new Map(),
): { versions: MediaVersion[]; derivatives: ImageDerivative[] } => {
	if (asset.kind !== 'image') return { versions: asset.versions ?? [], derivatives: asset.derivatives };
	const byId = new Map((asset.versions ?? []).map((version) => [version.id, version]));
	const derivatives = asset.derivatives.map((derivative): ImageDerivative => {
		if (derivative.versionId) return derivative;
		const profileKey = profileForRole(asset.purpose, derivative.role);
		if (!profileKey) return { ...derivative, versionId: null };
		const id = versionIdOf(profileKey, fillForRole(asset, profileKey));
		if (!byId.has(id)) {
			byId.set(id, {
				id,
				profileKey,
				profileVersion: profileVersions.get(profileKey) ?? 1,
				fill: id.slice(profileKey.length + 1) as MediaFill,
				state: 'ready',
				createdAt: asset.processing.processedAt ?? asset.createdAt ?? at,
			});
		}
		return { ...derivative, versionId: id };
	});
	return { versions: [...byId.values()], derivatives };
};

/**
 * Puts back any built-in profile that is missing; never overwrites an admin's edits and never re-adds a profile
 * that is not built in (an admin may have deleted it). Returns how many it added.
 */
export const reconcileBuiltInProfiles = async (
	profiles: Pick<MediaProfileRepository, 'insertMissing'>,
): Promise<number> => profiles.insertMissing(SEEDED_MEDIA_PROFILES.filter((entry) => entry.builtIn));
