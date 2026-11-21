import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { firstValueFrom } from 'rxjs';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { LookPreview } from '../look-preview/look-preview';

import type { MediaCutRegion, MediaCutSource } from '@saha-textile/contracts';

/** What the pop-up was opened for: the value's chosen picture (a photo, or a cut of one) and how the value is named. */
export interface SwatchCutStart {
	pictureId: string;
	valueName: string;
	/** Rupees the value adds, for the picture-row preview. */
	price?: number | null;
}

/** The pop-up's answer: a cut to use, or the whole photo (today's square from its middle). */
export type SwatchCutResult = { kind: 'cut'; id: string; versionId: string } | { kind: 'whole'; photoId: string };

/** Twice the largest swatch file (240 px): a smaller square still saves, with "This will look soft". */
const SHARP_PX = 480;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
/** The square a new cut starts with: about 600 px of the original, as the brief drew it. */
const START_PX = 600;
/** The four looks that draw a picture, as the brief's previews list them. */
export const CUT_LOOKS = ['image_swatch', 'image_tile', 'picture_row', 'picture_chip'] as const;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * The swatch cut pop-up (owner, 21 Nov 2026, product page brief P11): drag a square onto the fabric of the photo, zoom
 * it 1–6×, see it at once in every picture look, then Save cut, or Use the whole photo for today's behaviour. The photo
 * itself never changes; the image worker cuts the square from its original.
 */
@Component({
	selector: 'app-swatch-cut',
	templateUrl: './swatch-cut.html',
	styleUrls: ['./swatch-cut.scss'],
	imports: [TranslocoModule, LookPreview],
})
export class SwatchCut {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly transloco = inject(TranslocoService);

	readonly looks = CUT_LOOKS;
	readonly start$ = signal<SwatchCutStart | null>(null);
	readonly source = signal<MediaCutSource | null>(null);
	readonly problem = signal<string | null>(null);
	readonly saving = signal(false);
	/** How far the square is zoomed in: 1 is a square the photo's short edge wide. */
	readonly zoom = signal(3);
	/** The square's middle, as fractions of the photo. */
	readonly centre = signal({ x: 0.5, y: 0.5 });

	/** The zoom as the label shows it: one decimal, as the brief drew "3.3×". */
	readonly zoomLabel = computed(() => this.zoom().toFixed(1));

	/** The square's side in pixels of the original. */
	readonly px = computed(() => {
		const photo = this.source();
		return photo ? Math.round(Math.min(photo.width, photo.height) / this.zoom()) : 0;
	});
	readonly soft = computed(() => this.px() > 0 && this.px() < SHARP_PX);

	/** The square as the API takes it: inside the photo, square in pixels. */
	readonly region = computed<MediaCutRegion | null>(() => {
		const photo = this.source();
		if (!photo) return null;
		const width = this.px() / photo.width;
		const height = this.px() / photo.height;
		return {
			x: clamp(this.centre().x - width / 2, 0, 1 - width),
			y: clamp(this.centre().y - height / 2, 0, 1 - height),
			width,
			height,
		};
	});

	/** The value as each preview draws it: the photo's square, the value's name and price. */
	readonly previewValues = computed(() => {
		const photo = this.source();
		const region = this.region();
		const start = this.start$();
		return photo && region && start
			? [{ label: start.valueName, picture: photo.url, crop: region, price: start.price ?? 0 }]
			: [];
	});

	async start(start: SwatchCutStart): Promise<void> {
		this.start$.set(start);
		try {
			const source = await firstValueFrom(this.gateway.cutSource(start.pictureId));
			this.source.set(source);
			if (source.region) {
				// Cut again: the pop-up reopens on the same square.
				const side = source.region.width * source.width;
				this.zoom.set(clamp(Math.min(source.width, source.height) / side, MIN_ZOOM, MAX_ZOOM));
				this.centre.set({
					x: source.region.x + source.region.width / 2,
					y: source.region.y + source.region.height / 2,
				});
			} else {
				this.zoom.set(clamp(Math.min(source.width, source.height) / START_PX, MIN_ZOOM, MAX_ZOOM));
			}
		} catch (error) {
			this.problem.set(readApiErrorMessage(error) ?? this.transloco.translate('cut_failed'));
		}
	}

	setZoom(value: number): void {
		this.zoom.set(clamp(Math.round(value * 10) / 10, MIN_ZOOM, MAX_ZOOM));
	}

	/** Moves the square's middle by fractions of the photo, kept so the square stays inside it. */
	move(dx: number, dy: number): void {
		const region = this.region();
		if (!region) return;
		this.centre.update(({ x, y }) => ({
			x: clamp(x + dx, region.width / 2, 1 - region.width / 2),
			y: clamp(y + dy, region.height / 2, 1 - region.height / 2),
		}));
	}

	/** Puts the square's middle where the photo was pressed (a tap moves it there; a drag follows). */
	placeAt(x: number, y: number): void {
		const region = this.region();
		if (!region) return;
		this.centre.set({
			x: clamp(x, region.width / 2, 1 - region.width / 2),
			y: clamp(y, region.height / 2, 1 - region.height / 2),
		});
	}

	private dragging = false;

	/** Pointer on the photo: the square follows it until the pointer is let go. */
	press(event: PointerEvent): void {
		this.dragging = true;
		(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
		this.follow(event);
	}

	follow(event: PointerEvent): void {
		if (!this.dragging) return;
		const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
		if (!box?.width || !box.height) return;
		this.placeAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
	}

	release(): void {
		this.dragging = false;
	}

	/** Arrow keys move the square a little, so it can be placed without a pointer. */
	nudge(event: KeyboardEvent): void {
		const step = event.shiftKey ? 0.05 : 0.01;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step],
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		this.move(move[0], move[1]);
	}

	useWhole(): void {
		const photo = this.source();
		if (photo) this.modal.close({ kind: 'whole', photoId: photo.photoId } satisfies SwatchCutResult);
	}

	async save(): Promise<void> {
		const photo = this.source();
		const region = this.region();
		if (!photo || !region || this.saving()) return;
		this.saving.set(true);
		this.problem.set(null);
		try {
			// The cut the value held is named, so the server deletes it once nothing uses it (owner, 22 Nov 2026).
			const made = await firstValueFrom(
				this.gateway.cut(photo.photoId, { region, ...(photo.cutId ? { replaces: photo.cutId } : {}) }),
			);
			this.modal.close({ kind: 'cut', id: made.id, versionId: made.versionId } satisfies SwatchCutResult);
		} catch (error) {
			this.problem.set(readApiErrorMessage(error) ?? this.transloco.translate('cut_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
