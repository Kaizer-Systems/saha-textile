import type {
	MediaFill,
	MediaProfile,
	MediaPurpose,
	MediaRoleDefinition,
	MediaVersionId,
} from '@saha-textile/contracts';

import { minSizeCheck, photoFills } from '../catalog/media-files';
import type { ImageRenderSpec } from '../ports/image-codec.port';
import { MEDIA_INGEST_POLICY, aspectDeviation } from './policy';
import { versionIdOf } from './profiles';

/**
 * Media build step 2b: what the image worker makes for one version (a profile and a fill, Media brief R4-1), and
 * the checks a photo passes against a profile before a version of it is made.
 */

export interface PlannedVersionFile {
	versionId: MediaVersionId;
	role: string;
	roleVersion: number;
	spec: ImageRenderSpec;
}

export interface VersionPlan {
	files: PlannedVersionFile[];
	/** Widths the photo cannot fill (never enlarged) or a banner slot never needs. */
	skipped: { role: string; width: number }[];
}

/** What a profile thinks of a photo's size: fine, a yellow note, or a refusal (the profile's “Refuse”). */
export type ProfileSizeCheck =
	{ result: 'ok' } | { result: 'warn' | 'refuse'; edge: 'short' | 'width'; px: number; has: number };

export const checkProfileMinSize = (
	profile: Pick<MediaProfile, 'minSize'>,
	source: { width: number; height: number },
): ProfileSizeCheck => minSizeCheck(profile.minSize, source);

/**
 * The fills a photo may get under a profile (R4-1): “As is” alone when it already has the profile's shape (within
 * 5%) or the profile keeps the photo's own shape; otherwise the profile's own fills, never “As is”.
 */
export const fillsForPhoto = (
	profile: Pick<MediaProfile, 'shape' | 'fills'>,
	source: { width: number; height: number },
): MediaFill[] => photoFills(profile, source);

export type VersionRequestRefusal =
	| 'profile_unknown'
	| 'profile_off'
	| 'profile_not_chosen'
	| 'fill_not_offered'
	| 'below_minimum'
	| 'too_large'
	| 'type_not_accepted';

/**
 * Whether a version may be asked for, before any byte moves (upload review) and again in the worker against the
 * decoded size. The link preview is never chosen: it is made by itself for a product's main photo.
 */
export const checkVersionRequest = (input: {
	profile: MediaProfile | null;
	fill: MediaFill;
	source: { width: number; height: number };
	byteSize: number;
	contentType: string;
}): VersionRequestRefusal | null => {
	const { profile } = input;
	if (!profile) return 'profile_unknown';
	if (!profile.enabled) return 'profile_off';
	if (profile.mainPhotoOnly) return 'profile_not_chosen';
	if (!profile.accepts.includes(input.contentType)) return 'type_not_accepted';
	if (input.byteSize > profile.maxBytes) return 'too_large';
	if (!fillsForPhoto(profile, input.source).includes(input.fill)) return 'fill_not_offered';
	if (checkProfileMinSize(profile, input.source).result === 'refuse') return 'below_minimum';
	return null;
};

/**
 * The purpose a photo uploaded with this profile keeps for the older screens that still pick photos by purpose
 * (they move to profiles in build step 4).
 */
export const purposeForProfile = (profileKey: string): MediaPurpose => {
	if (profileKey.startsWith('product')) return 'product';
	if (profileKey.startsWith('category')) return 'category';
	if (profileKey.startsWith('hero') || profileKey.includes('banner')) return 'banner';
	if (profileKey.startsWith('blog')) return 'blog';
	if (profileKey.startsWith('store')) return 'store';
	if (profileKey === 'logo_keep_shape' || profileKey === 'browser_icon_1x1') return 'brand';
	if (profileKey.startsWith('square')) return 'icon';
	return 'product';
};

const sameShape = (a: { width: number; height: number }, b: { width: number; height: number }) =>
	aspectDeviation(a.width, a.height, b) < 0.001;

