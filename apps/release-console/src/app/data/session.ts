import { Injectable, signal } from '@angular/core';

const KEY = 'release-console-session';

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
}
