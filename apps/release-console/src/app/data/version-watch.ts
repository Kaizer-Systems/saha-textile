import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

import { ConsoleApi } from './console-api';

/** How often a tab in view asks whether a newer console is running. */
export const CHECK_EVERY = 120_000;
/** How soon a tab asks again while the console is not answering (a restart). */
export const RETRY_EVERY = 10_000;

/**
 * Whether a newer Release Console started since this tab loaded (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part B, approved
 * 24 Nov: Q3 A banner, Q4 A never reload by itself). The tab keeps the fingerprint of the app it loaded with and
 * compares it with the console API's when the tab comes back into view, every 2 minutes while it is in view, and as
 * soon as the console answers again after not answering. A tab out of view asks nothing.
 */
@Injectable({ providedIn: 'root' })
export class VersionWatch {
	private readonly api = inject(ConsoleApi);
	private readonly doc = inject(DOCUMENT);
	/** The app this tab runs: the first fingerprint the console API gave it. */
	private loaded: string | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private ticking = false;
	/** Fields typed in on this page (search boxes aside), kept until they are gone or empty. */
	private readonly typedIn = new Set<HTMLInputElement | HTMLTextAreaElement>();
	private readonly tick = signal(0);
	/** When this tab loaded (ISO). */
	readonly loadedAt = new Date(performance.timeOrigin).toISOString();
	/** When the newer console started, once there is one; null while this tab runs the newest. */
	readonly newer = signal<string | null>(null);
	/** "Not yet" hides the banner until the next check finds the newer console again. */
	readonly hidden = signal(false);

	start(): void {
		const inView = () => !this.doc.hidden;
		this.doc.addEventListener('visibilitychange', () => {
			if (inView()) void this.check();
		});
		this.doc.addEventListener('input', (e) => this.typed(e.target));
		setInterval(() => {
			if (inView()) void this.check();
		}, CHECK_EVERY);
		void this.check();
	}

	async check(): Promise<void> {
		const health = await this.api.health().catch(() => null);
		if (!health) return this.later();
		if (!health.build) return;
		if (this.loaded === null) this.loaded = health.build;
		else if (health.build !== this.loaded) this.found(health.startedAt);
	}

	/** Text typed on this page and not sent yet: a field still on the page, not empty. */
	typedNotSent(): boolean {
		this.tick();
		for (const field of this.typedIn) if (!field.isConnected || !field.value) this.typedIn.delete(field);
		return this.typedIn.size > 0;
	}

	reload(): void {
		this.doc.location.reload();
	}

	private found(startedAt: string): void {
		this.newer.set(startedAt);
		this.hidden.set(false);
		// While the banner shows, it looks again each second for typed text sent or cleared.
		if (!this.ticking) setInterval(() => this.tick.update((n) => n + 1), 1_000);
		this.ticking = true;
	}

	private typed(target: EventTarget | null): void {
		const field = target as HTMLInputElement | HTMLTextAreaElement | null;
		if (field && 'value' in field && (field as HTMLInputElement).type !== 'search') this.typedIn.add(field);
		this.tick.update((n) => n + 1);
	}

	private later(): void {
		if (this.retry || this.doc.hidden) return;
		this.retry = setTimeout(() => {
			this.retry = null;
			void this.check();
		}, RETRY_EVERY);
	}
}
