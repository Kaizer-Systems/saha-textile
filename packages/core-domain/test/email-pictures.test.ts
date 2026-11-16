import { describe, expect, it } from 'vitest';

import {
	derivativeStorageKey,
	emailPictureCutoff,
	emailPicturesLeaving,
	isEmailPictureKey,
	keptAfterReplace,
	publicKeys,
	storedKeys,
} from '../src/index';

import type { ImageDerivative, MediaAsset } from '@saha-textile/contracts';

/** Email pictures are kept for good (Media brief R4-3, R6-1; media step 3f). */
const file = (storageKey: string, role: string, versionId: string | null = null): ImageDerivative => ({
	role,
	storageKey,
	width: 300,
	height: 400,
	byteSize: 20_000,
	format: role === 'email_thumb' ? 'image/jpeg' : 'image/webp',
	roleVersion: 1,
	versionId,
});
const EMAIL_NEW = 'email/med_e/red-banarasi-300w-1f3a9c2e.jpg';
const EMAIL_OLD = 'media/med_e/red-banarasi-email-thumb-300w-0a1b2c3d.jpg';
const CARD = 'media/med_e/product-3x4-white/red-banarasi-card-400w-9f8e7d6c.webp';
const photo = {
	id: 'med_e',
	kind: 'image',
	visibility: 'public',
	originalStorageKey: 'media/med_e/original.jpg',
	derivatives: [
		file(EMAIL_NEW, 'email_thumb'),
		file(EMAIL_OLD, 'email_thumb'),
		file(CARD, 'card', 'product_3x4.white'),
	],
	renditions: [],
	hlsPlaylistKey: null,
	keptFiles: [],
	replacing: null,
} as unknown as MediaAsset;

describe('email pictures (media step 3f)', () => {
	it('are written under their own prefix', () => {
		expect(
			derivativeStorageKey({
				assetId: 'med_e',
				slug: 'red-banarasi',
				role: 'email_thumb',
				width: 300,
				sha256: '1f3a9c2e00',
				format: 'image/jpeg',
			}),
		).toBe(EMAIL_NEW);
		expect(
			derivativeStorageKey({
				assetId: 'med_e',
				slug: 'red-banarasi',
				role: 'share',
				width: 1200,
				sha256: '1f3a9c2e00',
				format: 'image/jpeg',
			}),
		).toBe('media/med_e/red-banarasi-share-1200w-1f3a9c2e.jpg');
	});

	it('are known by that prefix, or by their role in an older name', () => {
		expect(isEmailPictureKey(EMAIL_NEW)).toBe(true);
		expect(isEmailPictureKey(EMAIL_OLD)).toBe(true);
		expect(isEmailPictureKey(CARD)).toBe(false);
		expect(isEmailPictureKey('media/med_e/original.jpg')).toBe(false);
	});

	it('are never deleted with the photo, never cleared from the CDN with it, and never kept-then-swept after a Replace', () => {
		expect(storedKeys(photo)).toEqual(['media/med_e/original.jpg', CARD]);
		expect(publicKeys(photo)).toEqual([CARD]);
		const kept = keptAfterReplace(
			photo,
			{ derivatives: [], originalStorageKey: 'media/med_e/original-2.jpg' },
			new Date(),
		);
		expect(kept?.keys).toEqual([CARD, 'media/med_e/original.jpg']);
	});

	it('are recorded when they leave their photo: all of them when it is deleted, the old ones when it is replaced', () => {
		const now = new Date('2026-11-16T10:00:00.000Z');
		const named = { ...photo, displayName: 'Red Banarasi.jpg', slug: 'red-banarasi' };
		expect(emailPicturesLeaving(named, new Set(), 'deleted', now, 'adm_1')).toEqual([
			expect.objectContaining({
				key: EMAIL_NEW,
				assetId: 'med_e',
				photoName: 'Red Banarasi.jpg',
				why: 'deleted',
				goneBy: 'adm_1',
				width: 300,
				bytes: 20_000,
				sentCount: 0,
				lastSentAt: null,
			}),
			expect.objectContaining({ key: EMAIL_OLD, why: 'deleted' }),
		]);
		// A Replace that makes the same email picture again (same bytes, same address) leaves only the other one.
		expect(
			emailPicturesLeaving(named, new Set([EMAIL_NEW, CARD]), 'replaced', now, null).map((row) => row.key),
		).toEqual([EMAIL_OLD]);
	});

	it('are filtered by when they were last sent', () => {
		const now = new Date('2026-11-16T10:00:00.000Z');
		expect(emailPictureCutoff('over_2y', now)).toBe('2024-11-16T10:00:00.000Z');
		expect(emailPictureCutoff('over_1y', now)).toBe('2025-11-16T10:00:00.000Z');
	});
});
