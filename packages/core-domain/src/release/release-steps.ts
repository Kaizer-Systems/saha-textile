/**
 * The release-steps runner. Every refresh a release needs (system roles, database indexes, data
 * migrations, search) is one named step that answers three questions: is it needed, do it, and
 * did it work. The production deploy, the full Docker stack and `pnpm local:refresh` all run the
 * same steps, before the apps switch, so the old release keeps serving until every step passes.
 *
 * Each step reports its progress as events, which the deploy prints and the Release Console reads.
 */

/** How often a step has work to do. Shown beside the step; the runner asks `needed()` either way. */
export type ReleaseCadence = 'every-release' | 'when-changed' | 'once';

export interface ReleaseStepNeed {
	needed: boolean;
	/** Why, in a few words: "3 indexes differ", "nothing pending". */
	reason: string;
}

export interface ReleaseStepCheck {
	ok: boolean;
	detail: string;
}

export interface ReleaseStep {
	/** Stable key for events and the console, e.g. `system-roles`. */
	readonly key: string;
	readonly label: string;
	readonly cadence: ReleaseCadence;
	needed(): Promise<ReleaseStepNeed>;
	/** Does the work and says what it did. */
	run(): Promise<string>;
	/** Proves the result. A failed check stops the release before the switch. */
	check(): Promise<ReleaseStepCheck>;
}

export type ReleaseStepPhase = 'start' | 'skip' | 'run' | 'check' | 'done' | 'fail';

export interface ReleaseStepEvent {
	step: string;
	label: string;
	cadence: ReleaseCadence;
	phase: ReleaseStepPhase;
	detail: string;
	/** ISO time the event happened. */
	at: string;
	/** Milliseconds since the step started, on `done`, `skip` and `fail`. */
	ms?: number;
}

export class ReleaseStepFailedError extends Error {
	override readonly name = 'ReleaseStepFailedError';
	constructor(
		readonly step: string,
		detail: string,
	) {
		super(`Release step "${step}" failed: ${detail}`);
	}
}

export interface ReleaseRunResult {
	ran: string[];
	skipped: string[];
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the steps in order. A step that is not needed is still checked, because "nothing to do"
 * is itself a claim worth proving (a role that lost a permission by hand reads as not needed).
 * The first failure stops the run and throws `ReleaseStepFailedError`.
 */
export async function runReleaseSteps(
	steps: readonly ReleaseStep[],
	report: (event: ReleaseStepEvent) => void,
	clock: () => number = Date.now,
): Promise<ReleaseRunResult> {
	const result: ReleaseRunResult = { ran: [], skipped: [] };
	for (const step of steps) {
		const started = clock();
		const emit = (phase: ReleaseStepPhase, detail: string, timed = false) =>
			report({
				step: step.key,
				label: step.label,
				cadence: step.cadence,
				phase,
				detail,
				at: new Date(clock()).toISOString(),
				...(timed ? { ms: clock() - started } : {}),
			});
		emit('start', step.label);
		try {
			const need = await step.needed();
			if (need.needed) {
				emit('run', need.reason);
				const did = await step.run();
				emit('check', did);
			}
			const verdict = await step.check();
			if (!verdict.ok) throw new Error(verdict.detail);
			if (need.needed) {
				result.ran.push(step.key);
				emit('done', verdict.detail, true);
			} else {
				result.skipped.push(step.key);
				emit('skip', `${need.reason}; ${verdict.detail}`, true);
			}
		} catch (error) {
			emit('fail', message(error), true);
			throw new ReleaseStepFailedError(step.key, message(error));
		}
	}
	return result;
}

/** One data migration. Written in two halves: `expand` adds the new shape and keeps the old; a later release's `contract` removes the old, so a rollback always finds data it understands. */
export interface DataMigration {
	/** Sortable and unique: `0001-orders-delivered-status`. Never renamed once released. */
	readonly id: string;
	readonly description: string;
	readonly half: 'expand' | 'contract';
	/** Does the change and says how much it touched. Must be safe to run on a database it already ran on. */
	up(): Promise<string>;
}

/** Ids must be unique and already in order, so every database applies them the same way. */
export function assertMigrationOrder(migrations: readonly Pick<DataMigration, 'id'>[]): void {
	const ids = migrations.map((migration) => migration.id);
	const sorted = [...ids].sort();
	if (new Set(ids).size !== ids.length) throw new Error('Two data migrations share an id');
	if (ids.some((id, index) => id !== sorted[index])) throw new Error('Data migrations are not listed in id order');
	const bad = ids.find((id) => !/^\d{4}-[a-z0-9-]+$/.test(id));
	if (bad) throw new Error(`Data migration id "${bad}" must look like 0001-short-name`);
}

/** Migrations whose ids are not yet recorded as applied, in order. */
export function pendingMigrations<T extends Pick<DataMigration, 'id'>>(
	migrations: readonly T[],
	applied: ReadonlySet<string>,
): T[] {
	assertMigrationOrder(migrations);
	return migrations.filter((migration) => !applied.has(migration.id));
}
