import type { MediaRoleDefinition } from '@saha-textile/contracts';

import type { MediaRoleRepository } from '../ports/media-role.repository';

const role = (
	definition: Omit<MediaRoleDefinition, 'seeded' | 'version' | 'updatedAt' | 'brandStrip' | 'inset'> & {
		brandStrip?: boolean;
		inset?: number;
	},
): MediaRoleDefinition => ({
	brandStrip: false,
	inset: 0,
	...definition,
	seeded: true,
	version: 1,
});

/**
 * The seeded size ladder (owner log § Media → Roles and the size ladder, 2026-11-02).
 * Widths come from measuring every rendered slot at 360–2560 px and 1×–3× density.
 * Operators may edit widths and quality; keys, purposes, and fit stay fixed.
 */
export const SEEDED_MEDIA_ROLES: readonly MediaRoleDefinition[] = [
	role({
		key: 'thumb',
		label: 'Cart and order thumbnail',
		purposes: ['product', 'category'],
		widths: [150, 300],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 80,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'card',
		label: 'Product card and PDP thumbnail strip',
		purposes: ['product', 'category'],
		widths: [200, 400, 700, 960],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'gallery',
		label: 'Product page main image',
		purposes: ['product'],
		widths: [600, 900, 1200, 1600],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 84,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'zoom',
		label: 'Hover zoom and full-screen gallery',
		purposes: ['product'],
		widths: [2000],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 86,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'swatch_image',
		label: 'Image swatch',
		purposes: ['product'],
		widths: [80, 160, 240],
		aspect: { width: 1, height: 1 },
		fit: 'cover',
		format: 'image/webp',
		quality: 80,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'swatch_image_v2',
		label: 'Image tile swatch',
		purposes: ['product'],
		widths: [120, 240],
		aspect: { width: 1, height: 1 },
		fit: 'cover',
		format: 'image/webp',
		quality: 80,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'share',
		label: 'Link preview (WhatsApp, social)',
		purposes: ['product'],
		widths: [1200],
		aspect: { width: 1200, height: 630 },
		// Blurred-photo fill rather than white bands (owner, 2026-11-02): a richer link card.
		fit: 'blur',
		format: 'image/jpeg',
		quality: 84,
		primaryOnly: true,
		respectSlotMaxWidth: false,
		// The Brand Kit logo along the foot, so a forwarded link still names the shop (share brief J2).
		brandStrip: true,
	}),
	role({
		key: 'story',
		label: 'Status and Story card',
		purposes: ['product'],
		widths: [1080],
		aspect: { width: 1080, height: 1920 },
		// The phone writes the name and facts into the empty band when the shopper shares (share brief J1).
		fit: 'story',
		format: 'image/jpeg',
		quality: 82,
		primaryOnly: true,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'feed_square',
		label: 'Shopping feed square',
		purposes: ['product'],
		widths: [1200],
		aspect: { width: 1, height: 1 },
		fit: 'pad',
		format: 'image/jpeg',
		quality: 86,
		primaryOnly: true,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'email_thumb',
		label: 'Order email thumbnail',
		purposes: ['product'],
		widths: [150, 300],
		aspect: null,
		fit: 'inside',
		format: 'image/jpeg',
		quality: 80,
		primaryOnly: true,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'review_thumb',
		label: 'Review photo thumbnail',
		purposes: ['review'],
		widths: [150, 300],
		aspect: { width: 3, height: 4 },
		fit: 'cover',
		format: 'image/webp',
		quality: 80,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'review_full',
		label: 'Review photo, full view',
		purposes: ['review'],
		widths: [1600],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'brand_logo',
		label: 'Shop logo',
		purposes: ['brand'],
		widths: [240, 320, 480, 640, 960],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 90,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'brand_icon',
		label: 'Browser and home screen icon',
		purposes: ['brand'],
		widths: [32, 48, 180, 192, 512],
		aspect: { width: 1, height: 1 },
		fit: 'pad',
		format: 'image/png',
		quality: 90,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		// The Brand Kit's link preview picture (owner, 2026-11-10): pages shared without their own
		// picture. Padded on white, so with no picture chosen the computer logo makes a clean card.
		key: 'site_share',
		label: 'Shop link preview',
		purposes: ['brand'],
		widths: [1200],
		aspect: { width: 1200, height: 630 },
		fit: 'pad',
		format: 'image/jpeg',
		quality: 84,
		primaryOnly: false,
		respectSlotMaxWidth: false,
		// Chat apps crop the edges of previews: keep a white margin round the logo.
		inset: 0.12,
	}),
	role({
		key: 'banner',
		label: 'Banner',
		purposes: ['banner'],
		widths: [480, 768, 1080, 1440, 1920, 2560, 2880],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: true,
	}),
	role({
		key: 'blog',
		label: 'Blog image',
		purposes: ['blog'],
		widths: [480, 800, 1200, 1600, 2400],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'store_photo',
		label: 'Store photo',
		purposes: ['store'],
		widths: [400, 800, 1200, 1600],
		aspect: null,
		fit: 'inside',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'category_icon',
		label: 'Category icon',
		purposes: ['icon'],
		widths: [256],
		aspect: { width: 1, height: 1 },
		fit: 'pad',
		format: 'image/webp',
		quality: 90,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
	role({
		key: 'avatar',
		label: 'Operator avatar',
		purposes: ['avatar'],
		widths: [96, 192],
		aspect: { width: 1, height: 1 },
		fit: 'cover',
		format: 'image/webp',
		quality: 82,
		primaryOnly: false,
		respectSlotMaxWidth: false,
	}),
];

/** Roles every product image must have before the product can publish (blocked, not warned). */
export const PUBLISH_REQUIRED_ROLES: readonly string[] = ['thumb', 'card', 'gallery'];

/** The fields operators cannot edit: a change in code is applied to existing databases. */
const FIXED_FIELDS = [
	'purposes',
	'aspect',
	'fit',
	'format',
	'primaryOnly',
	'respectSlotMaxWidth',
	'brandStrip',
	'inset',
] as const;

/** A stored role from before a fixed field existed reads as that field's default, not as a change. */
const fixedValue = (role: MediaRoleDefinition, field: (typeof FIXED_FIELDS)[number]): string =>
	JSON.stringify(
		field === 'brandStrip' ? Boolean(role.brandStrip) : field === 'inset' ? (role.inset ?? 0) : role[field],
	);

/**
 * Brings stored seeded roles in line with the code. Missing seeds are inserted; a seed whose
 * fixed shape changed (fit, aspect, format…) is updated with its version bumped, so the stale
 * sweep regenerates its derivatives. Operator-editable fields (label, widths, quality) are
 * never touched. Returns the keys it inserted or changed.
 */
export const reconcileSeededRoles = async (roles: Pick<MediaRoleRepository, 'list' | 'save'>): Promise<string[]> => {
	const stored = new Map((await roles.list()).map((role) => [role.key, role]));
	const changed: string[] = [];
	for (const seed of SEEDED_MEDIA_ROLES) {
		const current = stored.get(seed.key);
		if (!current) {
			await roles.save(seed);
			changed.push(seed.key);
			continue;
		}
		const drifted = FIXED_FIELDS.some((field) => fixedValue(current, field) !== fixedValue(seed, field));
		if (!drifted) continue;
		const next = { ...current, version: current.version + 1 } as MediaRoleDefinition;
		for (const field of FIXED_FIELDS) (next as Record<string, unknown>)[field] = seed[field];
		await roles.save(next);
		changed.push(seed.key);
	}
	return changed;
};
