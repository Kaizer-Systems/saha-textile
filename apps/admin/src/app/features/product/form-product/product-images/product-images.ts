import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, model, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbAccordionModule, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { MediaGateway } from '@core/media/media.gateway';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { ProductContentWrite } from '@saha-textile/contracts';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { FmPicker, type FmPicked } from '../../../media/file-manager/fm-picker';
import { fillKey, profileNameKey } from '../../../setting/image-profiles/profile-words';

type ImagesValue = Pick<ProductContentWrite, 'imageMode' | 'gallery' | 'compound' | 'altOverrides' | 'versions'>;

export interface ImageCombination {
	hash: string;
	label: string;
}

/** Moves one item, keeping positions 1, 2, 3 with no gaps. */
function moved(list: readonly string[], from: number, to: number): string[] {
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item as string);
	return next;
}

/**
 * The product's images. Position 1 is the primary image. Simple is one gallery; compound is one per
 * variant combination, and switching keeps the other mode's images parked. Buttons rather than
 * drag and drop, because they work on a phone.
 */
const PORTRAIT = 3 / 4;
const SHAPE_TOLERANCE = 0.05;
/** The profile product photos need, and how many a gallery holds (the product contract's limit). */
const PRODUCT_PROFILE = 'product_3x4';
const GALLERY_MAX = 40;

@Component({
	selector: 'app-product-images',
	templateUrl: './product-images.html',
	styleUrls: ['./product-images.scss'],
	imports: [PluralPipe, NgTemplateOutlet, TranslocoModule, NgbAccordionModule, FormFields],
})
export class ProductImages {
	readonly value = model.required<ImagesValue>();
	readonly tiles = model.required<ReadonlyMap<string, string>>();
	/** Original width and height of each image, for the 3:4 check. */
	readonly sizes = model<ReadonlyMap<string, readonly [number, number]>>(new Map());
	readonly combinations = input.required<readonly ImageCombination[]>();
	readonly locale = input.required<string>();

	private media = inject(MediaGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	/** The primary image's alt text from the Media Library, shown in grey as what an empty field uses. */
	readonly libraryAlt = signal<Record<string, string>>({});

	constructor() {
		effect((onCleanup) => {
			const id = this.primary();
			this.libraryAlt.set({});
			if (!id) return;
			const request = this.media.details(id).subscribe({
				next: (details) => this.libraryAlt.set(details.text.alt),
				error: () => undefined,
			});
			onCleanup(() => request.unsubscribe());
		});
	}

	/** The gallery the library is adding to: null is the simple gallery. */
	private target: string | null = null;

	readonly primary = computed(() => {
		const { imageMode, gallery, compound } = this.value();
		return imageMode === 'simple' ? gallery[0] : compound.flatMap((row) => row.gallery)[0];
	});

	setMode(imageMode: ImagesValue['imageMode']): void {
		this.value.update((current) => ({ ...current, imageMode }));
	}

	gallery(hash: string | null): string[] {
		const { gallery, compound } = this.value();
		return hash === null ? gallery : (compound.find((row) => row.selectionHash === hash)?.gallery ?? []);
	}

	private write(hash: string | null, list: string[]): void {
		this.value.update((current) => {
			if (hash === null) return { ...current, gallery: list };
			const others = current.compound.filter((row) => row.selectionHash !== hash);
			return { ...current, compound: [...others, { selectionHash: hash, gallery: list }] };
		});
	}

	/** The “+” tile: the Media picker, listing photos with a Product 3:4 version (R4-2, D15). */
	async open(hash: string | null): Promise<void> {
		this.target = hash;
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		const picker = popup.componentInstance as FmPicker;
		picker.start({
			title: 'fm_pick_title_product',
			accept: 'image',
			max: GALLERY_MAX,
			already: this.gallery(hash).length,
			profile: {
				key: PRODUCT_PROFILE,
				name: this.transloco.translate(profileNameKey({ key: PRODUCT_PROFILE })),
				icon: false,
			},
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.length) this.addPicked(picked);
	}

	/** Adds the chosen photos with the version each will show; a photo already here only changes its version. */
	addPicked(picked: readonly FmPicked[]): void {
		const current = this.gallery(this.target);
		this.tiles.update(
			(tiles) =>
				new Map([
					...tiles,
					...picked.flatMap((row) => (row.thumbnailUrl ? [[row.assetId, row.thumbnailUrl] as const] : [])),
				]),
		);
		this.value.update((value) => ({
			...value,
			versions: {
				...value.versions,
				...Object.fromEntries(picked.flatMap((row) => (row.versionId ? [[row.assetId, row.versionId]] : []))),
			},
		}));
		this.write(this.target, [
			...current,
			...picked.map((row) => row.assetId).filter((id) => !current.includes(id)),
		]);
	}

	/** E04: a tile names its version when it isn't the photo as it is (“Blurred fill”). */
	versionLabel(id: string): string | null {
		const fill = this.value().versions?.[id]?.split('.')[1];
		return fill && fill !== 'as_is' ? this.transloco.translate(fillKey(fill as never, false)) : null;
	}

	/** Adds what the media library returned. An image already here is not added twice. */
	/** Positions, from 1, of images more than 5% away from the locked 3:4 shape. */
	offShape(hash: string | null): number[] {
		return this.gallery(hash).flatMap((id, index) => {
			const size = this.sizes().get(id);
			return size && Math.abs(size[0] / size[1] / PORTRAIT - 1) > SHAPE_TOLERANCE ? [index + 1] : [];
		});
	}

	move(hash: string | null, index: number, by: number): void {
		const list = this.gallery(hash);
		const to = index + by;
		if (to >= 0 && to < list.length) this.write(hash, moved(list, index, to));
	}

	makePrimary(hash: string | null, index: number): void {
		this.write(hash, moved(this.gallery(hash), index, 0));
	}

	remove(hash: string | null, index: number): void {
		this.write(
			hash,
			this.gallery(hash).filter((_, position) => position !== index),
		);
	}

	alt(): string {
		const id = this.primary();
		return id ? (this.value().altOverrides[id]?.[this.locale()] ?? '') : '';
	}

	setAlt(text: string): void {
		const id = this.primary();
		if (!id) return;
		this.value.update((current) => ({
			...current,
			altOverrides: {
				...current.altOverrides,
				[id]: { ...current.altOverrides[id], [this.locale()]: text },
			},
		}));
	}
}
