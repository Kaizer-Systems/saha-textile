import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { formatList } from '@saha-textile/core-domain/languages';

import { injectMediaProfilesQuery } from '@data-access/queries/media-profiles.queries';

import { profileNameKey, shapeBox } from '../../setting/image-profiles/profile-words';

/** A point as fractions of the upright photo. */
export interface FmPoint {
	x: number;
	y: number;
}

export interface FmFocalInput {
	name: string;
	/** The whole photo (its original, through a 5-minute address). */
	picture: string;
	width: number;
	height: number;
	focal: FmPoint | null;
	/** The photo's Crop versions, by profile key. */
	crops: string[];
}

/** What a preview box shows: its size and where the photo sits in it, exactly as the image worker will crop. */
export interface FmCropPreview {
	key: string;
	name: string;
	width: number;
	height: number;
	/** CSS object-position for the point, and for today's crop. */
	withPoint: string;
	today: string;
}

const CENTRE: FmPoint = { x: 0.5, y: 0.5 };
/** Preview boxes fit inside this many pixels on their long side. */
const PREVIEW = 240;

/**
 * Where an object-fit: cover picture sits so the box shows the window the worker crops: the largest window of the
 * box's shape, centred on the point as far as the photo allows (as the worker's `focalWindow`).
 */
export function previewPosition(
	photo: { width: number; height: number },
	box: { width: number; height: number },
	point: FmPoint,
): string {
	const ratio = box.width / box.height;
	const keepWidth = photo.width / photo.height > ratio ? photo.height * ratio : photo.width;
	const keepHeight = photo.width / photo.height > ratio ? photo.height : photo.width / ratio;
	const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
	const left = clamp(point.x * photo.width - keepWidth / 2, photo.width - keepWidth);
	const top = clamp(point.y * photo.height - keepHeight / 2, photo.height - keepHeight);
	const across = photo.width > keepWidth ? left / (photo.width - keepWidth) : 0.5;
	const down = photo.height > keepHeight ? top / (photo.height - keepHeight) : 0.5;
	return `${Math.round(across * 1000) / 10}% ${Math.round(down * 1000) / 10}%`;
}

/**
 * Focal point (media step 3c; brief S10, C06): click the part of the photo that must stay in every crop. Each Crop
 * version is previewed with the point and as it is today, exactly as the image worker will cut it. Saving remakes
 * only the cropped sizes; White padding and Blurred fill always show the whole photo.
 */
@Component({
	selector: 'app-fm-focal',
	templateUrl: './fm-focal.html',
	imports: [TranslocoModule],
})
export class FmFocal {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);
	private readonly profilesQuery = injectMediaProfilesQuery();

	readonly input = signal<FmFocalInput | null>(null);
	readonly point = signal<FmPoint>(CENTRE);

	readonly previews = computed<FmCropPreview[]>(() => {
		const input = this.input();
		if (!input) return [];
		const profiles = new Map((this.profilesQuery.data() ?? []).map((item) => [item.profile.key, item.profile]));
		const photo = { width: input.width, height: input.height };
		return input.crops.flatMap((key) => {
			const shape = profiles.get(key)?.shape;
			if (!shape) return [];
			const box = shapeBox(shape);
			const scale = PREVIEW / Math.max(box.width, box.height);
			return [
				{
					key,
					name: this.profileName(key),
					width: Math.round(box.width * scale),
					height: Math.round(box.height * scale),
					withPoint: previewPosition(photo, shape, this.point()),
					today: previewPosition(photo, shape, input.focal ?? CENTRE),
				},
			];
		});
	});

	readonly cropNames = computed(() =>
		formatList(
			this.previews().map((row) => row.name),
			this.transloco.getActiveLang(),
		),
	);

	start(input: FmFocalInput): void {
		this.input.set(input);
		this.point.set(input.focal ?? CENTRE);
	}

	/** A click on the photo puts the point there. */
	pick(event: MouseEvent): void {
		const target = event.currentTarget as HTMLElement | null;
		const box = target?.getBoundingClientRect();
		if (!box?.width || !box.height) return;
		const clamp = (value: number) => Math.min(1, Math.max(0, value));
		this.point.set({
			x: Math.round(clamp((event.clientX - box.left) / box.width) * 1000) / 1000,
			y: Math.round(clamp((event.clientY - box.top) / box.height) * 1000) / 1000,
		});
	}

	reset(): void {
		this.modal.close({ focal: null });
	}

	save(): void {
		this.modal.close({ focal: this.point() });
	}

	private profileName(key: string): string {
		const nameKey = profileNameKey({ key });
		const name = this.transloco.translate(nameKey);
		return name === nameKey ? key : name;
	}
}
