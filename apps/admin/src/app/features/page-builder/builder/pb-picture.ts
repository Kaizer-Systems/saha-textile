import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import type { PiecePicture } from '@saha-textile/contracts';

import { WORD_SPOTS, linkAllowed } from './builder-state';
import { fromLocalInput, toLocalInput } from './pb-section-form';

/** The nine word spots in reading order (SG-3), drawn as a 3 × 3 grid. */
export const SPOTS = WORD_SPOTS;
export const INKS = ['brand', 'brand_dark', 'ink', 'white'] as const;
export const BACKINGS = ['none', 'soft_light', 'soft_dark'] as const;

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
