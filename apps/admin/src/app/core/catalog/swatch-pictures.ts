import { Injectable, inject, signal } from '@angular/core';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { AuthStore } from '@core/state/auth.store';

import type { MediaFileDetails } from '@saha-textile/contracts';

/** The size the admin preview reads: twice its largest drawing, so it stays sharp on a 2× screen. */
const PREVIEW_WIDTH = 160;

/**
 * The swatch file the shop draws for a photo (`derivativesFor` in core-domain): the square `swatch_image` of the
 * version the value or product chose, or, when none is chosen or it is not ready, of the first ready version that
 * has one. A Crop version's square is cut around the photo's focus point; any other version's is its middle.
 */
export function swatchFile(details: Pick<MediaFileDetails, 'versions'>, versionId?: string | null): string | null {
	const ready = details.versions.filter((version) => version.state === 'ready');
	const squares = (version: (typeof ready)[number]) =>
		version.families.find((family) => family.role === 'swatch_image')?.files ?? [];
	const chosen = versionId ? ready.find((version) => version.id === versionId) : undefined;
	const files =
		chosen && squares(chosen).length ? squares(chosen) : (ready.map(squares).find((list) => list.length) ?? []);
	return (files.find((file) => file.width >= PREVIEW_WIDTH) ?? files.at(-1))?.url ?? null;
}

/**
 * Each swatch photo's versions, read once per photo, so admin previews show the very square the shop shows. Without
 * a media library or its permission every answer is null, and the preview uses the photo's thumbnail or grey.
 */
@Injectable({ providedIn: 'root' })
export class SwatchPictures {
	private readonly gateway = inject(MediaLibraryGateway, { optional: true });
	private readonly auth = inject(AuthStore, { optional: true });
	private readonly details = signal<ReadonlyMap<string, Pick<MediaFileDetails, 'versions'> | null>>(new Map());
	private readonly asked = new Set<string>();

	/**
	 * Reads the versions of each photo not read yet. Only for people who may open the Media Library: anyone else
	 * (a store manager) gets null answers, and the previews fall back to the photo's thumbnail.
	 */
	need(ids: Iterable<string>): void {
		if (!this.auth?.permissions().includes('attachment.index')) return;
		for (const id of ids) {
			if (this.asked.has(id) || !this.gateway) continue;
			this.asked.add(id);
			this.gateway.details(id).subscribe({
				next: (details) => this.details.update((map) => new Map([...map, [id, details]])),
				error: () => this.details.update((map) => new Map([...map, [id, null]])),
			});
		}
	}

	/** The swatch file for this photo and version; null when it has none or is not read yet. */
	url(assetId: string, versionId?: string | null): string | null {
		const details = this.details().get(assetId);
		return details ? swatchFile(details, versionId) : null;
	}
}
