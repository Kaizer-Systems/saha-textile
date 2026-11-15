import 'dotenv/config';

import {
	connectMongo,
	dataMigrationsStep,
	databaseIndexesStep,
	disconnectMongo,
	systemRolesStep,
} from '@saha-textile/adapters-db-mongo';
import { runReleaseSteps, type ReleaseStep, type ReleaseStepEvent } from '@saha-textile/core-domain';

import { releaseLanguages, releaseSearch, searchIndexStep } from './search/search-release';

const MARK: Record<ReleaseStepEvent['phase'], string> = {
	start: '…',
	skip: '–',
	run: '▶',
	check: '?',
	done: '✓',
	fail: '✗',
};

/**
 * Every refresh a release needs, in order, before the apps switch:
 * `node dist/release-steps.js` (deploy), `pnpm local:refresh` (this Mac), and the Docker stack.
 *
 * - `--json` prints one JSON event per line, for the Release Console.
 * - `--without-search` leaves the search step out, for a Mac with no search engine running.
 *
 * Exits 1 at the first failed step; the deploy then stops before the switch.
 */
async function main(): Promise<void> {
	const json = process.argv.includes('--json');
	const steps: ReleaseStep[] = [systemRolesStep(), databaseIndexesStep(), dataMigrationsStep()];
	const languages = releaseLanguages();
	if (!process.argv.includes('--without-search')) steps.push(searchIndexStep(releaseSearch(languages)));
	const report = (event: ReleaseStepEvent) =>
		// A person reading the deploy needs no "starting" line; the console does.
		(json || event.phase !== 'start') &&
		process.stdout.write(
			json
				? `${JSON.stringify({ type: 'release-step', ...event })}\n`
				: `${MARK[event.phase]} ${event.label}: ${event.detail}${event.ms === undefined ? '' : ` (${event.ms} ms)`}\n`,
		);
	await connectMongo();
	try {
		// The stored languages (seeded from ACTIVE_LOCALES on a first release) decide the search titles.
		await languages.refresh();
		const { ran, skipped } = await runReleaseSteps(steps, report);
		if (!json)
			process.stdout.write(`Release steps done: ${ran.length} ran, ${skipped.length} had nothing to do.\n`);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
