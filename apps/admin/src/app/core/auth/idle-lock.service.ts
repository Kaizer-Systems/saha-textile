import { Injectable, inject, signal } from '@angular/core';

import { withBrowserLock } from '@saha-textile/http-transport';
import { firstValueFrom, type Observable } from 'rxjs';

// Relative imports: Storybook's path map resolves `@core/*` to the storefront first, and this
// service needs the admin AuthStore (`sessionLocked`).
import { AdminAuthGateway } from './auth-gateway';
import { SESSION_REFRESH_LOCK } from './session-refresh-lock';
import { AuthStore } from '../state/auth.store';

/** Admin soft-lock idle window (owner lock — 15 minutes). Must stay below admin server idle TTL. */
export const ADMIN_SOFT_LOCK_MS = 15 * 60 * 1000;

/** A tab flicking hidden/visible repeatedly needs one refresh, not one per flick. */
const QUIET_REFRESH_MIN_GAP_MS = 60_000;

/** The server is told the operator is present at most this often (it locks after 15 minutes without). */
export const ACTIVITY_SIGNAL_GAP_MS = 60_000;

/** Tabs share activity, lock and unlock through this channel, so they lock and unlock together. */
const CHANNEL_NAME = 'st-admin-session';

type ChannelMessage =
	{ type: 'activity'; at: number } | { type: 'signal'; at: number } | { type: 'locked' } | { type: 'unlocked' };

/**
 * Tracks operator presence and raises the 15-minute lock (owner, 2026-11-20: held by the server).
 *
 * - Presence: typing, clicking, scrolling or touching in ANY open admin tab counts. Tabs share it,
 *   and one of them tells the server at most once a minute (`markActivity`). Background reads
 *   never do, so an unattended session locks on the server too.
 * - Lock: after 15 minutes without presence the tab tells the server (`lockSession`), which then
 *   refuses every admin call with `session_locked` until the PIN or password. A reload, a new tab
 *   or a laptop waking up comes back to the lock (`/me` says `locked`).
 * - Nothing is lost: the page stays mounted behind the lock, and any call refused while locked
 *   waits (`whenUnlocked`) and is sent again after the PIN or password.
 *
 * UI: theme-modal + pin-pad; page obscure via theme `.idle-lock-backdrop`.
 */
@Injectable({ providedIn: 'root' })
export class IdleLockService {
	private readonly auth = inject(AuthStore);
	private readonly gateway = inject(AdminAuthGateway);

	readonly locked = signal(false);

	private lastActivity = Date.now();
	private lastSignal = 0;
	private lastBroadcast = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private listening = false;
	private channel: BroadcastChannel | null = null;
	private waiters: Array<() => void> = [];
	/** False after a lock call failed; the timer keeps asking until the server has the lock. */
	private serverHasLock = true;
	private lockCall: Promise<void> | null = null;

	private readonly onActivity = () => {
		if (this.locked()) return;
		const now = Date.now();
		this.lastActivity = now;
		if (now - this.lastBroadcast > 5_000) {
			this.lastBroadcast = now;
			this.post({ type: 'activity', at: now });
		}
		this.signalPresence(now);
	};

	private readonly onVisibility = () => {
		if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
		if (!this.auth.isAuthenticated() || this.locked()) return;
		void this.refreshCookiesQuietly();
	};

	private readonly onMessage = (event: MessageEvent<ChannelMessage>) => {
		const message = event.data;
		if (!message || typeof message !== 'object') return;
		if (message.type === 'activity') this.lastActivity = Math.max(this.lastActivity, message.at);
		else if (message.type === 'signal') this.lastSignal = Math.max(this.lastSignal, message.at);
		else if (message.type === 'locked') this.showLock();
		else if (message.type === 'unlocked') this.hideLock();
	};

