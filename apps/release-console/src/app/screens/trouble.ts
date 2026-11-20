import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Icon } from '../shared/icons';

/** The failures the console knows how to walk the owner through. */
export type Trouble =
	| 'helper'
	| 'docker'
	| 'stack-down'
	| 'mongo-login'
	| 'certificate'
	| 'port-taken'
	| 'pipeline-busy'
	| 'checks-refused'
	| 'run-failed'
	| 'infisical'
	| 'disk'
	| 'key'
	| 'errors';

/** Each failure's steps, in order; text between backticks is a command, shown as code. */
export const TROUBLE_STEPS: Record<Trouble, string[]> = {
	helper: [
		'From the main folder, run `pnpm console:up`; it starts the Mac helper beside the console.',
		'If port 4419 is taken, `lsof -nP -iTCP:4419 -sTCP:LISTEN` names the program using it.',
		'The helper refuses to start from a worktree; start it from the main folder.',
	],
	docker: [
		'Open Docker Desktop and wait until it says the engine is running.',
		'`docker info` in a terminal answers once Docker is up.',
		'If Docker Desktop hangs, quit it fully and open it again; the stack’s data volumes are kept.',
	],
	'stack-down': [
		'On Ship › Live deploy, “Write stack files”, then “Start the stack”.',
		'In a terminal from the main folder, `pnpm stack:up` does the same and shows each step.',
		'`pnpm stack:status` lists what runs and what does not; Run › Live logs shows why a container stopped.',
	],
	'mongo-login': [
		'The stack’s database logins come from Infisical: `pnpm stack:env` writes them again, then `pnpm stack:up`.',
		'`pnpm stack:logs` shows the database’s own message.',
		'Never turn the database login off to get past it; the stack runs with logins like production.',
	],
	certificate: [
		'`pnpm stack:certs` from the main folder makes the local certificates again.',
		'Then `pnpm stack:up` starts the edge with them.',
	],
	'port-taken': [
		'`lsof -nP -iTCP:PORT -sTCP:LISTEN` (with the port in the message) names the program using it.',
		'Stop that program, or the other copy of the console or the stack, then try again.',
	],
	'pipeline-busy': [
		'One run at a time: Recent runs shows the one in progress.',
		'Wait for it, or stop it with your PIN, then start again.',
	],
	'checks-refused': [
		'The checks stage rebuilds the apps under the running `pnpm dev` servers, so it refuses to start.',
		'Stop those servers, or start from the proof stage instead.',
	],
	'run-failed': [
		'Read the output of the stage that failed (Recent runs › Output).',
		'Fix the cause, then start again from that stage with “From …” instead of running every stage.',
		'The checks stage refuses to run while `pnpm dev` servers are up; stop them or start from the proof stage.',
	],
	infisical: [
		'Run `infisical login` in a terminal; the console reads Infisical with your own login.',
		'Then `pnpm console:env` for the console’s keys, or “Read again” on Run › Secrets.',
	],
	disk: [
		'Empty the Trash; files moved there still take space.',
		'In a terminal, `docker system df` shows what Docker keeps on disk.',
		'`docker builder prune` frees build cache and `docker image prune` removes images no container uses; neither touches the stack’s data volumes.',
		'Large caches are listed by `du -sh ~/Library/Caches/* | sort -h | tail`.',
	],
	key: [
		'Create a new key at the vendor (Project settings › Connections shows how for each kind).',
		'Save it in Infisical under the same name, then run `pnpm console:env` on this Mac.',
		'On Connections, “Check” confirms the new key at once.',
	],
	errors: [
		'Open Run › Live logs › Errors only to see the failing requests.',
		'Watch › APM shows which route is failing and since when.',
	],
};

/** The failure a message describes, if the console knows it. */
export function troubleFor(message: string | null | undefined): Trouble | null {
	const m = message ?? '';
	if (!m) return null;
	if (/already running/i.test(m)) return 'pipeline-busy';
	if (/checks stage rebuilds/i.test(m)) return 'checks-refused';
	if (/Mac helper/i.test(m)) return 'helper';
	if (/Cannot connect to the Docker daemon|Docker (is )?not running|docker daemon/i.test(m)) return 'docker';
	if (/Authentication failed|MongoServerError|bad auth|NOAUTH|WRONGPASS/i.test(m)) return 'mongo-login';
	if (/certificate|mkcert|\.pem\b/i.test(m)) return 'certificate';
	if (/EADDRINUSE|address already in use|port is already allocated/i.test(m)) return 'port-taken';
	if (/infisical/i.test(m)) return 'infisical';
	if (/ENOSPC|no space left/i.test(m)) return 'disk';
	return null;
}

/** “What to do” for a failure: its steps as a lane, commands as code. */
@Component({
	selector: 'rc-trouble-steps',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (steps().length) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/list-check" />
						What to do
					</span>
				</div>
				<ul class="rc-lane">
					@for (s of steps(); track $index) {
						<li>
							<span class="rc-dot cy"></span>
							<span>
								@for (part of s.split('\`'); track $index) {
									@if ($odd) {
										<code>{{ part }}</code>
									} @else {
										{{ part }}
									}
								}
							</span>
							<span></span>
						</li>
					}
				</ul>
			</div>
		}
	`,
})
export class TroubleSteps {
	readonly trouble = input<Trouble | null>(null);
	protected readonly steps = computed(() => {
		const t = this.trouble();
		return t ? TROUBLE_STEPS[t] : [];
	});
}
