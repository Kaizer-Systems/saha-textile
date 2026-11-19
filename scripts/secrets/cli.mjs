#!/usr/bin/env node
/**
 * Infisical commands for this repository.
 *
 *   pnpm secrets:status                  every project
 *   pnpm secrets:status -- staging       one project: dev, staging or production
 *
 * `status` prints, per project and folder, how many settings are filled, which names are missing,
 * misspelt or due for deletion, and whether the project is ready for a release. It prints names and
 * counts only, never a value, so its output is safe to paste anywhere.
 *
 * It needs the Infisical CLI signed in (`infisical login`) with access to the projects.
 */
import { exportProject } from './infisical.mjs';
import { SecretsError, TIERS, loadInventory } from './inventory.mjs';
import { formatReport, projectReport } from './render.mjs';

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
		const folders = exportProject(project);
		blocks.push(
			formatReport(projectReport(folders, { tier, inventory }), `${project.name} (${project.environment})`),
		);
	}
	console.log(blocks.join('\n\n'));
}

const commands = { status };

function main() {
	const [command, ...args] = process.argv.slice(2);
	const run = commands[/** @type {keyof typeof commands} */ (command)];
	if (!run) {
		console.error('Usage: node scripts/secrets/cli.mjs status [dev|staging|production]');
		process.exit(2);
	}
	try {
		run(args);
	} catch (error) {
		// Only our own messages are printed: they name settings and never carry a value. Other errors
		// (a JSON parse error, for one) can quote their input, so only their kind is shown.
		if (error instanceof SecretsError) console.error(error.message);
		else {
			const { name, code } = /** @type {NodeJS.ErrnoException} */ (error);
			console.error(`Unexpected failure (${code ?? name}). Nothing was written.`);
		}
		process.exit(1);
	}
}

main();
