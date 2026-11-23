import { Component, inject, input, output, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { LanguageNamePipe } from '@shared/pipes/language.pipes';

import {
	ARRANGEMENT_PIECES,
	PIECE_MAX_PICTURES,
	PRODUCT_ROW_CARDS,
	SLIDE_SECONDS,
	clamp,
	pictureFor,
	piecesFor,
} from './builder-state';
import { PbPicture } from './pb-picture';
import { FmPicker, type FmPicked } from '../../media/file-manager/fm-picker';
import { profileNameKey } from '../../setting/image-profiles/profile-words';

import type { PageSection } from '@core/page-builder/page-builder.gateway';
import type { BannerArrangement } from '@saha-textile/contracts';

type Piece = Extract<PageSection, { pieces: unknown }>['pieces'][number];
type WithPieces = Extract<PageSection, { pieces: unknown }>;

/** The fixed steps of the Look tab (SG-3): never free values, so the server knows every box before it draws. */
export const LOOK_STEPS = {
	space: ['none', 's', 'm', 'l', 'xl'],
	width: ['page', 'full', 'narrow'],
	align: ['start', 'center', 'end'],
	background: ['none', 'soft', 'brand_tint', 'dark'],
} as const;

export const ARRANGEMENTS: readonly BannerArrangement[] = Object.keys(ARRANGEMENT_PIECES) as BannerArrangement[];
/** The theme's pictures of each arrangement, from Home banners (reused). */
export const ARRANGEMENT_PICTURE: Readonly<Record<BannerArrangement, string>> = {
	hero_full: 'hero_full',
	hero_main_side: 'hero_main_side',
	hero_main_stack: 'hero_main_stack',
	hero_center_sides: 'hero_center_sides',
};

/** Banner pictures keep their own shape (owner, 16 Nov: option A). */
export const BANNER_PROFILE = 'banner_keep_shape';

/**
 * A section's settings (brief B1 3, B3, B4, P4; SG-3, SG-4, SG-20, SG-21): Content (what it shows, words in the
 * language the top bar shows) and Look (fixed steps). Every change emits the whole section; the builder checks it
 * against the contract before it counts as a change.
 */
@Component({
	selector: 'app-pb-section-form',
	templateUrl: './pb-section-form.html',
	imports: [LanguageNamePipe, TranslocoModule],
})
export class PbSectionForm {
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	readonly section = input.required<PageSection>();
	readonly locale = input.required<string>();
	readonly readOnly = input(false);
	readonly changed = output<PageSection>();
	readonly tab = signal<'content' | 'look'>('content');
	readonly steps = LOOK_STEPS;
	readonly arrangements = ARRANGEMENTS;
	readonly sources = ['new_arrivals', 'bestsellers', 'on_sale', 'featured', 'category', 'tag', 'picked'] as const;
	readonly cards = PRODUCT_ROW_CARDS;
	readonly seconds = SLIDE_SECONDS;
	readonly maxPictures = PIECE_MAX_PICTURES;
	readonly shopLocales = inject(ActiveLanguages).list();

	private emit(patch: Record<string, unknown>): void {
		if (this.readOnly()) return;
		this.changed.emit({ ...structuredClone(this.section()), ...patch } as PageSection);
	}

	/** A word field in the language shown; the other languages keep theirs. */
	text(field: string): string {
		const value = (this.section() as unknown as Record<string, Record<string, string> | undefined>)[field];
		return value?.[this.locale()] ?? '';
	}

	setText(field: string, value: string): void {
		const current = (this.section() as unknown as Record<string, Record<string, string> | undefined>)[field] ?? {};
		this.emit({ [field]: { ...current, [this.locale()]: value } });
	}

	set(field: string, value: unknown): void {
		const kept = field === 'cards' ? clamp(Number(value), PRODUCT_ROW_CARDS.min, PRODUCT_ROW_CARDS.max) : value;
		this.emit({ [field]: kept });
	}

	look(field: keyof PageSection['look'], value: string): void {
		this.emit({ look: { ...this.section().look, [field]: value } });
	}

	screen(band: 'phone' | 'tablet' | 'computer', on: boolean): void {
		this.emit({ screens: { ...this.section().screens, [band]: on } });
	}

	/** SG-21: every shop language, or only the ticked ones (at least one). */
	languageOn(locale: string): boolean {
		const languages = this.section().languages;
		return languages === 'all' || languages.includes(locale);
	}

	toggleLanguage(locale: string, all: readonly string[]): void {
		const current = this.section().languages === 'all' ? [...all] : [...(this.section().languages as string[])];
		const next = current.includes(locale) ? current.filter((code) => code !== locale) : [...current, locale];
		if (next.length === 0) return;
		this.emit({ languages: next.length === all.length ? 'all' : next });
	}

	/** SG-20: from / until, as India time in the field, stored in UTC. */
	when(field: 'from' | 'until'): string {
		const value = this.section()[field];
		return value ? toLocalInput(value) : '';
	}

	setWhen(field: 'from' | 'until', value: string): void {
		this.emit({ [field]: value ? fromLocalInput(value) : null });
	}

	idsText(): string {
		return 'sourceIds' in this.section() ? (this.section() as { sourceIds: string[] }).sourceIds.join(', ') : '';
	}

	setIds(value: string): void {
		this.emit({
			sourceIds: value
				.split(/[\s,]+/)
				.map((id) => id.trim())
				.filter(Boolean)
				.slice(0, PRODUCT_ROW_CARDS.max),
		});
	}

	// ── Banner pieces (B3–B6) ──────────────────────────────────────────────────────────────────────────────

	pieces(): readonly Piece[] {
		return 'pieces' in this.section() ? (this.section() as WithPieces).pieces : [];
	}

	arrangement(value: BannerArrangement): void {
		this.emit({ arrangement: value, pieces: piecesFor(value, this.pieces()) });
	}

	private setPiece(index: number, piece: Piece): void {
		const pieces = [...this.pieces()];
		pieces[index] = piece;
		this.emit({ pieces });
	}

	/** The Media picker for a piece (B5): photos with a Banner (keep shape) version; numbers are the slide order. */
	async addPictures(index: number): Promise<void> {
		const piece = this.pieces()[index];
		if (!piece || this.readOnly()) return;
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'fm_pick_title_banner',
			accept: 'image',
			max: PIECE_MAX_PICTURES,
			already: piece.pictures.length,
			profile: {
				key: BANNER_PROFILE,
				name: this.transloco.translate(profileNameKey({ key: BANNER_PROFILE })),
				icon: false,
			},
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (!picked?.length) return;
		const room = PIECE_MAX_PICTURES - piece.pictures.length;
		const added = picked.slice(0, room).map((row) => pictureFor(row.assetId, row.versionId));
		this.setPiece(index, { ...piece, pictures: [...piece.pictures, ...added] });
	}

	/** One picture's own fields (B6), in the language the top bar shows. */
	async editPicture(pieceIndex: number, pictureIndex: number): Promise<void> {
		const piece = this.pieces()[pieceIndex];
		const picture = piece?.pictures[pictureIndex];
		if (!piece || !picture) return;
		const ref = this.modals.open(PbPicture, { size: 'lg', centered: true, scrollable: true });
		(ref.componentInstance as PbPicture).start(picture, this.locale(), this.readOnly());
		const edited = await ref.result.catch(() => null);
		if (!edited) return;
		const pictures = [...piece.pictures];
		pictures[pictureIndex] = edited;
		this.setPiece(pieceIndex, { ...piece, pictures });
	}

	movePicture(pieceIndex: number, from: number, to: number): void {
		const piece = this.pieces()[pieceIndex];
		if (!piece || to < 0 || to >= piece.pictures.length) return;
		const pictures = [...piece.pictures];
		const [moved] = pictures.splice(from, 1);
		if (moved) pictures.splice(to, 0, moved);
		this.setPiece(pieceIndex, { ...piece, pictures });
	}

	removePicture(pieceIndex: number, pictureIndex: number): void {
		const piece = this.pieces()[pieceIndex];
		if (!piece) return;
		this.setPiece(pieceIndex, { ...piece, pictures: piece.pictures.filter((_, index) => index !== pictureIndex) });
	}

	slider(pieceIndex: number, field: 'seconds' | 'controls' | 'after', value: string | number): void {
		const piece = this.pieces()[pieceIndex];
		if (!piece) return;
		const kept = field === 'seconds' ? clamp(Number(value), SLIDE_SECONDS.min, SLIDE_SECONDS.max) : value;
		this.setPiece(pieceIndex, { ...piece, slider: { ...piece.slider, [field]: kept } });
	}
}

/** An ISO time as `YYYY-MM-DDTHH:mm` in India time, for a datetime-local field. */
export function toLocalInput(iso: string): string {
	const india = new Date(Date.parse(iso) + 330 * 60_000);
	return india.toISOString().slice(0, 16);
}

/** A datetime-local value read as India time, as an ISO time in UTC. */
export function fromLocalInput(value: string): string {
	return new Date(Date.parse(`${value}:00.000Z`) - 330 * 60_000).toISOString();
}
