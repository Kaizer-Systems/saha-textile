import type { EmailPicture, MediaAsset } from '@saha-textile/contracts';

import { isEmailPictureKey } from './storage-keys';

/**
 * The email pictures leaving a photo (R6-1): those it holds that the photo's new set no longer does, when the photo
 * is deleted for good (`keepKeys` empty) or replaced. They are recorded, never deleted.
 */
export function emailPicturesLeaving(
	asset: Pick<MediaAsset, 'id' | 'derivatives' | 'displayName' | 'slug'>,
	keepKeys: ReadonlySet<string>,
	why: EmailPicture['why'],
	now: Date,
	by: string | null,
): EmailPicture[] {
	return asset.derivatives
		.filter((row) => isEmailPictureKey(row.storageKey) && !keepKeys.has(row.storageKey))
		.map((row) => ({
			key: row.storageKey,
			assetId: asset.id,
			photoName: asset.displayName ?? asset.slug,
			width: row.width,
			bytes: row.byteSize ?? 0,
			why,
			goneAt: now.toISOString(),
			goneBy: by,
			sentCount: 0,
			lastSentAt: null,
		}));
}

/** The cut-off for “last sent more than N years ago”. */
export function emailPictureCutoff(sent: 'over_1y' | 'over_2y', now: Date): string {
	const at = new Date(now);
	at.setUTCFullYear(at.getUTCFullYear() - (sent === 'over_1y' ? 1 : 2));
	return at.toISOString();
}
