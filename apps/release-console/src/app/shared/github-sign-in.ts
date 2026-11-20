import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	type ElementRef,
	computed,
	inject,
	output,
	signal,
	viewChild,
} from '@angular/core';

import { BrandLogo, Icon } from './icons';
import { ConsoleApi } from '../data/console-api';

import type { Job } from '@saha-textile/release-console-contracts';

/** GitHub's device sign-in page, where the one-time code is entered. */
export const DEVICE_PAGE = 'https://github.com/login/device';

/** The one-time code gh printed, from its lines (`… code (ABCD-1234) …` or `… code: ABCD-1234`). */
export function oneTimeCode(lines: { text: string }[]): string | null {
	for (const l of [...lines].reverse()) {
		const m = /code[^A-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(l.text);
		if (m?.[1]) return m[1].toUpperCase();
	}
	return null;
}

/**
 * The GitHub connection terminal (owner, 20 Nov): a popup that runs the GitHub CLI's browser sign-in
 * by itself on the machine the console runs on (this Mac, or the server it is deployed to) and shows
 * its output. gh copies the one-time code and opens
 * github.com/login/device; the code and that page are also here. When gh is signed in (at once, if
 * it already was) the popup says so, tells the page behind it (`signedIn`), and asks "Close the
 * terminal? [Y/n]": Y or Enter closes it, N keeps it open to read. It runs only the Mac helper's
 * fixed sign-in script, never a typed command.
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
						gh auth login --hostname github.com --web
					</div>
					@for (l of lines(); track l.seq) {
						<div [class.w]="l.stream === 'err' && !l.text.startsWith('!')">{{ l.text }}</div>
					}
					@if (starting()) {
						<div class="d">Asking the Mac helper…</div>
					}
					@if (job()?.status === 'running') {
						<div class="d">
							Waiting for you on github.com…
							<span class="cur"></span>
						</div>
					}
					@if (job()?.status === 'passed') {
						<div class="i">Signed in. This repository reads GitHub through this sign-in.</div>
						@if (asking()) {
							<div>
								Close the terminal? [Y/n]
								<span class="cur"></span>
							</div>
						} @else {
							<div class="d">Kept open. Close it with Close or Esc.</div>
						}
					}
					@if (job()?.status === 'failed' || job()?.status === 'stopped') {
						<div class="w">The sign-in did not finish.</div>
					}
				</div>
				@if (code(); as c) {
					@if (job()?.status === 'running') {
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
				@if (message()) {
					<p class="rc-note red">{{ message() }}</p>
				}
				<div class="rc-row end">
					@if (job()?.status === 'passed' && asking()) {
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
					@if (job()?.status === 'failed' || job()?.status === 'stopped' || message()) {
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
	/** The CLI is signed in; the page behind refreshes its repositories. */
	readonly signedIn = output<void>();
	/** The popup closed: `true` when GitHub is connected, `false` when it was closed before that. */
	readonly closed = output<boolean>();
	protected readonly devicePage = DEVICE_PAGE;
	protected readonly job = signal<Job | null>(null);
	protected readonly lines = signal<Job['lines']>([]);
	protected readonly starting = signal(false);
	protected readonly asking = signal(true);
	protected readonly copied = signal(false);
	protected readonly message = signal('');
	protected readonly code = computed(() => oneTimeCode(this.lines()));
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		// Leaving the page also ends a sign-in still waiting on github.com.
		inject(DestroyRef).onDestroy(() => {
			this.halt();
			const job = this.job();
			if (job?.status === 'running') void this.api.stopGithubLogin(job.id).catch(() => undefined);
		});
		void this.start();
	}

	protected async start(): Promise<void> {
		this.halt();
		this.message.set('');
		this.lines.set([]);
		this.job.set(null);
		this.asking.set(true);
		this.starting.set(true);
		try {
			const job = await this.api.githubLogin();
			this.job.set(job);
			this.follow(job.id);
		} catch (err) {
			this.message.set((err as Error).message);
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

	protected keep(): void {
		this.asking.set(false);
	}

	/** Closes the popup; going away stops a sign-in still waiting on github.com (see the constructor). */
	protected close(): void {
		this.closed.emit(this.job()?.status === 'passed');
	}

	/** Y or Enter closes once signed in, N keeps it open; Esc always closes. */
	protected key(e: KeyboardEvent): void {
		if (e.key === 'Escape') return this.close();
		if (this.job()?.status !== 'passed' || !this.asking()) return;
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
