import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubSignIn, connectResult, pendingAsk } from './github-sign-in';
import { ConsoleApi } from '../data/console-api';

import type { Job } from '@saha-textile/release-console-contracts';

/** The panel's members these tests use (protected on the component). */
interface Panel {
	job: { set(job: Job | null): void; (): Job | null };
	lines: () => unknown[];
	message: () => string;
	busy: () => boolean;
	asking: () => boolean;
	pasting: () => boolean;
	copied: () => boolean;
	passed: () => boolean;
	outcome: () => string;
	ask: () => unknown;
	start(): Promise<void>;
	answer(yes: boolean): Promise<void>;
	pasteInstead(): void;
	useToken(e: Event, box: HTMLInputElement): Promise<void>;
	keep(): void;
	close(): void;
	key(e: KeyboardEvent): void;
	copy(text: string): void;
}

const line = (seq: number, event: Record<string, unknown> | null = null, text = '') => ({
	seq,
	stream: 'out' as const,
	text,
	event,
});
const job = (status: string, lines: unknown[] = [], id = 'gh-1'): Job =>
	({ id, kind: 'github', label: 'Connect GitHub', status, startedAt: '', lines }) as unknown as Job;

function make(api: Record<string, unknown>) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: ConsoleApi, useValue: api }] });
	TestBed.overrideComponent(GithubSignIn, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(GithubSignIn);
	fixture.componentRef.setInput('repository', 'own/shop');
	const signedIn = vi.fn();
	const closed = vi.fn();
	fixture.componentInstance.signedIn.subscribe(signedIn);
	fixture.componentInstance.closed.subscribe(closed);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Panel, fixture, signedIn, closed };
}
const key = (k: string, target: object | null = null) =>
	({ key: k, target, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('GitHub Connect: reading its lines', () => {
	it('reads a question without words, and a result without an account', () => {
		expect(pendingAsk([line(1, { ask: 'q1' })])).toEqual({ id: 'q1', question: '' });
		expect(connectResult([line(1, { result: 'connected' })])).toEqual({ result: 'connected', account: '' });
	});
});

describe('GitHub Connect: the panel', () => {
	it('follows a Connect already running elsewhere, its lines, and says when it passed', async () => {
		const jobs = [
			job('running', [line(1, null, 'one')]),
			job('passed', [line(2, { result: 'connected', account: 'owner' })]),
		];
		const api = {
			githubLogin: vi.fn(async () => Promise.reject(new Error('A GitHub Connect is already running'))),
			jobs: vi.fn(async () => [job('passed', [], 'old'), job('running', [], 'gh-2')]),
			job: vi.fn(async () => jobs.shift() ?? job('passed')),
			stopGithubLogin: vi.fn(async () => undefined),
		};
		const { c, signedIn, fixture } = make(api);
		// The terminal box scrolls to its newest line.
		const term = document.createElement('div');
		Object.defineProperty(c, 'term', { value: () => ({ nativeElement: term }) });
		await flush();
		await vi.waitFor(() => expect(signedIn).toHaveBeenCalled(), { timeout: 3000 });
		expect(api.job).toHaveBeenCalledWith('gh-2', 0);
		expect(c.lines()).toHaveLength(2);
		expect(c.outcome()).toBe('Connected as owner. The page has turned green.');
		fixture.destroy();
		expect(api.stopGithubLogin).not.toHaveBeenCalled();
	});

	it('says why it could not start, and that the job list failed too', async () => {
		const api = {
			githubLogin: vi.fn(async () => Promise.reject(new Error('A GitHub Connect is already running'))),
			jobs: vi.fn(async () => Promise.reject(new Error('down'))),
		};
		const { c } = make(api);
		await flush();
		await vi.waitFor(() => expect(c.message()).toContain('already running'));
		api.githubLogin.mockRejectedValueOnce(new Error('gh is not installed'));
		await c.start();
		expect(c.message()).toBe('gh is not installed');
	});

	it('keeps the message when reading the job fails, and stops a running sign-in when the page goes away', async () => {
		const api = {
			githubLogin: vi.fn(async () => job('running')),
			job: vi.fn(async () => Promise.reject(new Error('helper gone'))),
			stopGithubLogin: vi.fn(async () => Promise.reject(new Error('already over'))),
			answerGithubLogin: vi.fn(async () => Promise.reject(new Error('not asking'))),
		};
		const { c, fixture } = make(api);
		await flush();
		await vi.waitFor(() => expect(c.message()).toBe('helper gone'));
		await c.answer(true);
		expect(c.message()).toBe('not asking');
		c.job.set(null);
		await c.answer(false);
		c.job.set(job('running'));
		fixture.destroy();
		expect(api.stopGithubLogin).toHaveBeenCalledWith('gh-1');
	});

	it('takes a pasted token instead, says when it is refused, and keeps the account it signed in as', async () => {
		const api = {
			githubLogin: vi.fn(async () => job('running')),
			job: vi.fn(async () => job('running')),
			stopGithubLogin: vi.fn(async () => undefined),
			githubLoginToken: vi.fn(async () => ({ ok: false, message: 'Bad token' })),
		};
		const { c, signedIn } = make(api);
		await flush();
		c.pasteInstead();
		expect(c.pasting()).toBe(true);
		const box = Object.assign(document.createElement('input'), { value: '   ' });
		const submit = { preventDefault: vi.fn() } as unknown as Event;
		await c.useToken(submit, box);
		expect(api.githubLoginToken).not.toHaveBeenCalled();
		box.value = 'ghp_x';
		await c.useToken(submit, box);
		expect(c.message()).toBe('Bad token');
		api.githubLoginToken.mockResolvedValueOnce({ ok: true, account: undefined } as never);
		box.value = 'ghp_y';
		await c.useToken(submit, box);
		expect(signedIn).toHaveBeenCalled();
		expect(c.outcome()).toBe('Signed in as your account. The page now checks the repository.');
		expect(c.passed()).toBe(true);
		api.githubLoginToken.mockRejectedValueOnce(new Error('offline'));
		box.value = 'ghp_z';
		await c.useToken(submit, box);
		expect(c.message()).toBe('offline');
		expect(c.busy()).toBe(false);
	});

	it('answers the update question with y, n or Enter, leaves the token box alone, and closes or stays once connected', async () => {
		const asking = job('running', [line(1, { ask: 'update-gh', question: 'Update?' })]);
		const api = {
			githubLogin: vi.fn(async () => asking),
			job: vi.fn(async () => asking),
			answerGithubLogin: vi.fn(async () => undefined),
			stopGithubLogin: vi.fn(async () => undefined),
		};
		const { c, closed } = make(api);
		await flush();
		await vi.waitFor(() => expect(c.ask()).toBeTruthy());
		c.key(key('y', { tagName: 'INPUT' }));
		expect(api.answerGithubLogin).not.toHaveBeenCalled();
		c.key(key('Y'));
		c.key(key('Enter'));
		c.key(key('x'));
		expect(api.answerGithubLogin.mock.calls.map((call) => (call as unknown[])[1])).toEqual(['yes', 'no']);
		c.job.set(job('running'));
		c.key(key('y'));
		c.job.set(job('passed'));
		c.key(key('n'));
		expect(c.asking()).toBe(false);
		c.key(key('y'));
		c.keep();
		c.close();
		expect(closed).toHaveBeenCalledWith(true);
		c.key(key('Escape'));
		expect(closed).toHaveBeenCalledTimes(2);
	});

	it('closes on y or Enter once connected, and keeps open on N', async () => {
		const api = {
			githubLogin: vi.fn(async () => job('passed')),
			job: vi.fn(async () => job('passed')),
		};
		const { c, closed } = make(api);
		await flush();
		await vi.waitFor(() => expect(c.passed()).toBe(true));
		c.key(key('x'));
		expect(c.asking()).toBe(true);
		c.key(key('N'));
		expect(c.asking()).toBe(false);
		await c.start();
		await vi.waitFor(() => expect(c.passed()).toBe(true));
		c.key(key('Enter'));
		expect(closed).toHaveBeenCalledWith(true);
	});

	it('copies the code when the clipboard is there, and says nothing when it is not', async () => {
		const api = { githubLogin: vi.fn(async () => job('passed')), job: vi.fn(async () => job('passed')) };
		const { c } = make(api);
		await flush();
		c.copy('AB12-CD34');
		expect(c.copied()).toBe(false);
		vi.useFakeTimers();
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		c.copy('AB12-CD34');
		await vi.advanceTimersByTimeAsync(0);
		expect(c.copied()).toBe(true);
		await vi.advanceTimersByTimeAsync(1500);
		expect(c.copied()).toBe(false);
		writeText.mockRejectedValueOnce(new Error('denied'));
		c.copy('AB12-CD34');
		await vi.advanceTimersByTimeAsync(0);
		expect(c.copied()).toBe(false);
	});
});