	start(): void {
		if (typeof window === 'undefined' || this.listening) return;
		this.listening = true;
		for (const event of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const) {
			window.addEventListener(event, this.onActivity, { passive: true });
		}
		document.addEventListener('visibilitychange', this.onVisibility);
		if (typeof BroadcastChannel !== 'undefined') {
			this.channel = new BroadcastChannel(CHANNEL_NAME);
			this.channel.addEventListener('message', this.onMessage);
		}
		this.timer = setInterval(() => this.tick(), 15_000);

		if (this.auth.sessionLocked()) {
			// The server holds the lock: a reload, a new tab or a laptop waking up comes back to it.
			this.showLock();
		} else {
			// Opening the admin is presence.
			this.lastActivity = Date.now();
			this.signalPresence(this.lastActivity);
		}
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		for (const event of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const) {
			window.removeEventListener(event, this.onActivity);
		}
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.channel?.removeEventListener('message', this.onMessage);
		this.channel?.close();
		this.channel = null;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.listening = false;
		// Signed out: nothing is locked any more, and anything waiting goes on (and meets the 401).
		this.hideLock();
	}

	/** Puts the lock up here, in every tab, and on the server. Refresh keeps cookies usable for resume. */
	lock(): void {
		if (!this.auth.isAuthenticated()) return;
		this.showLock();
		this.post({ type: 'locked' });
		void this.tellServer();
		void this.refreshCookiesQuietly();
	}

	/** The server refused a call with `session_locked`: show the lock in every tab. */
	lockFromServer(): void {
		if (this.locked()) return;
		this.showLock();
		this.post({ type: 'locked' });
	}

	/** After the PIN or password: every tab unlocks, and anything that waited is sent again. */
	unlock(): void {
		const now = Date.now();
		this.lastActivity = now;
		// The resume itself counted as activity on the server.
		this.lastSignal = now;
		this.post({ type: 'unlocked' });
		this.hideLock();
	}

	/** Resolves when the lock comes down (or the operator is signed out). */
	whenUnlocked(): Promise<void> {
		if (!this.locked()) return Promise.resolve();
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	private showLock(): void {
		this.locked.set(true);
	}

	private hideLock(): void {
		this.serverHasLock = true;
		this.locked.set(false);
		const waiting = this.waiters;
		this.waiters = [];
		for (const resolve of waiting) resolve();
	}

	private tick(): void {
		if (!this.auth.isAuthenticated()) {
			if (this.locked()) this.hideLock();
			return;
		}
		if (this.locked()) {
			// A lock call lost on the way (offline, a dropped request): ask again until it lands, so a
			// reload can't skip the lock. The server would also lock by itself two minutes later.
			if (!this.serverHasLock) void this.tellServer();
			return;
		}
		if (Date.now() - this.lastActivity >= ADMIN_SOFT_LOCK_MS) {
			this.lock();
		}
	}

	/** One lock call at a time; a failed one leaves `serverHasLock` false for the timer to retry. */
	private tellServer(): Promise<void> {
		if (this.lockCall) return this.lockCall;
		this.lockCall = (async () => {
			try {
				await firstValueFrom(this.gateway.lockSession());
				this.serverHasLock = true;
			} catch {
				this.serverHasLock = false;
			} finally {
				this.lockCall = null;
			}
		})();
		return this.lockCall;
	}

	/** One signal a minute across all tabs, while someone is actually there. */
	private signalPresence(now: number): void {
		if (!this.auth.isAuthenticated() || this.locked()) return;
		if (now - this.lastSignal < ACTIVITY_SIGNAL_GAP_MS) return;
		this.lastSignal = now;
		this.post({ type: 'signal', at: now });
		void this.call(() => this.gateway.markActivity());
	}

	private post(message: ChannelMessage): void {
		try {
			this.channel?.postMessage(message);
		} catch {
			// A closed channel (tab closing) has nobody to tell.
		}
	}

	private async call(request: () => Observable<void>): Promise<void> {
		try {
			await firstValueFrom(request());
		} catch {
			// The lock screen explains itself; a refused or failed signal changes nothing here.
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
