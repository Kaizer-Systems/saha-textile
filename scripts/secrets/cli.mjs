#!/usr/bin/env node
/**
 * Infisical commands for this repository.
 *
 *   pnpm secrets:status                  every project
 *   pnpm secrets:status -- staging       one project: dev, staging or production
 *   pnpm secrets:pull                    rewrite apps/api/.env from the dev project (see pull.mjs)
 *   pnpm stack:env                       write docker/stack/env/ from the dev project (see stack.mjs)
 *   pnpm secrets:setup-local             real logins for this Mac's services (see local-setup.mjs)
 *
 * `status` prints, per project and folder, how many settings are filled, which names are missing,
 * misspelt or due for deletion, and whether the project is ready for a release. Every command prints
 * names and counts only, never a value, so its output is safe to paste anywhere.
 *
 * They need the Infisical CLI signed in (`infisical login`) with access to the projects.
 */
import { exportFolder, exportProject } from './infisical.mjs';
import { ROOT, SecretsError, TIERS, describeError, loadInventory } from './inventory.mjs';
import { setupLocal } from './local-setup.mjs';
import { pullDevEnv, refreshBeforeDev } from './pull.mjs';
import { formatOtherFolder, formatReport, otherFolderReport, projectReport } from './render.mjs';
import { stackAddresses, stackApiSettings, writeStackEnv } from './stack.mjs';

/** Notes from the Infisical CLI, said once at the end (for one, that it answered from its own copy). */
const notes = new Set();
// The API settings the local pipeline's release sets itself (the stack's services, hosts and proxy).
const PIPELINE_SETS = new Set(
	stackApiSettings(stackAddresses('443'), {
		redisPassword: '-',
		searchKey: '-',
		mongo: { appUser: '-', appPassword: '-' },
	}).keys(),
);

/** @param {string[]} args */
function status(args) {
	const wanted = args.filter((arg) => arg !== '--');
	const tiers = wanted.length === 0 || wanted.includes('all') ? TIERS : wanted;
	for (const tier of tiers) {
		if (!TIERS.includes(tier))
			throw new SecretsError(`Unknown project "${tier}". Use one of: ${TIERS.join(', ')}.`);
	}
	const inventory = loadInventory();
	const blocks = [];
	for (const tier of /** @type {Array<'dev' | 'staging' | 'production'>} */ (tiers)) {
		const project = inventory.projects[tier];
		const folders = exportProject(project, { notes });
		const lines = [
			formatReport(
				projectReport(folders, { tier, inventory, setByPipeline: PIPELINE_SETS }),
				`${project.name} (${project.environment})`,
			),
		];
		// Folders the shop never reads, such as the Release Console's keys: reported, never rendered.
		for (const group of inventory.otherFolders.filter((candidate) => candidate.tiers.has(tier))) {
			let values = null;
			try {
				values = exportFolder({
					projectId: project.projectId,
					environment: project.environment,
					folder: group.folder,
					notes,
				});
			} catch (error) {
				if (!(error instanceof SecretsError)) throw error;
			}
			lines.push(formatOtherFolder(otherFolderReport(group, values, folders)));
		}
		blocks.push(lines.join('\n'));
	}
	console.log(blocks.join('\n\n'));
}

/** @param {import('./inventory.mjs').Inventory} inventory */
function devApiReader(inventory) {
	const { projectId, environment } = inventory.projects.dev;
	return () => exportFolder({ projectId, environment, folder: 'api', notes });
}

const PULL_FLAGS = new Set(['--auto', '--replace', '--dry-run']);

/** @param {string[]} args */
function pull(args) {
	const flags = args.filter((arg) => arg !== '--');
	const unknown = flags.filter((flag) => !PULL_FLAGS.has(flag));
	if (unknown.length > 0) throw new SecretsError(`Unknown option ${unknown[0]}. Use --dry-run or --replace.`);
	const inventory = loadInventory();
	const options = { root: ROOT, inventory, readApi: devApiReader(inventory) };
	if (flags.includes('--auto')) {
		console.log(refreshBeforeDev(options).lines.join('\n'));
		return;
	}
	const result = pullDevEnv({
		...options,
		replace: flags.includes('--replace'),
		dryRun: flags.includes('--dry-run'),
	});
	console.log(result.lines.join('\n'));
	if (result.outcome === 'kept') process.exitCode = 1;
}

function stackEnv() {
	const inventory = loadInventory();
	const { projectId, environment } = inventory.projects.dev;
	const readInfrastructure = () => exportFolder({ projectId, environment, folder: 'infrastructure', notes });
	console.log(
		writeStackEnv({ root: ROOT, inventory, readApi: devApiReader(inventory), readInfrastructure }).join('\n'),
	);
}

function setupLocalCommand() {
	console.log(setupLocal({ root: ROOT }).join('\n'));
}

const commands = { status, pull, 'stack-env': stackEnv, 'setup-local': setupLocalCommand };

function main() {
	const [command, ...args] = process.argv.slice(2);
	const run = commands[/** @type {keyof typeof commands} */ (command)];
	if (!run) {
		console.error(
			'Usage: node scripts/secrets/cli.mjs status [dev|staging|production] | pull [--dry-run|--replace] | stack-env | setup-local',
		);
		process.exit(2);
	}
	try {
		run(args);
	} catch (error) {
		console.error(describeError(error));
		process.exitCode = 1;
	} finally {
		for (const note of notes) console.log(note);
	}
}

main();
