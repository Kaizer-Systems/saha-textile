import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';

import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

/** The tags the console keeps for this repository (resource key → environment name), shared by every list. */
export function injectEnvTags() {
	const api = inject(ConsoleApi);
	const ctx = inject(ConsoleContext);
	return injectQuery(() => ({
		queryKey: ['env-tags', ctx.projectId(), ctx.repoId()],
		queryFn: () => api.envTags(ctx.projectId() ?? '', ctx.repoId() ?? ''),
		enabled: !!ctx.projectId() && !!ctx.repoId(),
		staleTime: 30_000,
	}));
}

/** The repository's default branch (environments without a branch of their own deploy from it). */
export function injectDefaultBranch() {
	const api = inject(ConsoleApi);
	const ctx = inject(ConsoleContext);
	return injectQuery(() => ({
		queryKey: ['default-branch', ctx.repo()?.sourceCode.repository ?? ''],
		queryFn: () => api.repositoryBranches(ctx.repo()?.sourceCode.repository ?? ''),
		enabled: !!ctx.repo()?.sourceCode.repository,
		staleTime: 60 * 60 * 1000,
	}));
}

/**
 * Which environment a cloud resource is for (owner, 23 Nov): the pop-up after a server is created, and
 * the same box from the Droplets list later. The choices are the repository's own environments, so an
 * environment added to the repository shows here by itself. Cancel leaves the resource untagged.
 */
@Component({
	selector: 'rc-env-tag-dialog',
	imports: [PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="rc-modal-back"
			(keydown.escape)="closed.emit()"
		>
			<form
				class="rc-modal"
				role="dialog"
				[attr.aria-label]="'Which environment is ' + name() + ' for?'"
				(submit)="$event.preventDefault(); save()"
			>
				<h3 class="rc-h">Which environment is {{ name() }} for?</h3>
				<p class="rc-p">
					The console keeps this tag and shows it beside the server on every page without the environment
					switch. It goes when the server is destroyed. Cancel leaves it untagged; tag it later from
					DigitalOcean › Droplets.
				</p>
				<div class="rc-form">
					<label>
						Environment
						<select
							class="rc-select"
							aria-label="Environment"
							[disabled]="busy()"
							(change)="picked.set($any($event.target).value)"
						>
							<option
								value=""
								[selected]="env() === ''"
							>
								No environment
							</option>
							@for (e of environments(); track e.name) {
								<option
									[value]="e.name"
									[selected]="env() === e.name"
								>
									{{ e.label || e.name }}
								</option>
							}
						</select>
					</label>
					<label>
						PIN
						<rc-pin-boxes
							label="Console PIN to tag the environment"
							[autofocus]="false"
							[disabled]="busy()"
							(changed)="pin.set($event)"
						/>
					</label>
				</div>
				@if (message(); as m) {
					<div class="rc-banner red small">
						<span class="rc-dot red"></span>
						<div>{{ m }}</div>
					</div>
				}
				<div class="rc-row end">
					<button
						type="button"
						class="rc-btn ghost"
						(click)="closed.emit()"
					>
						Cancel
					</button>
					<button
						type="submit"
						class="rc-btn primary"
						[disabled]="pin().length !== pinLength || busy()"
					>
						{{ busy() ? 'Saving…' : 'Save' }}
					</button>
				</div>
			</form>
		</div>
	`,
})
export class EnvTagDialog {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly queries = inject(QueryClient);
	protected readonly pinLength = PIN_LENGTH;
	/** The resource key, like `do:droplet:123`. */
	readonly resource = input.required<string>();
	readonly name = input.required<string>();
	/** The environment chosen when the box opens (the create's own environment, or the current tag). */
	readonly preset = input<string>('');
	readonly closed = output<void>();
	readonly saved = output<string | null>();

	protected readonly environments = computed(() => this.ctx.repo()?.environments ?? []);
	protected readonly picked = signal<string | null>(null);
	protected readonly env = computed(() => this.picked() ?? this.preset());
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly message = signal('');

	protected async save(): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			const env = this.env() || null;
			await this.api.setEnvTag(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', {
				pin: this.pin(),
				key: this.resource(),
				env,
			});
			await this.queries.invalidateQueries({ queryKey: ['env-tags'] });
			await this.queries.invalidateQueries({ queryKey: ['product'] });
			this.saved.emit(env);
			this.closed.emit();
		} catch (err) {
			this.message.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}
}
