import { Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { DocumentLocksGateway } from '@core/accounts/document-locks.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import type { DocumentLock } from '@saha-textile/contracts';

/** How often the holder says they are still here, and how often a reader looks again. */
export const LOCK_HEARTBEAT_MS = 30_000;
export const LOCK_POLL_MS = 15_000;
/** The holder counts as present while they touched the page within this (the lock goes stale after 2 minutes). */
const PRESENT_MS = 2 * 60_000;

/**
 * B7, D10: one person edits a draft at a time. The holder keeps it while active on the page and lets it go on
 * leaving; everyone else reads it under a banner naming who holds it, may ask them to release it, and a super admin
 * may take it over. `editable` tells the page whether this person may change it now.
 */
@Component({
	selector: 'app-document-lock',
	imports: [TranslocoModule],
	templateUrl: './document-lock.html',
	host: { '(document:pointerdown)': 'touched()', '(document:keydown)': 'touched()' },
})
export class DocumentLockBanner {
	private readonly gateway = inject(DocumentLocksGateway);
	private readonly auth = inject(AuthStore);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly documentType = input.required<string>();
	readonly documentId = input.required<string>();
	/** Only drafts are locked; an issued document is never edited. */
	readonly active = input(true);
	readonly editable = output<boolean>();

	readonly mine = signal(false);
	readonly holder = signal<DocumentLock | null>(null);
	readonly holderRole = signal<string | null>(null);
	readonly askedBy = signal<string | null>(null);
	readonly busy = signal(false);
	/** After "Release it" this page stops taking the draft back; a reload does. */
	private released = false;
	private lastTouched = Date.now();
	private lastBeat = 0;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		effect(() => {
			const [type, id, active] = [this.documentType(), this.documentId(), this.active()];
			untracked(() => this.start(type, id, active));
		});
		inject(DestroyRef).onDestroy(() => this.stop(true));
	}

	touched(): void {
		this.lastTouched = Date.now();
	}

	private me(): string | null {
		return this.auth.user()?.id ?? null;
	}

	private set(mine: boolean, holder: DocumentLock | null): void {
		// Taking it counts as the first sign of life.
		if (mine && !this.mine()) this.lastBeat = Date.now();
		this.mine.set(mine);
		this.holder.set(mine ? null : holder);
		this.editable.emit(mine);
	}

	private start(type: string, id: string, active: boolean): void {
		this.stop(false);
		this.released = false;
		if (!active) {
			this.set(false, null);
			return;
		}
		void this.claim(type, id);
		this.timer = setInterval(() => void this.tick(type, id), LOCK_POLL_MS);
	}

	private stop(leaving: boolean): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		if (leaving && this.mine()) void firstValueFrom(this.gateway.release(this.documentType(), this.documentId()));
	}

	private async claim(type: string, id: string): Promise<void> {
		const lock = await firstValueFrom(this.gateway.claim(type, id));
		if (lock.holderId === this.me()) {
			this.set(true, null);
			this.askedBy.set(null);
			return;
		}
		await this.look(type, id);
	}

	/** Who holds it now, their role, and whether someone asked this holder to let it go. */
	private async look(type: string, id: string): Promise<void> {
		const { lock, role } = await firstValueFrom(this.gateway.current(type, id));
		this.holderRole.set(role);
		if (lock && lock.holderId === this.me()) {
			this.askedBy.set(lock.releaseAskedBy);
			return;
		}
		this.set(false, lock);
	}

	private async tick(type: string, id: string): Promise<void> {
		if (!this.mine()) {
			if (this.released) await this.look(type, id);
			else await this.claim(type, id);
			return;
		}
		const now = Date.now();
		if (now - this.lastBeat < LOCK_HEARTBEAT_MS || now - this.lastTouched > PRESENT_MS) return;
		this.lastBeat = now;
		const { held } = await firstValueFrom(this.gateway.heartbeat(type, id));
		if (held) await this.look(type, id);
		else await this.claim(type, id);
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	ask(): Promise<void> {
		return this.run(async () => {
			await firstValueFrom(this.gateway.askRelease(this.documentType(), this.documentId()));
			this.notifier.showSuccess(
				this.transloco.translate('lock_asked', { name: this.holder()?.holderName ?? '' }),
			);
		});
	}

	takeOver(): Promise<void> {
		return this.run(async () => {
			await firstValueFrom(this.gateway.takeOver(this.documentType(), this.documentId()));
			this.set(true, null);
			this.notifier.showSuccess(this.transloco.translate('lock_taken_over'));
		});
	}

	release(): Promise<void> {
		return this.run(async () => {
			await firstValueFrom(this.gateway.release(this.documentType(), this.documentId()));
			this.released = true;
			this.askedBy.set(null);
			this.set(false, null);
		});
	}

	/** "10:42" and how long ago the holder was last active. */
	since(lock: DocumentLock): { time: string; n: number; unit: 'seconds' | 'minutes' } {
		const time = new Date(lock.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
		const seconds = Math.max(0, Math.round((Date.now() - new Date(lock.lastActiveAt).getTime()) / 1000));
		return seconds < 60
			? { time, n: seconds, unit: 'seconds' }
			: { time, n: Math.round(seconds / 60), unit: 'minutes' };
	}
}
