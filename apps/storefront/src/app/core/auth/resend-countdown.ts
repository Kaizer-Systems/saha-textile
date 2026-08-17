import { DestroyRef, inject, signal } from '@angular/core';

/**
 * Progressive backoff between one-time-code sends, MIRRORED from
 * `packages/core-domain/src/auth/signup-policy.ts`.
 *
 * Duplicated rather than imported, and that is a boundary consequence rather than laziness:
 * core-domain is type-only towards contracts (`G-CORE-CONTRACTS`), so a runtime constant cannot
 * be published through contracts for both sides to share, and the storefront does not depend on
 * core-domain at all. The server remains the authority — it refuses an early resend whatever
 * this says. These numbers only decide when the button stops looking clickable.
 *
 * Where the server can safely tell us the exact moment it will accept the next send, it does,
 * and `startFrom` takes that instead. It cannot on the LOGIN code path: that endpoint answers
 * identically for registered and unregistered identifiers on purpose, and a countdown computed
 * from real challenge state would exist only for accounts that exist — turning the timer into
 * the account-enumeration oracle the generic response was built to remove.
 */
const BACKOFF_SECONDS = [0, 30, 120, 600, 3600] as const;

export function resendDelaySeconds(sendsAlreadyMade: number): number {
	if (sendsAlreadyMade <= 0) return 0;
	return BACKOFF_SECONDS[Math.min(sendsAlreadyMade, BACKOFF_SECONDS.length - 1)] as number;
}

/**
 * A ticking "seconds until a resend is allowed", for disabling the button and showing the wait.
 *
 * Reads zero when a resend is available, which is also the signal to take the counter out of the
 * DOM entirely rather than leave a `0` sitting there.
 */
export class ResendCountdown {
	private readonly remaining = signal(0);
	private timer: ReturnType<typeof setInterval> | null = null;
	/** How many sends this view has made, which is what selects the next delay. */
	private sends = 0;

	readonly secondsRemaining = this.remaining.asReadonly();

	constructor() {
		// Nothing else stops the interval when the screen goes away.
		inject(DestroyRef).onDestroy(() => this.stop());
	}

	/** True while the button must stay disabled. */
	get waiting(): boolean {
		return this.remaining() > 0;
	}

	/**
	 * Starts the wait after a send.
	 *
	 * @param availableAt the server's own answer, when it gave one; otherwise the schedule above
	 *   is applied to the number of sends made in this view.
	 */
	start(availableAt?: string | null): void {
		this.sends += 1;
		const seconds = availableAt
			? Math.max(0, Math.ceil((new Date(availableAt).getTime() - Date.now()) / 1000))
			: resendDelaySeconds(this.sends);
		this.run(seconds);
	}

	/** Clears the wait — used when the thing it was counting for is abandoned. */
	reset(): void {
		this.stop();
		this.sends = 0;
		this.remaining.set(0);
	}

	private run(seconds: number): void {
		this.stop();
		this.remaining.set(seconds);
		if (seconds <= 0) return;

		this.timer = setInterval(() => {
			const next = this.remaining() - 1;
			this.remaining.set(Math.max(0, next));
			if (next <= 0) this.stop();
		}, 1000);
	}

	private stop(): void {
		if (this.timer === null) return;
		clearInterval(this.timer);
		this.timer = null;
	}
}
