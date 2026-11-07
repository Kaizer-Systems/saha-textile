/**
 * Storage key layout (owner log § Media, locked):
 *
 *   media/{assetId}/original.{ext}                          private regeneration master
 *   media/{assetId}/{slug}-{role}-{width}w-{hash8}.{ext}    derivative, immutable
 *
 * `assetId` first so one asset's objects share a prefix; the content hash makes every
 * derivative key immutable, which is what earns the one-year cache header.
 */
export const originalStorageKey = (assetId: string, contentType: string): string =>
	`media/${assetId}/original.${contentType === 'image/png' ? 'png' : 'jpg'}`;

const DERIVATIVE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export const derivativeStorageKey = (input: {
	assetId: string;
	slug: string;
	role: string;
	width: number;
	sha256: string;
	format: 'image/webp' | 'image/jpeg' | 'image/png';
}): string =>
	`media/${input.assetId}/${input.slug}-${input.role.replace(/_/g, '-')}-${input.width}w-${input.sha256.slice(0, 8)}.${
		DERIVATIVE_EXTENSIONS[input.format]
	}`;

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * An SEO filename stem: lower-case ASCII words joined by hyphens, at most 80 characters.
 * Filenames are a weak ranking signal, so this is a free bonus, never a requirement — an
 * unusable input degrades to `image`.
 */
export const mediaSlug = (input: string): string => {
	const slug = input
		.normalize('NFKD')
		.replace(COMBINING_MARKS, '')
		.toLowerCase()
		.replace(/\.[a-z0-9]{2,5}$/, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');
	return slug || 'image';
};

/**
 * Review photos carry no personal data in their address or alt: the stem names the product
 * and nothing about the customer. Identity lives on the review record (`reviews.userId`).
 */
export const reviewPhotoSlug = (productName: string): string => mediaSlug(`${productName} customer photo`);
