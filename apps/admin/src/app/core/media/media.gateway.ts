import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { IAttachment, IAttachmentModel } from '@data-access/interfaces/attachment.interface';

/** The image purposes an operator uploads (`MediaPurpose` minus customer review photos). */
export type MediaPurpose = 'product' | 'category' | 'banner' | 'blog' | 'avatar' | 'icon' | 'brand';

export interface MediaUploadStatus {
	assetId: string;
	state: 'awaiting_upload' | 'queued' | 'processing' | 'ready' | 'failed';
	error: string | null;
	warnings: string[];
	previewUrl: string | null;
}

export interface MediaPresignResponse {
	assetId: string;
	uploadUrl: string;
	headers: Record<string, string>;
	expiresAt: string;
	warnings: string[];
}

interface ResolvedSource {
	url: string;
	width: number;
}

/** `MediaLibraryItem` from `@saha-textile/contracts`, as the library grid reads it. */
interface MediaLibraryItem {
	asset: {
		id: string;
		slug: string;
		purpose: string;
		originalFormat: string;
		originalByteSize: number;
		width: number;
		height: number;
		createdAt?: string;
		processing: { state: string };
	};
	preview: { roles: Record<string, ResolvedSource[]> } | null;
	usageCount: number;
}

interface MediaLibraryResponse {
	items: MediaLibraryItem[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * A small preview: the 400 px card, else any role's smallest file. A private image (an
 * unapproved review photo) has no public file, so it shows the theme's placeholder.
 */
const previewOf = (item: MediaLibraryItem): string => {
	const roles = item.preview?.roles ?? {};
	const card = roles['card']?.find((source) => source.width >= 400) ?? roles['card']?.[0];
	const any = Object.values(roles)[0]?.[0];
	return (card ?? any)?.url ?? 'assets/images/product.png';
};

const toAttachment = (item: MediaLibraryItem): IAttachment =>
	({
		id: item.asset.id,
		collection_name: item.asset.purpose,
		name: item.asset.slug,
		file_name: item.asset.slug,
		mime_type: item.asset.originalFormat,
		disk: 'spaces',
		conversions_disk: 'spaces',
		size: String(item.asset.originalByteSize),
		original_url: previewOf(item),
		width: item.asset.width,
		height: item.asset.height,
		created_by_id: 0,
		created_at: item.asset.createdAt,
	}) as unknown as IAttachment;

/**
 * Admin media API (owner log § Media). Library rows are mapped onto the theme's
 * `IAttachment` shape so the existing media grid, picker and media-box render them unchanged.
 */
@Injectable({ providedIn: 'root' })
export class MediaGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}/admin/media${path}`;
	}

	library(params: {
		search?: string;
		page?: number;
		pageSize?: number;
		purpose?: MediaPurpose;
	}): Observable<IAttachmentModel> {
		const query: Record<string, string> = {
			page: String(params.page ?? 1),
			pageSize: String(params.pageSize ?? 48),
		};
		if (params.search) query['search'] = params.search;
		if (params.purpose) query['purpose'] = params.purpose;
		return this.http.get<MediaLibraryResponse>(this.url(''), { params: query }).pipe(
			map(
				(response) =>
					({
						current_page: response.page,
						per_page: response.pageSize,
						total: response.total,
						data: response.items.map(toAttachment),
					}) as unknown as IAttachmentModel,
			),
		);
	}

	/** One library item in the picker's shape, for previewing an asset already chosen. */
	get(assetId: string): Observable<IAttachment> {
		return this.http
			.get<MediaLibraryItem>(this.url(`/${encodeURIComponent(assetId)}`))
			.pipe(map((item) => toAttachment(item)));
	}

	presign(body: {
		purpose: MediaPurpose;
		contentType: string;
		byteSize: number;
		fileName: string;
		width: number;
		height: number;
	}): Observable<MediaPresignResponse> {
		return this.http.post<MediaPresignResponse>(this.url('/presign'), { kind: 'image', ...body });
	}

	finalize(assetId: string): Observable<MediaUploadStatus> {
		return this.http.post<MediaUploadStatus>(this.url(`/${encodeURIComponent(assetId)}/finalize`), {});
	}

	status(assetId: string): Observable<MediaUploadStatus> {
		return this.http.get<MediaUploadStatus>(this.url(`/${encodeURIComponent(assetId)}/status`));
	}

	remove(assetId: string): Observable<void> {
		return this.http.delete<void>(this.url(`/${encodeURIComponent(assetId)}`));
	}
}
