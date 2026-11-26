import { Component, inject, input, signal } from '@angular/core';
import { FormControl } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';

import { Button } from '../button/button';

import type { ProductVideo } from '@saha-textile/contracts';

/** Videos one product may carry (owner, 2026-11-10; `PRODUCT_VIDEOS_MAX` in contracts). */
export const PRODUCT_VIDEOS_LIMIT = 5;

/** `25:21`, `1:02:03`, `0:48`. */
export const videoLength = (seconds: number): string => {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, '0');
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/**
 * The product's YouTube videos (owner, 2026-11-10: brief revision 4, decisions R2 and R3).
 *
 * The product FAQ's repeatable rows around one link box. A pasted link (or Enter, or Validate for
 * a typed id) is checked by the API at once: it must be public and embeddable, and the answer
 * carries its title, length and whether it is a Short, so admin never picks long or short. Only
 * checked videos reach the control, so nothing unchecked is ever saved. Up to five, each once,
 * in the order shown; the first shows first on the product page.
 */
@Component({
	selector: 'app-youtube-videos-field',
	templateUrl: './youtube-videos-field.html',
	imports: [TranslocoModule, Button],
})
export class YouTubeVideosField {
	private readonly gateway = inject(YouTubeGateway);
	private readonly transloco = inject(TranslocoService);

	readonly control = input.required<FormControl<ProductVideo[]>>();
	readonly id = input('product_video_input');

	readonly max = PRODUCT_VIDEOS_LIMIT;
	readonly length = videoLength;
	readonly text = signal('');
	readonly error = signal<string | null>(null);
	readonly checking = signal(false);
	/** The link box shows while the list is empty, or after "Add another video". */
	readonly adding = signal(false);

	edit(value: string): void {
		this.text.set(value);
		this.error.set(null);
	}

	/** A paste is a whole link, so it is checked straight away. */
	pasted(event: ClipboardEvent): void {
		const value = event.clipboardData?.getData('text') ?? '';
		if (!value.trim()) return;
		event.preventDefault();
		this.edit(value);
		void this.validate();
	}

	async validate(): Promise<void> {
		const value = this.text().trim();
		if (!value || this.checking()) return;
		this.checking.set(true);
		try {
			const video = await firstValueFrom(this.gateway.validate(value));
			const rows = this.control().value;
			if (rows.some((row) => row.videoId === video.videoId)) {
				this.error.set(this.transloco.translate('product_video_already_added'));
				return;
			}
			if (rows.length >= this.max) return;
			this.control().setValue([...rows, video]);
			this.control().markAsDirty();
			this.text.set('');
			this.adding.set(false);
		} catch (failure) {
			const body = (failure as { error?: { message?: unknown } }).error;
			this.error.set(
				typeof body?.message === 'string'
					? body.message
					: this.transloco.translate('product_video_check_failed'),
			);
		} finally {
			this.checking.set(false);
		}
	}

	move(index: number, by: -1 | 1): void {
		const rows = [...this.control().value];
		const [row] = rows.splice(index, 1);
		if (!row) return;
		rows.splice(index + by, 0, row);
		this.control().setValue(rows);
		this.control().markAsDirty();
	}

	remove(index: number): void {
		this.control().setValue(this.control().value.filter((_, at) => at !== index));
		this.control().markAsDirty();
	}
}
