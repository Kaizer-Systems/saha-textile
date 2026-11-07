import 'dotenv/config';

import { connectMongo, disconnectMongo, seedFirstRun } from '@saha-textile/adapters-db-mongo';

/**
 * Prepares a new deployed database: `node dist/first-run-setup.js`. Safe to repeat. The first
 * administrator is a separate step, because it prints a credential and runs by hand.
 */
async function main(): Promise<void> {
	await connectMongo();
	try {
		const { currencies, templates } = await seedFirstRun();
		process.stdout.write(`First-run setup done: added ${currencies} currencies and ${templates} templates.\n`);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
