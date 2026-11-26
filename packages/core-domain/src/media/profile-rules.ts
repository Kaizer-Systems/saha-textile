import type { MediaProfile, MediaProfileUpdate, MediaProfileWrite } from '@saha-textile/contracts';

import { MEDIA_INGEST_POLICY } from './policy';

/**
 * Settings › Image profiles (media build step 2c, Media brief F01–F03): adding, editing and deleting profiles.
 * Edits apply to versions made afterwards only; versions already made never change (R4-10).
 */

export type ProfileRefusal =
	| 'built_in'
	| 'built_in_name'
	| 'in_use'
	| 'keep_shape_fills'
	| 'fill_for_icons_only'
	| 'too_large'
	| 'unknown_family';

/** The fills an icon profile offers instead of the photo fills: a white or Brand Kit colour background. */
const ICON_FAMILIES = new Set(['brand_icon']);

/** A key for a new profile, made from its name and kept unique: “Saree 2:3” → `saree_2x3`. */
export const profileKeyFromName = (name: string, taken: ReadonlySet<string>): string => {
	const base =
		name
			.normalize('NFKD')
			.toLowerCase()
			.replace(/(\d)\s*:\s*(\d)/g, '$1x$2')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.replace(/^(\d)/, 'p_$1')
			.slice(0, 34)
			.replace(/_+$/, '') || 'profile';
	const safe = base.length >= 2 ? base : `profile_${base}`;
	let key = safe;
	for (let n = 2; taken.has(key); n += 1) key = `${safe}_${n}`;
	return key;
};

/** Whether a set of profile settings can be saved, whatever the profile is. */
const settingsRefusal = (profile: MediaProfile): ProfileRefusal | null => {
	if (profile.maxBytes > MEDIA_INGEST_POLICY.maxBytes) return 'too_large';
	if (!profile.shape && profile.fills.length > 0) return 'keep_shape_fills';
	const icon = profile.roles.some((role) => ICON_FAMILIES.has(role));
	if (!icon && profile.fills.includes('brand')) return 'fill_for_icons_only';
	if (Object.keys(profile.widths).some((role) => !profile.roles.includes(role))) return 'unknown_family';
	return null;
};

const sortedWidths = (widths: Record<string, number[]>): Record<string, number[]> =>
	Object.fromEntries(Object.entries(widths).map(([role, list]) => [role, [...new Set(list)].sort((a, b) => a - b)]));

/** A new profile from Settings: one size family of its own, named by its key. */
export const newProfile = (
	write: MediaProfileWrite,
	key: string,
): { profile: MediaProfile } | { refusal: ProfileRefusal } => {
	const sizes = Object.values(write.widths)[0] ?? [];
	const profile: MediaProfile = {
		key,
		name: write.name,
		builtIn: false,
		shape: write.shape,
		roles: [key],
		widths: sortedWidths({ [key]: sizes }),
		quality: write.quality,
		fills: write.shape ? write.fills : [],
		minSize: write.minSize,
		maxBytes: write.maxBytes,
		accepts: write.accepts,
		mainPhotoOnly: false,
		enabled: write.enabled,
		version: 1,
	};
	const refusal = settingsRefusal({ ...profile, fills: write.fills });
	return refusal ? { refusal } : { profile };
};

/**
 * An edit. A built-in profile keeps its name (every screen and language names it the same). A change to what a
 * version's files are made with (shape, sizes, quality) raises the profile's version, so new versions record the
 * settings they were made under and “Bring older versions up to date” finds the older ones. Other changes (name,
 * fills offered, smallest photo, biggest file, accepted types, on or off) are saved without raising it: the files
 * already made are what those settings would make today.
 */
export const applyProfileUpdate = (
	current: MediaProfile,
	update: MediaProfileUpdate,
): { profile: MediaProfile; changed: boolean } | { refusal: ProfileRefusal } => {
	if (current.builtIn && update.name !== undefined && update.name !== current.name)
		return { refusal: 'built_in_name' };
	const next: MediaProfile = {
		...current,
		...(update.name !== undefined ? { name: update.name } : {}),
		...(update.shape !== undefined ? { shape: update.shape } : {}),
		...(update.widths !== undefined ? { widths: sortedWidths({ ...current.widths, ...update.widths }) } : {}),
		...(update.quality !== undefined ? { quality: update.quality } : {}),
		...(update.minSize !== undefined ? { minSize: update.minSize } : {}),
		...(update.fills !== undefined ? { fills: update.fills } : {}),
		...(update.maxBytes !== undefined ? { maxBytes: update.maxBytes } : {}),
		...(update.accepts !== undefined ? { accepts: update.accepts } : {}),
		...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
	};
	const refusal = settingsRefusal(next);
	if (refusal) return { refusal };
	const { version: _v, updatedAt: _u, ...before } = current;
	const { version: _v2, updatedAt: _u2, ...after } = next;
	const changed = JSON.stringify(before) !== JSON.stringify(after);
	const making = (profile: MediaProfile) =>
		JSON.stringify({ shape: profile.shape, widths: profile.widths, quality: profile.quality });
	const remakes = making(current) !== making(next);
	return { profile: changed ? { ...next, version: current.version + (remakes ? 1 : 0) } : current, changed };
};

/** F03: a built-in profile is never deleted; one that photos use is switched off instead. */
export const profileDeleteRefusal = (profile: MediaProfile, photos: number): ProfileRefusal | null => {
	if (profile.builtIn) return 'built_in';
	if (photos > 0) return 'in_use';
	return null;
};
