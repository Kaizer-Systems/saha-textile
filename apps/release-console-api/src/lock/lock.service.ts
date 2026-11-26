import { randomBytes } from 'node:crypto';

import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LockStatus, SignInMethod, Unlock } from '@saha-textile/release-console-contracts';

import { hashPin, pinMatches } from './pin-hash.js';
import { ConsoleStore } from '../store/console-store.js';

export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;
export const IDLE_MINUTES = 30;

/**
 * The console's PIN lock. Five wrong tries lock it for 15 minutes, and the lock survives a
 * restart because it is kept in the console file. Sessions live in memory only and end after
 * 30 idle minutes, so restarting the local API locks the console.
 */
@Injectable()
export class LockService {
	private readonly sessions = new Map<string, number>();

	constructor(private readonly store: ConsoleStore) {}

	status(session: string | undefined): LockStatus {
		const file = this.store.read();
		const lockedUntil = this.activeLock();
		return {
			pinSet: !!file.pin,
			passwordSet: !!file.password,
			preferred: file.password ? file.preferred : 'pin',
			unlocked: this.valid(session),
			lockedUntil,
			triesLeft: lockedUntil ? 0 : Math.max(0, MAX_TRIES - file.lock.failures),
		};
	}

	setup(pin: string): string {
		if (this.store.read().pin) throw new ConflictException('A PIN is set already. Change it in Console settings.');
		this.store.update((f) => ({ ...f, pin: hashPin(pin), lock: { failures: 0, lockedUntil: null } }));
		this.store.audit(null, 'pin-set', 'The console PIN was set');
		return this.open();
	}

	/** The PIN or the password; wrong tries of either count toward the same lock. */
	unlock(given: Unlock | string): string {
		const file = this.store.read();
		if (!file.pin) throw new ConflictException('Set a PIN first.');
		if (this.activeLock()) throw new ForbiddenException('Locked after too many wrong tries.');
		if (this.matches(typeof given === 'string' ? { pin: given } : given)) {
			this.store.update((f) => ({ ...f, lock: { failures: 0, lockedUntil: null } }));
			this.store.audit(null, 'unlock', 'The console was unlocked');
			return this.open();
		}
		const failures = file.lock.failures + 1;
		const lockedUntil = failures >= MAX_TRIES ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
		this.store.update((f) => ({ ...f, lock: { failures: lockedUntil ? 0 : failures, lockedUntil } }));
		this.store.audit(
			null,
			lockedUntil ? 'locked-out' : 'unlock-failed',
			lockedUntil
				? `Locked for ${LOCK_MINUTES} minutes`
				: `Wrong PIN or password, try ${failures} of ${MAX_TRIES}`,
		);
		throw new UnauthorizedException(lockedUntil ? 'Locked after too many wrong tries.' : 'Wrong PIN or password.');
	}

	/** True when the PIN or the password matches its stored hash. */
	private matches(given: Unlock): boolean {
		const file = this.store.read();
		if ('pin' in given) return !!file.pin && pinMatches(given.pin, file.pin);
		return !!file.password && pinMatches(given.password, file.password);
	}

	/** Sets or changes the console password; the PIN is required. */
	setPassword(session: string | undefined, pin: string, password: string): void {
		this.confirm(session, pin, 'set the password');
		this.store.update((f) => ({ ...f, password: hashPin(password) }));
		this.store.audit(null, 'password-set', 'The console password was set');
	}

	/** Removes the console password; the PIN stays the way in. */
	removePassword(session: string | undefined, pin: string): void {
		this.confirm(session, pin, 'remove the password');
		this.store.update((f) => ({ ...f, password: null, preferred: 'pin' }));
		this.store.audit(null, 'password-removed', 'The console password was removed');
	}

	/** Which way the lock screen opens first. */
	setPreferred(session: string | undefined, pin: string, method: SignInMethod): void {
		this.confirm(session, pin, 'choose the sign-in method');
		if (method === 'password' && !this.store.read().password) throw new ConflictException('Set a password first.');
		this.store.update((f) => ({ ...f, preferred: method }));
		this.store.audit(
			null,
			'sign-in-method',
			`The lock screen opens with the ${method === 'pin' ? 'PIN' : 'password'}`,
		);
	}

	/**
	 * Confirms a change with the PIN (or the password) again: start a deploy, stop services, change
	 * the password. A wrong try counts toward the same five-try lock, and a lock-out ends every session.
	 */
	confirm(session: string | undefined, secret: string, what: string): void {
		const file = this.store.read();
		if (!this.valid(session) || !file.pin) throw new UnauthorizedException('Unlock first.');
		if (this.activeLock()) throw new ForbiddenException('Locked after too many wrong tries.');
		if (this.matches({ pin: secret }) || this.matches({ password: secret })) {
			if (file.lock.failures) this.store.update((f) => ({ ...f, lock: { failures: 0, lockedUntil: null } }));
			return;
		}
		const failures = file.lock.failures + 1;
		const lockedUntil = failures >= MAX_TRIES ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
		this.store.update((f) => ({ ...f, lock: { failures: lockedUntil ? 0 : failures, lockedUntil } }));
		if (lockedUntil) this.sessions.clear();
		this.store.audit(
			null,
			lockedUntil ? 'locked-out' : 'confirm-failed',
			lockedUntil
				? `Locked for ${LOCK_MINUTES} minutes`
				: `Wrong PIN or password for “${what}”, try ${failures} of ${MAX_TRIES}`,
		);
		// 403, not 401: a wrong confirmation must not end the session that is still open.
		throw new ForbiddenException(lockedUntil ? 'Locked after too many wrong tries.' : 'Wrong PIN or password.');
	}

	changePin(session: string | undefined, current: string, next: string): void {
		const file = this.store.read();
		if (!this.valid(session) || !file.pin) throw new UnauthorizedException('Unlock first.');
		if (!pinMatches(current, file.pin)) {
			this.store.audit(null, 'pin-change-failed', 'The current PIN was wrong');
			throw new UnauthorizedException('The current PIN is wrong.');
		}
		this.store.update((f) => ({ ...f, pin: hashPin(next) }));
		this.store.audit(null, 'pin-changed', 'The console PIN was changed');
	}

	lock(session: string | undefined): void {
		if (session) this.sessions.delete(session);
		this.store.audit(null, 'lock', 'The console was locked');
	}

	/** True when the session is known and not idle too long; using it keeps it alive. */
	valid(session: string | undefined): boolean {
		if (!session) return false;
		const last = this.sessions.get(session);
		if (last === undefined) return false;
		if (Date.now() - last > IDLE_MINUTES * 60_000) {
			this.sessions.delete(session);
			return false;
		}
		this.sessions.set(session, Date.now());
		return true;
	}

	private open(): string {
		const session = randomBytes(32).toString('hex');
		this.sessions.set(session, Date.now());
		return session;
	}

	private activeLock(): string | null {
		const until = this.store.read().lock.lockedUntil;
		return until && Date.parse(until) > Date.now() ? until : null;
	}
}
