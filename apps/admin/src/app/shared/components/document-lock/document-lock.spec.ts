import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentLocksGateway } from '@core/accounts/document-locks.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { DocumentLockBanner, LOCK_HEARTBEAT_MS, LOCK_POLL_MS } from './document-lock';

import type { DocumentLock } from '@saha-textile/contracts';

const lock = (holderId: string, patch: Partial<DocumentLock> = {}): DocumentLock => ({
	documentType: 'creditNote',
	documentId: 'cn_1',
	holderId,
	holderName: holderId === 'adm_me' ? 'Owner' : 'Meera Sharma',
	since: '2026-11-25T05:12:00.000Z',
	lastActiveAt: new Date(Date.now() - 20_000).toISOString(),
	releaseAskedBy: null,
	releaseAskedAt: null,
	...patch,
});

interface Script {
	claim: DocumentLock[];
	current: { lock: DocumentLock | null; role: string | null }[];
	held?: boolean;
	fail?: boolean;
	user?: { id: string } | null;
	active?: boolean;
}

function setup(script: Script) {
	const next = <T>(list: T[]) => (list.length > 1 ? list.shift()! : list[0]!);
	const gateway = {
		claim: vi.fn(() => of(next(script.claim))),
		current: vi.fn(() => of(next(script.current))),
		heartbeat: vi.fn(() => of({ held: script.held ?? true })),
		askRelease: vi.fn(() => (script.fail ? throwError(() => new Error('down')) : of({ asked: true }))),
		takeOver: vi.fn(() => of(lock('adm_me'))),
		release: vi.fn(() => of(undefined)),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [DocumentLockBanner, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			{ provide: DocumentLocksGateway, useValue: gateway },
			{
				provide: AuthStore,
				useValue: { user: signal(script.user === undefined ? { id: 'adm_me' } : script.user) },
			},
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(DocumentLockBanner);
	const emitted: boolean[] = [];
	fixture.componentInstance.editable.subscribe((value) => emitted.push(value));
	fixture.componentRef.setInput('documentType', 'creditNote');
	fixture.componentRef.setInput('documentId', 'cn_1');
	fixture.componentRef.setInput('active', script.active ?? true);
	fixture.detectChanges();
	return { fixture, banner: fixture.componentInstance, gateway, notifier, emitted };
}

describe('one person edits a draft at a time (B7, D10)', () => {
	afterEach(() => vi.useRealTimers());

	it('takes a free draft, keeps it while present, hears a release asked of them, and lets it go on leaving', async () => {
		vi.useFakeTimers();
		const { fixture, banner, gateway, emitted } = setup({
			claim: [lock('adm_me')],
			current: [{ lock: lock('adm_me', { releaseAskedBy: 'Meera Sharma' }), role: null }],
		});
		await vi.advanceTimersByTimeAsync(0);
		expect([banner.mine(), emitted.at(-1)]).toEqual([true, true]);
		banner.touched();
		await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
		expect(gateway.heartbeat).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
		expect(gateway.heartbeat).toHaveBeenCalledTimes(1);
		expect(banner.askedBy()).toBe('Meera Sharma');
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('#lock_asked_you')).not.toBeNull();
		fixture.destroy();
		expect(gateway.release).toHaveBeenCalledTimes(1);
	});

	it('stops beating while the holder is away, and takes it back when the server dropped it', async () => {
		vi.useFakeTimers();
		const away = setup({ claim: [lock('adm_me')], current: [{ lock: null, role: null }] });
		await vi.advanceTimersByTimeAsync(3 * 60_000);
		const beats = away.gateway.heartbeat.mock.calls.length;
		await vi.advanceTimersByTimeAsync(3 * 60_000);
		expect(away.gateway.heartbeat).toHaveBeenCalledTimes(beats);
		const dropped = setup({ claim: [lock('adm_me')], current: [{ lock: null, role: null }], held: false });
		dropped.banner.touched();
		await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS + LOCK_POLL_MS);
		expect(dropped.gateway.claim).toHaveBeenCalledTimes(2);
	});

	it('shows who holds it and their role, keeps trying, asks them to release it, or takes it over', async () => {
		vi.useFakeTimers();
		const { fixture, banner, gateway, notifier, emitted } = setup({
			claim: [lock('adm_other')],
			current: [{ lock: lock('adm_other'), role: 'Store manager' }],
		});
		await vi.advanceTimersByTimeAsync(0);
		expect([banner.mine(), banner.holder()?.holderName, banner.holderRole(), emitted.at(-1)]).toEqual([
			false,
			'Meera Sharma',
			'Store manager',
			false,
		]);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('#lock_banner')).not.toBeNull();
		await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
		expect(gateway.claim).toHaveBeenCalledTimes(2);
		await banner.ask();
		expect(notifier.showSuccess).toHaveBeenCalledWith(expect.stringContaining('lock_asked'));
		await banner.takeOver();
		expect([banner.mine(), banner.holder(), emitted.at(-1)]).toEqual([true, null, true]);
		fixture.destroy();
		expect(gateway.release).toHaveBeenCalledTimes(1);
	});

	it('lets the holder release it, then only watches; leaves an issued document alone', async () => {
		vi.useFakeTimers();
		const { banner, gateway } = setup({ claim: [lock('adm_me')], current: [{ lock: null, role: null }] });
		await vi.advanceTimersByTimeAsync(0);
		await banner.release();
		expect([banner.mine(), banner.askedBy()]).toEqual([false, null]);
		await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
		expect(gateway.claim).toHaveBeenCalledTimes(1);
		expect(gateway.current).toHaveBeenCalledTimes(1);
		const issued = setup({ claim: [lock('adm_me')], current: [{ lock: null, role: null }], active: false });
		await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
		expect([issued.gateway.claim.mock.calls.length, issued.emitted]).toEqual([0, [false]]);
		issued.fixture.destroy();
		expect(issued.gateway.release).not.toHaveBeenCalled();
	});

	it('says when asking failed, treats a signed-out page as not the holder, and words how long ago', async () => {
		vi.useFakeTimers();
		const failed = setup({ claim: [lock('adm_other')], current: [{ lock: null, role: null }], fail: true });
		await failed.banner.ask();
		expect(failed.notifier.showError).toHaveBeenCalled();
		const anon = setup({ claim: [lock('adm_me')], current: [{ lock: null, role: null }], user: null });
		await vi.advanceTimersByTimeAsync(0);
		expect(anon.banner.mine()).toBe(false);
		await anon.banner.ask();
		expect(anon.notifier.showSuccess).toHaveBeenCalled();
		const now = Date.now();
		expect(anon.banner.since(lock('x', { lastActiveAt: new Date(now - 20_000).toISOString() }))).toMatchObject({
			n: 20,
			unit: 'seconds',
		});
		expect(anon.banner.since(lock('x', { lastActiveAt: new Date(now - 150_000).toISOString() }))).toMatchObject({
			n: 3,
			unit: 'minutes',
		});
		expect(anon.banner.since(lock('x', { lastActiveAt: new Date(now + 5_000).toISOString() })).n).toBe(0);
	});
});
