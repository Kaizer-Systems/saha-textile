import { Injectable, inject, signal } from '@angular/core';

import { withBrowserLock } from '@saha-textile/http-transport';
import { firstValueFrom } from 'rxjs';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { SESSION_REFRESH_LOCK } from '@core/auth/session-refresh-lock';
import { AuthStore } from '@core/state/auth.store';

/** Admin soft-lock idle window (owner lock — 15 minutes). Must stay below admin server idle TTL. */
export const ADMIN_SOFT_LOCK_MS = 15 * 60 * 1000;

/** A tab flicking hidden/visible repeatedly needs one refresh, not one per flick. */
const QUIET_REFRESH_MIN_GAP_MS = 60_000;

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

	/**
	 * Takes the same Web Lock as the interceptor's rotation. Refresh tokens rotate on use and a
	 * second presentation of the old one is treated as theft, so two refreshes in flight at
	 * once — a visibility flick racing a 401 recovery, or two quick flicks — used to revoke the
	 * whole session and sign the operator out. Serialised, the second one carries the new
	 * cookie. Throttled too, since a refresh a few seconds old is still fresh.
	 */
	private lastQuietRefresh = 0;

	private async refreshCookiesQuietly(): Promise<void> {
		if (Date.now() - this.lastQuietRefresh < QUIET_REFRESH_MIN_GAP_MS) return;
		this.lastQuietRefresh = Date.now();
		try {
			await withBrowserLock(SESSION_REFRESH_LOCK, () => firstValueFrom(this.gateway.refreshSession()));
		} catch {
			// Auth interceptor clears the session on unrecoverable 401; App redirects to login.
		}
	}
}
