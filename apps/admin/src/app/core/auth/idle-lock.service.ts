import { Injectable, inject, signal } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { AuthStore } from '@core/state/auth.store';

/** Admin soft-lock idle window (owner lock — 15 minutes). Must stay below admin server idle TTL. */
export const ADMIN_SOFT_LOCK_MS = 15 * 60 * 1000;

/**
 * Tracks operator presence and raises the idle soft-lock overlay.
 *
 * The soft-lock is a client presence check; the server session idle window is longer so
 * PIN/password resume can still rotate a live session. On lock (and when the tab becomes
 * visible while unlocked), we refresh cookies so an expired access JWT does not block
 * `POST /auth/admin/resume` after a long mouse-idle stretch.
 *
 * UI: theme-modal + pin-pad; page obscure via theme `.idle-lock-backdrop`.
 */
@Injectable({ providedIn: 'root' })
export class IdleLockService {
	private readonly auth = inject(AuthStore);
	private readonly gateway = inject(AdminAuthGateway);

	readonly locked = signal(false);

	private lastActivity = Date.now();
	private timer: ReturnType<typeof setInterval> | null = null;
	private listening = false;

	private readonly onActivity = () => {
		if (this.locked()) return;
		this.lastActivity = Date.now();
	};

	private readonly onVisibility = () => {
		if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
		if (!this.auth.isAuthenticated() || this.locked()) return;
		void this.refreshCookiesQuietly();
	};

	start(): void {
		if (typeof window === 'undefined' || this.listening) return;
		this.listening = true;
		for (const event of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const) {
			window.addEventListener(event, this.onActivity, { passive: true });
		}
		document.addEventListener('visibilitychange', this.onVisibility);
		this.timer = setInterval(() => this.tick(), 15_000);
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		for (const event of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const) {
			window.removeEventListener(event, this.onActivity);
		}
		document.removeEventListener('visibilitychange', this.onVisibility);
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.listening = false;
		this.locked.set(false);
	}

	/** Soft-lock immediately. Refresh keeps access cookies usable for resume. */
	lock(): void {
		if (!this.auth.isAuthenticated()) return;
		this.locked.set(true);
		void this.refreshCookiesQuietly();
	}

	unlock(): void {
		this.lastActivity = Date.now();
		this.locked.set(false);
	}

	private tick(): void {
		if (!this.auth.isAuthenticated()) {
			this.locked.set(false);
			return;
		}
		if (this.locked()) return;
		if (Date.now() - this.lastActivity >= ADMIN_SOFT_LOCK_MS) {
			this.lock();
		}
	}

	private async refreshCookiesQuietly(): Promise<void> {
		try {
			await firstValueFrom(this.gateway.refreshSession());
		} catch {
			// Auth interceptor clears the session on unrecoverable 401; App redirects to login.
		}
	}
}
