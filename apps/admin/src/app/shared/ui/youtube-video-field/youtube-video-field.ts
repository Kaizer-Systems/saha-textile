import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormControl } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';

import { Button } from '../button/button';

/**
 * PDP video field (owner log § Media → Video and YouTube; approved wireframe 5).
 *
 * Paste a YouTube link or id and press Validate: the API normalises it and confirms the video
 * is public and embeddable, the button turns into the video's title so the operator can see
 * the right video was matched, and the bound control receives the bare id. Editing the text
 * clears the match and the control, and while unvalidated text is present the control carries
 * a `youtubeNotValidated` error, so the product form cannot submit.
 */
@Component({
	selector: 'app-youtube-video-field',
	templateUrl: './youtube-video-field.html',
	imports: [TranslocoModule, Button],
})
export class YouTubeVideoField implements OnInit {
	private readonly gateway = inject(YouTubeGateway);

	/** Holds the validated video id, or null. */
	readonly control = input.required<FormControl<string | null>>();
	readonly id = input('youtube_video');

	readonly text = signal('');
	readonly matchedTitle = signal<string | null>(null);
	readonly error = signal<string | null>(null);
	readonly checking = signal(false);

	ngOnInit(): void {
		const existing = this.control().value;
		if (existing) {
			this.text.set(existing);
			void this.validate();
		}
	}

	edit(value: string): void {
		this.text.set(value);
		this.matchedTitle.set(null);
		this.error.set(null);
		const control = this.control();
		control.setValue(null);
		if (value.trim()) control.setErrors({ youtubeNotValidated: true });
		control.markAsTouched();
	}

	async validate(): Promise<void> {
		const value = this.text().trim();
		if (!value) return;
		this.checking.set(true);
		this.error.set(null);
		try {
			const video = await firstValueFrom(this.gateway.validate(value));
			this.matchedTitle.set(video.title);
			this.control().setValue(video.videoId);
		} catch (failure) {
			const body = (failure as { error?: { message?: string } }).error;
			this.error.set(body?.message ?? 'The video could not be checked.');
			this.control().setErrors({ youtubeNotValidated: true });
		} finally {
			this.checking.set(false);
		}
	}
}
