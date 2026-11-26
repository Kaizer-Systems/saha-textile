import { Injectable, signal } from '@angular/core';

const KEY = 'release-console-session';
const PLACE = 'release-console-place';

function readStored(): string | null {
	try {
		return sessionStorage.getItem(KEY);
	} catch {
		return null;
	}
}

/**
 * The unlocked session's token. It lives in this tab's session storage only, so closing the tab
 * locks the console; the local API also ends it after 30 idle minutes or a restart.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSession {
	readonly token = signal<string | null>(readStored());

	set(token: string): void {
		this.token.set(token);
		try {
			sessionStorage.setItem(KEY, token);
		} catch {
			/* storage blocked: the session lasts until the page reloads */
		}
	}

	clear(): void {
		this.token.set(null);
		try {
			sessionStorage.removeItem(KEY);
		} catch {
			/* nothing stored */
		}
	}

	/** Where the tab was when the console locked (a restart, idle time or Lock), to open again after unlocking. */
	keep(place: string): void {
		try {
			sessionStorage.setItem(PLACE, place);
		} catch {
			/* storage blocked: unlocking opens the start page */
		}
	}

	/** The kept place, once, or the start page; the lock screen itself is never a place to return to. */
	take(): string {
		let place: string | null = null;
		try {
			place = sessionStorage.getItem(PLACE);
			sessionStorage.removeItem(PLACE);
		} catch {
			/* storage blocked: the start page */
		}
		return place?.startsWith('/') && !place.startsWith('/lock') ? place : '/';
	}
}
