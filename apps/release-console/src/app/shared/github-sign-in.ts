import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	type ElementRef,
	computed,
	inject,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';

import { BrandLogo, Icon } from './icons';
import { ConsoleApi } from '../data/console-api';

import type { Job } from '@saha-textile/release-console-contracts';

/** GitHub's device sign-in page, where the one-time code is entered. */
export const DEVICE_PAGE = 'https://github.com/login/device';

type Line = Job['lines'][number];

/** The one-time code gh printed, from its lines (`… code (ABCD-1234) …` or `… code: ABCD-1234`). */
export function oneTimeCode(lines: { text: string }[]): string | null {
	for (const l of [...lines].reverse()) {
		const m = /code[^A-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(l.text);
		if (m?.[1]) return m[1].toUpperCase();
	}
	return null;
}

/** The question the job is waiting on: the last `{"ask"}` line not yet followed by its `{"answered"}`. */
export function pendingAsk(lines: Line[]): { id: string; question: string } | null {
	let open: { id: string; question: string } | null = null;
	for (const l of lines) {
		const e = l.event;
		if (e && typeof e['ask'] === 'string') open = { id: e['ask'], question: String(e['question'] ?? '') };
		else if (e && typeof e['answered'] === 'string' && open?.id === e['answered']) open = null;
	}
	return open;
}

/** How the run ended, from its last `{"result"}` line: connected, or signed in without access to the repository. */
export function connectResult(lines: Line[]): { result: 'connected' | 'no-access'; account: string } | null {
	for (const l of [...lines].reverse()) {
		const e = l.event;
		if (e && (e['result'] === 'connected' || e['result'] === 'no-access'))
			return { result: e['result'], account: String(e['account'] ?? '') };
	}
	return null;
}

/** A line's colour in the terminal: step titles, done, failed, notices, skipped. */
export function lineClass(text: string): string {
	if (/^\d · /.test(text)) return 'i';
	if (text.startsWith('✓')) return 'p';
	if (text.startsWith('✗') || text.startsWith('!')) return 'w';
	if (text.startsWith('- ') || text.startsWith('  ')) return 'd';
	return '';
}

/**
 * The GitHub Connect terminal (owner, 20 Nov; brief QhMFJFyn5Gq1sosZ1AaTQG): a popup that opens on
 * every Connect ("let the terminal pop-up always be there") and runs the console's Connect steps by
 * itself on the machine the console runs on (this Mac, or the server it is deployed to), showing
 * that machine's output: tools with Git's and then gh's update check ("[y/N]", answered here), the
 * saved sign-in named or the browser sign-in or a pasted token, Git set up to use it, and the
 * repository check. Once signed in the page behind checks the repository and turns green
 * (`signedIn`), and it asks "Close the terminal? [Y/n]". It runs only the helper's fixed script,
 * never a typed command.
 */
@Component({
	selector: 'rc-github-sign-in',
	imports: [BrandLogo, Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'key($event)' },
	template: `
		<div class="rc-modal-back">
			<div
				class="rc-modal"
				role="dialog"
				aria-label="Connect to GitHub"
			>
				<div class="rc-row between">
					<h3 class="rc-h">
						<rc-brand-logo
							name="logos/github-icon"
							[size]="16"
							label="Connect to GitHub"
						/>
					</h3>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="close()"
					>
						<rc-icon name="tabler/x" />
						Close
					</button>
				</div>
				<div
					#term
					class="rc-term"
					aria-live="polite"
				>
					<div>
						<span class="p">$</span>
						release-console connect github {{ repository() }}
					</div>
					@for (l of shown(); track l.seq) {
						<div [class]="lineClass(l.text)">{{ l.text }}</div>
					}
					@if (starting()) {
						<div class="d">Asking the console's helper…</div>
					}
					@if (ask(); as q) {
						<div>
							{{ q.question }}
							<span class="cur"></span>
						</div>
					} @else if (job()?.status === 'running' && !pasting()) {
						<div class="d">
							Working…
							<span class="cur"></span>
						</div>
					}
					@if (passed()) {
						<div class="i">{{ outcome() }}</div>
						@if (asking()) {
							<div>
								Close the terminal? [Y/n]
								<span class="cur"></span>
							</div>
						} @else {
							<div class="d">Kept open. Close it with Close or Esc.</div>
						}
					}
				</div>
				@if (ask(); as q) {
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="answer(false)"
						>
							N · continue as is
						</button>
						<button
							type="button"
							class="rc-btn primary"
							(click)="answer(true)"
						>
							Y · update
						</button>
					</div>
				}
				@if (code(); as c) {
					@if (job()?.status === 'running' && !pasting()) {
						<div class="rc-row">
							<span class="rc-note">One-time code</span>
							<button
								type="button"
								class="rc-chip"
								[attr.data-tip]="copied() ? 'Copied' : 'Click to copy'"
								(click)="copy(c)"
							>
								{{ c }}
							</button>
							<a
								class="rc-btn"
								[href]="devicePage"
								target="_blank"
								rel="noopener"
							>
								<rc-icon name="tabler/external-link" />
								Open github.com/login/device
							</a>
						</div>
					}
				}
				@if (pasting() && !passed()) {
					<form
						class="rc-form"
						(submit)="useToken($event, tokenBox)"
					>
						<label>
							Token
							<div class="rc-msearch">
								<input
									#tokenBox
									type="password"
									autocomplete="off"
									spellcheck="false"
									aria-label="GitHub token"
									placeholder="github_pat_… or ghp_…"
								/>
							</div>
						</label>
						<p class="rc-note">
							It goes straight to gh on the console's machine and is kept nowhere else. It needs the repo
							and read:org scopes.
						</p>
						<div class="rc-row end">
							<button
								type="submit"
								class="rc-btn primary"
								[disabled]="busy()"
							>
								{{ busy() ? 'Signing in…' : 'Sign in with this token' }}
							</button>
						</div>
					</form>
				}
				@if (message()) {
					<p class="rc-note red">{{ message() }}</p>
				}
				<div class="rc-row end">
					@if (passed() && asking()) {
						<button
							type="button"
							class="rc-btn ghost"
							(click)="keep()"
						>
							N · keep it open
						</button>
						<button
							type="button"
							class="rc-btn primary"
							(click)="close()"
						>
							Y · close
						</button>
					}
					@if (!passed() && !pasting() && (code() || ended())) {
						<button
							type="button"
							class="rc-btn ghost"
							(click)="pasteInstead()"
						>
							Paste a token instead
						</button>
					}
					@if (!passed() && (ended() || message())) {
						<button
							type="button"
							class="rc-btn primary"
							(click)="start()"
						>
							Try again
						</button>
					}
				</div>
			</div>
		</div>
	`,
})
export class GithubSignIn {
	private readonly api = inject(ConsoleApi);
	private readonly term = viewChild<ElementRef<HTMLElement>>('term');
	readonly repository = input.required<string>();
	readonly mode = input<'login' | 'another' | 'packages'>('login');
	/** Connected: the page behind turns the row green. */
	readonly signedIn = output<void>();
	/** The popup closed: `true` when GitHub is connected, `false` when it was closed before that. */
	readonly closed = output<boolean>();
	protected readonly devicePage = DEVICE_PAGE;
	protected readonly lineClass = lineClass;
	protected readonly job = signal<Job | null>(null);
	protected readonly lines = signal<Line[]>([]);
	protected readonly starting = signal(false);
	protected readonly asking = signal(true);
	protected readonly copied = signal(false);
	protected readonly message = signal('');
	protected readonly pasting = signal(false);
	protected readonly busy = signal(false);
	/** The account a pasted token signed in as. */
	private readonly tokenAccount = signal<string | null>(null);
	protected readonly code = computed(() => oneTimeCode(this.lines()));
	protected readonly ask = computed(() => (this.job()?.status === 'running' ? pendingAsk(this.lines()) : null));
	/** The lines to print: the question and answer markers are shown as words, not as JSON. */
	protected readonly shown = computed(() => this.lines().filter((l) => !l.event));
	/** The closing words: what the page behind now shows. */
	protected readonly outcome = computed(() => {
		const token = this.tokenAccount();
		if (token) return `Signed in as ${token}. The page now checks the repository.`;
		const r = connectResult(this.lines());
		if (r?.result === 'connected') return `Connected as ${r.account}. The page has turned green.`;
		if (r?.result === 'no-access')
			return `Signed in as ${r.account}, but it cannot open ${this.repository()}. The page says what to do.`;
		return 'Signed in. The page shows the result.';
	});
	protected readonly passed = computed(() => this.job()?.status === 'passed' || this.tokenAccount() !== null);
	protected readonly ended = computed(() => {
		const s = this.job()?.status;
		return s === 'failed' || s === 'stopped';
	});
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		// Leaving the page also ends a sign-in still waiting on github.com.
		inject(DestroyRef).onDestroy(() => {
			this.halt();
			this.stopRunning();
		});
		queueMicrotask(() => void this.start());
	}

	protected async start(): Promise<void> {
		this.halt();
		this.message.set('');
		this.lines.set([]);
		this.job.set(null);
		this.asking.set(true);
		this.pasting.set(false);
		this.starting.set(true);
		try {
			const job = await this.api.githubLogin(this.repository(), this.mode());
			this.job.set(job);
			this.follow(job.id);
		} catch (err) {
			// A Connect already running (another tab, or a second press): follow that one instead.
			const running = /already running/i.test((err as Error).message)
				? (await this.api.jobs().catch(() => [])).find((j) => j.kind === 'github' && j.status === 'running')
				: undefined;
			if (running) {
				this.job.set(running);
				this.follow(running.id);
			} else this.message.set((err as Error).message);
		} finally {
			this.starting.set(false);
		}
	}

	/** Reads the job's new lines every second until it ends. */
	private follow(id: string): void {
		const tick = async () => {
			try {
				const after = this.lines().at(-1)?.seq ?? 0;
				const job = await this.api.job(id, after);
				this.job.set(job);
				if (job.lines.length) {
					this.lines.update((l) => [...l, ...job.lines]);
					queueMicrotask(() => {
						const el = this.term()?.nativeElement;
						if (el) el.scrollTop = el.scrollHeight;
					});
				}
				if (job.status === 'running') this.timer = setTimeout(tick, 1000);
				else if (job.status === 'passed') this.signedIn.emit();
			} catch (err) {
				this.message.set((err as Error).message);
			}
		};
		void tick();
	}

	private halt(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private stopRunning(): void {
		const job = this.job();
		if (job?.status === 'running') void this.api.stopGithubLogin(job.id).catch(() => undefined);
	}

	/** Yes or no to the terminal's update question. */
	protected async answer(yes: boolean): Promise<void> {
		const job = this.job();
		if (!job) return;
		try {
			await this.api.answerGithubLogin(job.id, yes ? 'yes' : 'no');
		} catch (err) {
			this.message.set((err as Error).message);
		}
	}

	/** Switches to the token form; the browser sign-in waiting in the job is stopped. */
	protected pasteInstead(): void {
		this.halt();
		this.stopRunning();
		this.message.set('');
		this.pasting.set(true);
	}

	protected async useToken(e: Event, box: HTMLInputElement): Promise<void> {
		e.preventDefault();
		const token = box.value.trim();
		box.value = '';
		if (!token) return;
		this.busy.set(true);
		this.message.set('');
		try {
			const r = await this.api.githubLoginToken(token);
			if (r.ok) {
				this.tokenAccount.set(r.account ?? 'your account');
				this.signedIn.emit();
			} else this.message.set(r.message);
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}

	protected keep(): void {
		this.asking.set(false);
	}

	/** Closes the popup; going away stops a sign-in still waiting on github.com (see the constructor). */
	protected close(): void {
		this.closed.emit(this.passed());
	}

	/**
	 * Keys: Esc closes. An update question takes y (update) or n / Enter (continue as is). Once
	 * connected, y or Enter closes and n keeps it open. Typing in the token box is left alone.
	 */
	protected key(e: KeyboardEvent): void {
		if (e.key === 'Escape') return this.close();
		if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
		if (this.ask()) {
			if (e.key === 'y' || e.key === 'Y') void this.answer(true);
			else if (e.key === 'n' || e.key === 'N' || e.key === 'Enter') void this.answer(false);
			else return;
			e.preventDefault();
			return;
		}
		if (!this.passed() || !this.asking()) return;
		if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') {
			e.preventDefault();
			this.close();
		} else if (e.key === 'n' || e.key === 'N') {
			e.preventDefault();
			this.keep();
		}
	}

	protected copy(text: string): void {
		const done = () => {
			this.copied.set(true);
			setTimeout(() => this.copied.set(false), 1500);
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => undefined);
	}
}
