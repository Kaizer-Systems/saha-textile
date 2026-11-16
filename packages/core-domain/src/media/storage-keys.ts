/**
 * Storage key layout (owner log § Media, locked):
 *
 *   media/{assetId}/original.{ext}                          private regeneration master
 *   media/{assetId}/{slug}-{role}-{width}w-{hash8}.{ext}    derivative, immutable
 *   email/{assetId}/{slug}-{width}w-{hash8}.jpg             email picture, kept for good (R4-3, R6-1)
 *
 * `assetId` first so one asset's objects share a prefix; the content hash makes every
 * derivative key immutable, which is what earns the one-year cache header.
 */
export const originalStorageKey = (assetId: string, contentType: string): string =>
	`media/${assetId}/original.${contentType === 'image/png' ? 'png' : 'jpg'}`;

/**
 * A replacement original (S7): its own name, so the old original stays in place, private, for the 7 days it is
 * kept (decision 11) while the new one is checked and its versions made.
 */
export const replacementOriginalKey = (assetId: string, contentType: string, at: Date): string =>
	`media/${assetId}/original-${at
		.toISOString()
		.replace(/[-:.TZ]/g, '')
		.slice(0, 14)}.${contentType === 'image/png' ? 'png' : 'jpg'}`;

/**
 * A plain file's stored copy (Media page, step 1): the id keeps it unique; the extension is the
 * uploaded name's, cleaned, so a downloaded file opens in the right program.
 */
export const plainFileStorageKey = (assetId: string, fileName: string): string => {
	const extension = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase();
	return `media/${assetId}/original${extension ? `.${extension}` : ''}`;
};

const DERIVATIVE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** The role of the picture order emails show (JPEG, 150 and 300 px). */
export const EMAIL_PICTURE_ROLE = 'email_thumb';

/**
 * Whether a stored file is an email picture: under its own `email/` prefix (media step 3f), or one made before it
 * with the role in its name. Email pictures are kept for good, so emails already sent keep their pictures: Replace, a
 * focal point, a new name, new versions and deleting the photo never remove them; only Clean up › Email pictures does.
 */
export const isEmailPictureKey = (key: string): boolean =>
	key.startsWith('email/') || /-email-thumb-\d+w-[0-9a-f]{8}\.jpg$/.test(key);

export const derivativeStorageKey = (input: {
	assetId: string;
	slug: string;
	role: string;
	width: number;
	sha256: string;
	format: 'image/webp' | 'image/jpeg' | 'image/png';
}): string =>
	input.role === EMAIL_PICTURE_ROLE
		? `email/${input.assetId}/${input.slug}-${input.width}w-${input.sha256.slice(0, 8)}.${DERIVATIVE_EXTENSIONS[input.format]}`
		: `media/${input.assetId}/${input.slug}-${input.role.replace(/_/g, '-')}-${input.width}w-${input.sha256.slice(0, 8)}.${
				DERIVATIVE_EXTENSIONS[input.format]
			}`;

/**
 * A version's file (R4-1): under the version's own folder, so one photo's branches sit apart in Spaces —
 * `media/med_7Hk2/hero-21x9-crop/banarasi-weave-closeup-banner-1920w-1f3a9c2e.webp`. Written once.
 */
export const versionStorageKey = (input: {
	assetId: string;
	versionId: string;
	slug: string;
	role: string;
	width: number;
	sha256: string;
	format: 'image/webp' | 'image/jpeg' | 'image/png';
}): string =>
	`media/${input.assetId}/${input.versionId.replace(/[._]/g, '-')}/${input.slug}-${input.role.replace(/_/g, '-')}-${
		input.width
	}w-${input.sha256.slice(0, 8)}.${DERIVATIVE_EXTENSIONS[input.format]}`;

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
