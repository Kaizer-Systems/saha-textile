import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import type { PiecePicture } from '@saha-textile/contracts';
import { lastValueFrom } from 'rxjs';

import { PageBuilderGateway, type WordsMapBand } from '@core/page-builder/page-builder.gateway';

import { WORD_SPOTS, linkAllowed } from './builder-state';
import { fromLocalInput, toLocalInput } from './pb-section-form';

/** The nine word spots in reading order (SG-3), drawn as a 3 × 3 grid. */
export const SPOTS = WORD_SPOTS;
export const INKS = ['brand', 'brand_dark', 'ink', 'white'] as const;
export const BACKINGS = ['none', 'soft_light', 'soft_dark'] as const;

type Ink = (typeof INKS)[number];
type Backing = (typeof BACKINGS)[number];
type Field = 'heading' | 'subheading';

/** How often, and how many times, the popup asks again while the worker measures a version. */
const MEASURE_RETRY_MS = 4000;
const MEASURE_RETRIES = 8;

/** One band of the map as the popup draws it: the picture, the nine boxes, and how the words read where they sit. */
export interface MapBandView {
	band: 'desktop' | 'phone';
	url: string | null;
	ratio: number | null;
	/** Each spot, in reading order: the words read there with the colours chosen. */
	cells: { spot: (typeof WORD_SPOTS)[number]; reads: boolean; here: boolean }[];
	reads: boolean;
	ratios: { field: Field; ratio: number }[];
}

const written = (text: Record<string, string> | undefined): boolean =>
	!!text && Object.values(text).some((value) => value.trim().length > 0);

/**
 * One picture's own fields (brief B6), in the language the builder's top bar shows: its words, alt text, link, where
 * the words sit and in which colours, whether the art carries its own words, decorative, and when it shows. Done hands
 * the edited picture back; a link must be a shop path or an https address (FX-22), and a linked picture is never
 * decorative (R4-6).
 */
@Component({
	selector: 'app-pb-picture',
	templateUrl: './pb-picture.html',
	imports: [TranslocoModule],
})
export class PbPicture {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PageBuilderGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly destroyed = inject(DestroyRef);
	private retry: ReturnType<typeof setTimeout> | null = null;
	/** The words map's bands (P5), as the API measured them. */
	readonly mapBands = signal<WordsMapBand[]>([]);
	readonly picture = signal<PiecePicture | null>(null);
	readonly locale = signal('en');
	readonly readOnly = signal(false);
	readonly linkError = signal(false);
	readonly spots = SPOTS;
	readonly inks = INKS;
	readonly backings = BACKINGS;

	start(picture: PiecePicture, locale: string, readOnly: boolean): void {
		this.picture.set(structuredClone(picture));
		this.locale.set(locale);
		this.readOnly.set(readOnly);
		this.destroyed.onDestroy(() => this.retry && clearTimeout(this.retry));
		void this.loadMap(MEASURE_RETRIES);
	}

	/** The words map for this picture's versions; asks again while the worker measures one. */
	private async loadMap(retries: number): Promise<void> {
		const picture = this.picture();
		const desktop = picture?.images.desktop;
		if (!picture || !desktop) return;
		const phone = picture.images.phone;
		const map = await lastValueFrom(
			this.gateway.wordsMap({
				desktop,
				desktopVersion: picture.versions[desktop] ?? null,
				phone,
				phoneVersion: phone ? (picture.versions[phone] ?? null) : null,
			}),
		).catch(() => null);
		if (!map) return;
		this.mapBands.set(map.bands);
		if (retries > 0 && map.bands.some((band) => band.state === 'measuring')) {
			this.retry = setTimeout(() => void this.loadMap(retries - 1), MEASURE_RETRY_MS);
		}
	}

	/** The lines with words in any language: the check covers every language (SG-1). */
	readonly fields = computed<Field[]>(() => {
		const picture = this.picture();
		if (!picture || picture.containsText) return [];
		return (['heading', 'subheading'] as const).filter((field) => written(picture[field]));
	});

	readonly measuring = computed(() => this.mapBands().some((band) => band.state === 'measuring'));
	readonly unmeasurable = computed(() => this.mapBands().some((band) => band.state === 'unmeasurable'));
	private readonly ready = computed(() => this.mapBands().filter((band) => band.state === 'ready'));

	/** Whether every written line reads at spot `index` on a band with one colour choice. */
	private reads(band: WordsMapBand, ink: Ink, backing: Backing, index: number): boolean {
		const spot = band.choices[`${ink}|${backing}`]?.[index];
		return !!spot && this.fields().every((field) => spot[field].passes);
	}

	private readonly spotIndex = computed(() => SPOTS.indexOf(this.picture()?.spot ?? 'middle_center'));

