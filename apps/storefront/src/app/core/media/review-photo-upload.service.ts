import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import {
	HEIC_QUALITY_STEPS,
	heicColourProfile,
	sniffPhoto,
	withColourProfile,
} from '@saha-textile/core-domain/media-files';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

/** At most five photos per review (owner log § Media → Review photos). */
export const MAX_REVIEW_PHOTOS = 5;
const WARN_BELOW_LONG_EDGE = 500;
const MAX_BYTES = 25 * 1024 * 1024;
const POLL_MS = 1500;
const POLL_LIMIT = 60;

export interface ReviewPhotoResult {
	assetId: string;
	previewUrl: string | null;
	warning: 'below_recommended_size' | null;
}

interface PresignResponse {
	assetId: string;
	uploadUrl: string;
	headers: Record<string, string>;
}
interface UploadStatus {
	assetId: string;
	state: 'awaiting_upload' | 'queued' | 'processing' | 'ready' | 'failed';
	error: string | null;
	previewUrl: string | null;
}

export class ReviewPhotoRefusal extends Error {
	constructor(readonly code: 'not_an_image' | 'too_large' | 'processing_failed') {
		super(code);
		this.name = 'ReviewPhotoRefusal';
	}
}

/** What the bytes really are, whatever the file name or the picker claimed (shared with the admin). */
const sniff = sniffPhoto;

/**
 * A HEIC from a phone as a JPEG: the same converter the admin's Media page uses (media step 2d) — top quality first,
 * then 95 and 90 until it fits 25 MB, with the photo's own colour profile put back so reds and pinks stay true.
 */
async function heicAsJpeg(file: File): Promise<Blob> {
	const { heicTo } = await import('heic-to');
	const icc = heicColourProfile(new Uint8Array(await file.arrayBuffer()));
	let made: Blob = file;
	for (const quality of HEIC_QUALITY_STEPS) {
		const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality });
		made = icc
			? new Blob([withColourProfile(new Uint8Array(await jpeg.arrayBuffer()), icc) as Uint8Array<ArrayBuffer>], {
					type: 'image/jpeg',
				})
			: jpeg;
		if (made.size <= MAX_BYTES) break;
	}
	return made;
}

/**
 * A customer's review photo, end to end in the browser: check the real bytes are a JPEG, PNG
 * or HEIC/HEIF photo; convert HEIC/HEIF (iPhone) to JPEG (the converter loads only when such a
 * file is picked); read its size; presign (the API refuses anyone who did not buy the product);
 * PUT straight to storage; finalize; wait for the private review derivatives. The worker's
 * decode remains the real trust boundary — these checks only save a wasted upload.
 */
@Injectable({ providedIn: 'root' })
export class ReviewPhotoUploadService {
	private readonly http = inject(HttpClient);

	async upload(file: File, productId: string): Promise<ReviewPhotoResult> {
		const kind = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
		if (!kind) throw new ReviewPhotoRefusal('not_an_image');
		let photo: Blob = file;
		if (kind === 'heic') photo = await heicAsJpeg(file);
		if (photo.size > MAX_BYTES) throw new ReviewPhotoRefusal('too_large');
		const contentType = kind === 'png' ? 'image/png' : 'image/jpeg';
		const bitmap = await createImageBitmap(photo);
		const { width, height } = bitmap;
		bitmap.close();

		await runtimeConfigReady;
		const base = `${runtimeConfig.apiUrl}/storefront/reviews/photos`;
		const presigned = await firstValueFrom(
			this.http.post<PresignResponse>(`${base}/presign`, {
				contentType,
				byteSize: photo.size,
				fileName: file.name.replace(/\.(heic|heif)$/i, '.jpg'),
				width,
				height,
				productId,
			}),
		);
		// `fetch`, not HttpClient: the bucket must never receive the session cookie or CSRF header.
		const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body: photo });
		if (!put.ok) throw new ReviewPhotoRefusal('processing_failed');

		let status = await firstValueFrom(this.http.post<UploadStatus>(`${base}/${presigned.assetId}/finalize`, {}));
		for (
			let attempt = 0;
			attempt < POLL_LIMIT && (status.state === 'queued' || status.state === 'processing');
			attempt += 1
		) {
			await new Promise((settle) => setTimeout(settle, POLL_MS));
			status = await firstValueFrom(this.http.get<UploadStatus>(`${base}/${presigned.assetId}/status`));
		}
		if (status.state !== 'ready') throw new ReviewPhotoRefusal('processing_failed');
		return {
			assetId: presigned.assetId,
			previewUrl: status.previewUrl,
			warning: Math.max(width, height) < WARN_BELOW_LONG_EDGE ? 'below_recommended_size' : null,
		};
	}

	submit(body: {
		productId: string;
		orderId: string;
		rating: number;
		title: string | null;
		body: string;
		imageAssetIds: string[];
	}): Promise<unknown> {
		return firstValueFrom(this.http.post(`${runtimeConfig.apiUrl}/storefront/reviews`, body));
	}
}
