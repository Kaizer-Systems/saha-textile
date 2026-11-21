import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { QueryClient } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who may sign in over SSH to the project's servers through Cloudflare Access (owner, 21 Nov: a
 * list, more people added when needed). Changing it rewrites every server's Access rule, after the PIN.
 */
@Component({
	selector: 'rc-ssh-list',
	imports: [PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">Who may sign in over SSH · {{ saved().length }}</span>
				<button
					type="button"
					class="rc-btn ghost"
					(click)="open()"
				>
					<span
						class="lock"
						aria-hidden="true"
					></span>
					Change
				</button>
			</div>
			<div class="rc-row">
				@for (e of saved(); track e) {
					<span class="rc-pill cy">{{ e }}</span>
				} @empty {
					<span class="rc-note">Nobody yet: the first server's Create asks for at least one email.</span>
				}
			</div>
			<p class="rc-note">
				Each server's SSH goes through its Cloudflare tunnel; Access lets in the deploy job's own token and
				these people, with a one-time code sent to their email.
			</p>
		</div>
		@if (editing()) {
			<div
				class="rc-modal-back"
				(keydown.escape)="editing.set(false)"
			>
				<form
					class="rc-modal"
					role="dialog"
					aria-label="Who may sign in over SSH"
					(submit)="$event.preventDefault(); save()"
				>
					<h3 class="rc-h">Who may sign in over SSH</h3>
					<div class="rc-form">
						<label>
							People
							<span class="rc-msearch multi">
								@for (e of draft(); track e) {
									<span class="rc-pill cy">
										{{ e }}
										<button
											type="button"
											class="rc-flag"
											[attr.aria-label]="'Remove ' + e"
											(click)="remove(e)"
										>
											✕
										</button>
									</span>
								}
								<input
									type="email"
									placeholder="an email, Enter"
									aria-label="Add a person who may sign in over SSH"
									(keydown.enter)="$event.preventDefault(); add($any($event.target))"
									(blur)="add($any($event.target))"
								/>
							</span>
						</label>
						<label>
							PIN
							<rc-pin-boxes
								label="Console PIN to change the SSH list"
								[autofocus]="false"
								[disabled]="busy()"
								(changed)="pin.set($event)"
							/>
						</label>
					</div>
					@if (message(); as m) {
						<div class="rc-banner small">
							<span class="rc-dot cy"></span>
							<div>{{ m }}</div>
						</div>
					}
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="editing.set(false)"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rc-btn primary"
							[disabled]="!draft().length || pin().length !== pinLength || busy()"
						>
							{{ busy() ? 'Saving…' : 'Save' }}
						</button>
					</div>
				</form>
			</div>
		}
	`,
})
export class SshList {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly queries = inject(QueryClient);
	protected readonly pinLength = PIN_LENGTH;
	protected readonly saved = computed(() => this.ctx.project()?.sshEmails ?? []);
	protected readonly editing = signal(false);
	protected readonly draft = signal<string[]>([]);
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly message = signal('');

	protected open(): void {
		this.draft.set([...this.saved()]);
		this.message.set('');
		this.editing.set(true);
	}
	protected add(input: HTMLInputElement): void {
		const e = input.value.trim().toLowerCase();
		if (!EMAIL.test(e)) return;
		input.value = '';
		if (!this.draft().includes(e)) this.draft.set([...this.draft(), e]);
	}
	protected remove(e: string): void {
		this.draft.set(this.draft().filter((x) => x !== e));
	}
	protected async save(): Promise<void> {
		this.busy.set(true);
		try {
			const r = await this.api.setSshEmails(this.ctx.projectId() ?? '', {
				pin: this.pin(),
				emails: this.draft(),
			});
			await this.queries.invalidateQueries({ queryKey: ['projects'] });
			this.message.set(
				r.hosts.length ? `Saved; Access updated on ${r.hosts.join(', ')}.` : 'Saved; no server has SSH yet.',
			);
			this.editing.set(false);
		} catch (err) {
			this.message.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}
}