/** How one size family is fitted under a fill: its box (null keeps the photo's shape), the fit and the bars. */
const fitFor = (
	role: MediaRoleDefinition,
	profile: Pick<MediaProfile, 'shape'>,
	fill: MediaFill,
	colours: { dominant: string | null; brand: string | null },
): { box: { width: number; height: number } | null; fit: ImageRenderSpec['fit']; background?: string } => {
	// A family with its own box (square swatches inside Product 3:4) keeps its own crop whatever the fill.
	if (role.aspect && (!profile.shape || !sameShape(role.aspect, profile.shape))) {
		return { box: role.aspect, fit: role.fit };
	}
	const box = profile.shape ?? role.aspect;
	switch (fill) {
		case 'as_is':
			// Already the profile's shape: kept whole. A family with its own box keeps its own fit there.
			return role.aspect ? { box: role.aspect, fit: role.fit } : { box: null, fit: 'inside' };
		case 'white':
			return { box, fit: 'pad' };
		case 'colour':
			return { box, fit: 'pad', ...(colours.dominant ? { background: colours.dominant } : {}) };
		case 'brand':
			return { box, fit: 'pad', ...(colours.brand ? { background: colours.brand } : {}) };
		case 'blur':
			return { box, fit: 'blur' };
		case 'crop':
			return { box, fit: 'cover' };
	}
};

/**
 * Every file one version needs (R4-1): each of the profile's size families at each of its widths, fitted the way
 * the fill says. Never enlarged: a width the photo cannot fill is skipped. Banners skip widths beyond twice their
 * slot's widest display. Logos keep their see-through background unless the fill puts them on a colour.
 */
/** A profile added in Settings makes one family of its own: its widths, kept whole, WebP. */
const ownFamily = (key: string): MediaRoleDefinition => ({
	key,
	label: key,
	seeded: false,
	purposes: [],
	widths: [],
	aspect: null,
	fit: 'inside',
	format: 'image/webp',
	quality: 82,
	primaryOnly: false,
	respectSlotMaxWidth: false,
	brandStrip: false,
	inset: 0,
	version: 1,
});

export const planVersion = (input: {
	profile: Pick<MediaProfile, 'key' | 'shape' | 'roles'> & Partial<Pick<MediaProfile, 'widths' | 'quality'>>;
	fill: MediaFill;
	roles: readonly MediaRoleDefinition[];
	source: { width: number; height: number };
	maxDisplayWidth: number | null;
	colours?: { dominant: string | null; brand: string | null };
}): VersionPlan => {
	const versionId = versionIdOf(input.profile.key, input.fill);
	const byKey = new Map(input.roles.map((role) => [role.key, role]));
	const files: PlannedVersionFile[] = [];
	const skipped: { role: string; width: number }[] = [];

	for (const key of input.profile.roles) {
		const role = byKey.get(key) ?? (input.profile.widths?.[key] ? ownFamily(key) : undefined);
		if (!role) continue;
		const widths = input.profile.widths?.[key] ?? role.widths;
		const quality = input.profile.quality ?? role.quality;
		const { box, fit, background } = fitFor(role, input.profile, input.fill, {
			dominant: input.colours?.dominant ?? null,
			brand: input.colours?.brand ?? null,
		});
		for (const width of [...widths].sort((a, b) => a - b)) {
			const height = box ? Math.round((width * box.height) / box.width) : null;
			const scale =
				height === null
					? width / input.source.width
					: fit === 'cover'
						? Math.max(width / input.source.width, height / input.source.height)
						: Math.min(width / input.source.width, height / input.source.height);
			const tooBigForSlot =
				role.respectSlotMaxWidth && input.maxDisplayWidth !== null && width > input.maxDisplayWidth * 2;
			if (scale > 1 || tooBigForSlot) {
				skipped.push({ role: key, width });
				continue;
			}
			const keepAlpha = role.purposes.includes('brand') && fit !== 'pad';
			files.push({
				versionId,
				role: key,
				roleVersion: role.version,
				spec: {
					width,
					height: fit === 'inside' ? null : height,
					fit,
					format: role.format,
					quality,
					...(keepAlpha ? { keepAlpha: true } : {}),
					...(background ? { background } : {}),
				},
			});
		}
	}
	return { files, skipped };
};

/** The rough size of new versions, for the storage check before an upload or Reprocess (R4-7). */
export const estimateVersionBytes = (originalBytes: number, versions: number): number =>
	Math.round(originalBytes * MEDIA_INGEST_POLICY.versionBytesShare * versions);
