import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { MediaGateway, type MediaPurpose, type MediaUploadStatus } from './media.gateway';

const POLL_MS = 1500;
const POLL_LIMIT = 80;

/**
 * One admin upload end to end: read the image's real size in the browser (so the API can
 * refuse an over-cap or under-floor photo before any bytes move), presign, PUT straight to
 * Spaces, finalize, then wait for the worker. The PUT uses `fetch`, not `HttpClient`: it goes
 * to the bucket, which must never receive the API session cookie or CSRF header.
 */
@Injectable({ providedIn: 'root' })
export class MediaUploadService {
	private readonly gateway = inject(MediaGateway);

	async upload(file: File, purpose: MediaPurpose): Promise<MediaUploadStatus> {
		const { width, height } = await this.dimensions(file);
		const presigned = await firstValueFrom(
			this.gateway.presign({
				purpose,
				contentType: file.type,
				byteSize: file.size,
				fileName: file.name,
				width,
				height,
			}),
		);
		const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body: file });
		if (!put.ok) throw new Error(`The upload to storage failed (HTTP ${put.status}).`);
		let status = await firstValueFrom(this.gateway.finalize(presigned.assetId));
		for (
			let attempt = 0;
			attempt < POLL_LIMIT && (status.state === 'queued' || status.state === 'processing');
			attempt += 1
		) {
			await new Promise((settle) => setTimeout(settle, POLL_MS));
			status = await firstValueFrom(this.gateway.status(presigned.assetId));
		}
		return { ...status, warnings: [...new Set([...presigned.warnings, ...status.warnings])] };
	}

	private async dimensions(file: File): Promise<{ width: number; height: number }> {
		const bitmap = await createImageBitmap(file);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	}
}
