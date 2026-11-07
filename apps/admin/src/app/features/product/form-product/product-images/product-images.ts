import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, model, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbAccordionModule } from '@ng-bootstrap/ng-bootstrap';
import type { ProductContentWrite } from '@saha-textile/contracts';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { MediaModal } from '@shared/ui/modal/media-modal/media-modal';

type ImagesValue = Pick<ProductContentWrite, 'imageMode' | 'gallery' | 'compound' | 'altOverrides'>;

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

@Component({
	selector: 'app-product-images',
	templateUrl: './product-images.html',
	styleUrls: ['./product-images.scss'],
	imports: [NgTemplateOutlet, TranslocoModule, NgbAccordionModule, FormFields, MediaModal],
})
export class ProductImages {
	readonly value = model.required<ImagesValue>();
	readonly tiles = model.required<ReadonlyMap<string, string>>();
	/** Original width and height of each image, for the 3:4 check. */
	readonly sizes = model<ReadonlyMap<string, readonly [number, number]>>(new Map());
	readonly combinations = input.required<readonly ImageCombination[]>();
	readonly locale = input.required<string>();

	readonly picker = viewChild<MediaModal>('picker');
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

	open(hash: string | null): void {
		this.target = hash;
		void this.picker()?.openModal();
	}

	/** Adds what the media library returned. An image already here is not added twice. */
	/** Positions, from 1, of images more than 5% away from the locked 3:4 shape. */
	offShape(hash: string | null): number[] {
		return this.gallery(hash).flatMap((id, index) => {
			const size = this.sizes().get(id);
			return size && Math.abs(size[0] / size[1] / PORTRAIT - 1) > SHAPE_TOLERANCE ? [index + 1] : [];
		});
	}

	add(picked: IAttachment | IAttachment[]): void {
		const rows = Array.isArray(picked) ? picked : [picked];
		const current = this.gallery(this.target);
		const fresh = rows.filter((row) => !current.includes(String(row.id)));
		this.sizes.update(
			(sizes) =>
				new Map([
					...sizes,
					...rows.flatMap((row) =>
						row.width && row.height ? [[String(row.id), [row.width, row.height]] as const] : [],
					),
				]),
		);
		this.tiles.update(
			(tiles) => new Map([...tiles, ...rows.map((row) => [String(row.id), row.original_url] as [string, string])]),
		);
		this.write(this.target, [...current, ...fresh.map((row) => String(row.id))]);
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
