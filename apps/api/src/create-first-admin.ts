import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ADMINISTRATOR_ROLE_KEY, UserModel, ensureSystemRoles } from '@saha-textile/adapters-db-mongo';

import { AppModule } from './app.module';
import { FirstAdminAlreadyExistsError, bootstrapFirstAdmin } from './first-admin';

/**
 * Operator CLI for the first-administrator bootstrap.
 *
 *   pnpm --filter @saha-textile/api bootstrap:first-admin -- --email owner@example.com
 *
 * An application CONTEXT rather than an HTTP server: this must never be able to serve a
 * request, and creating one would mean a process that briefly listens on a port while holding
 * the ability to mint an administrator.
 */
function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
	const email = readArgument('--email');
	if (!email || !email.includes('@')) {
		process.stderr.write('Usage: bootstrap:first-admin -- --email <address>\n');
		process.exitCode = 1;
		return;
	}

	// `logger: false` keeps the framework quiet so the credential below is the only thing on
	// stdout that matters, and cannot scroll past in a wall of module-initialised lines.
	const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: false });

	try {
		await app.init();
		const result = await bootstrapFirstAdmin(
			app,
			{ email },
			{
				models: { UserModel: UserModel as never },
				ensureSystemRoles,
				administratorRoleKey: ADMINISTRATOR_ROLE_KEY,
			},
		);

		process.stdout.write(
			[
				'',
				'First administrator created.',
				'',
				`  email:    ${result.email}`,
				`  password: ${result.password}`,
				`  role:     ${result.roleKey}`,
				'',
				'This password is shown ONCE and is stored only as an argon2 hash.',
				'Sign in, then change it from Security Settings.',
				'',
			].join('\n'),
		);
	} catch (error) {
		if (error instanceof FirstAdminAlreadyExistsError) {
			// A refusal is the CORRECT outcome on a second run, so it says so plainly rather
			// than printing a stack trace that reads like a malfunction.
			process.stderr.write(
				`\nRefused: ${error.message}\n\nUse an invite and a role grant to add further administrators.\n\n`,
			);
			process.exitCode = 1;
			return;
		}
		throw error;
	} finally {
		await app.close();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`first-admin bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