	/** P5: each band's picture with its nine boxes, for the colours and the spot chosen now. */
	readonly mapViews = computed<MapBandView[]>(() => {
		const picture = this.picture();
		if (!picture || !this.fields().length) return [];
		const here = this.spotIndex();
		return this.ready().map((band) => {
			const cells = SPOTS.map((spot, index) => ({
				spot,
				reads: this.reads(band, picture.ink, picture.backing, index),
				here: index === here,
			}));
			const at = band.choices[`${picture.ink}|${picture.backing}`]?.[here];
			return {
				band: band.band,
				url: band.url,
				ratio: band.ratio,
				cells,
				reads: cells[here]?.reads ?? false,
				ratios: this.fields().map((field) => ({ field, ratio: at?.[field].ratio ?? 0 })),
			};
		});
	});

	/** The words don't read where they sit on some band. */
	readonly failing = computed(() => this.mapViews().some((view) => !view.reads));

	/**
	 * Colour choices that read at this spot on every band, with the lowest ratio they reach: other colours first, then a
	 * backing, as the Go Live check lists them; three at most.
	 */
	readonly fixes = computed<{ ink: Ink; backing: Backing; ratio: number }[]>(() => {
		const picture = this.picture();
		if (!picture || !this.failing()) return [];
		const here = this.spotIndex();
		const found: { ink: Ink; backing: Backing; ratio: number }[] = [];
		for (const backing of BACKINGS) {
			for (const ink of INKS) {
				if (ink === picture.ink && backing === picture.backing) continue;
				const bands = this.ready();
				if (!bands.every((band) => this.reads(band, ink, backing, here))) continue;
				const ratios = bands.flatMap((band) =>
					this.fields().map((field) => band.choices[`${ink}|${backing}`]?.[here]?.[field].ratio ?? 0),
				);
				found.push({ ink, backing, ratio: Math.min(...ratios) });
			}
		}
		return found.slice(0, 3);
	});

	/** Other spots where the words read with the colours chosen now, on every band. */
	readonly otherSpots = computed(() => {
		const picture = this.picture();
		if (!picture || !this.failing()) return [];
		return SPOTS.filter(
			(spot, index) =>
				index !== this.spotIndex() &&
				this.ready().every((band) => this.reads(band, picture.ink, picture.backing, index)),
		);
	});

	bandLine(view: MapBandView): string {
		const band = this.transloco.translate('pb_band_' + view.band);
		return this.transloco.translate(view.reads ? 'pb_words_band_reads' : 'pb_words_band_hard', { band });
	}

	ratioLine(line: { field: Field; ratio: number }): string {
		const field = this.transloco.translate('banner_' + line.field);
		return this.transloco.translate('pb_words_ratio', { field, ratio: line.ratio });
	}

	fixLine(fix: { ink: Ink; backing: Backing; ratio: number }): string {
		if (fix.backing === 'none') {
			return this.transloco.translate('pb_fix_item_plain', {
				ink: this.transloco.translate('pb_ink_' + fix.ink),
				ratio: fix.ratio,
			});
		}
		return this.transloco.translate('pb_fix_item', {
			ink: this.transloco.translate('pb_ink_' + fix.ink),
			backing: this.transloco.translate('pb_backing_' + fix.backing),
			ratio: fix.ratio,
		});
	}

	useFix(fix: { ink: Ink; backing: Backing }): void {
		this.patch({ ink: fix.ink, backing: fix.backing });
	}

	private patch(change: Partial<PiecePicture>): void {
		const current = this.picture();
		if (current && !this.readOnly()) this.picture.set({ ...current, ...change });
	}

	text(field: 'heading' | 'subheading' | 'ctaLabel' | 'alt'): string {
		return this.picture()?.[field][this.locale()] ?? '';
	}

	setText(field: 'heading' | 'subheading' | 'ctaLabel' | 'alt', value: string): void {
		const current = this.picture()?.[field] ?? {};
		this.patch({ [field]: { ...current, [this.locale()]: value } } as Partial<PiecePicture>);
	}

	set<K extends keyof PiecePicture>(field: K, value: PiecePicture[K]): void {
		this.patch({ [field]: value } as Partial<PiecePicture>);
	}

	setLink(href: string): void {
		const trimmed = href.trim();
		if (!trimmed) {
			this.linkError.set(false);
			this.patch({ link: null });
			return;
		}
		const allowed = linkAllowed(trimmed) && trimmed.length <= 500;
		this.linkError.set(!allowed);
		if (allowed) this.patch({ link: { href: trimmed, external: /^https:/.test(trimmed) }, decorative: false });
	}

	when(field: 'from' | 'until'): string {
		const value = this.picture()?.[field];
		return value ? toLocalInput(value) : '';
	}

	setWhen(field: 'from' | 'until', value: string): void {
		this.patch({ [field]: value ? fromLocalInput(value) : null } as Partial<PiecePicture>);
	}

	done(): void {
		if (!this.linkError()) this.modal.close(this.picture());
	}
}
