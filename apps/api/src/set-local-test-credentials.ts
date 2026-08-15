import 'dotenv/config';
import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import type { AdminUserAuthRepository, AuthPort, CustomerAuthRepository } from '@saha-textile/core-domain';
import { evaluatePassword } from '@saha-textile/core-domain';

import { AppModule } from './app.module';
import { ADMIN_USER_AUTH_REPOSITORY, AUTH_PORT, CUSTOMER_AUTH_REPOSITORY } from './infra/tokens';

/**
 * LOCAL-ONLY helper so agents can set/rotate known passwords/PINs for browser QA
 * without asking the owner to type credentials (deferred plan: agent-browser-auth).
 *
 *   pnpm --filter @saha-textile/api set:local-credentials -- \
 *     --i-am-local --audience admin --email owner@example.com --password '…' [--pin 123456]
 *
 *   pnpm --filter @saha-textile/api set:local-credentials -- \
 *     --i-am-local --audience storefront --email shopper@example.com
 *
 * If `--password` is omitted, a random 20-char secret is generated and printed once.
 * Argon2 hashes are never reversed — this always writes a new hash.
 */

function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

function assertLocalOnly(): void {
	if (!hasFlag('--i-am-local')) {
		throw new Error('Refused: pass --i-am-local (this tool is for local Docker Mongo only).');
	}
	if (process.env.NODE_ENV === 'production') {
		throw new Error('Refused: NODE_ENV=production.');
	}
	const host = (process.env.MONGODB_HOST || '127.0.0.1').toLowerCase();
	const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
	if (!localHosts.has(host)) {
		throw new Error(`Refused: MONGODB_HOST=${host} is not a loopback host.`);
	}
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function generatePassword(): string {
	return `local-${randomBytes(12).toString('base64url')}`;
}

function assertPin(pin: string): void {
	if (!/^\d{6}$/.test(pin)) {
		throw new Error('PIN must be exactly 6 digits.');
	}
}

async function main(): Promise<void> {
	assertLocalOnly();

	const audience = readArgument('--audience');
	const emailRaw = readArgument('--email');
	if (audience !== 'admin' && audience !== 'storefront') {
		process.stderr.write(
			'Usage: set:local-credentials -- --i-am-local --audience admin|storefront --email <addr> [--password <pwd>] [--pin <6digits>]\n',
		);
		process.exitCode = 1;
		return;
	}
	if (!emailRaw || !emailRaw.includes('@')) {
		process.stderr.write('Refused: --email is required.\n');
		process.exitCode = 1;
		return;
	}

	const email = normalizeEmail(emailRaw);
	const password = readArgument('--password') ?? generatePassword();
	const pin = readArgument('--pin');
	const passwordDecision = evaluatePassword(password);
	if (!passwordDecision.acceptable) {
		process.stderr.write(`Refused: password policy (${passwordDecision.refusal}).\n`);
		process.exitCode = 1;
		return;
	}
	if (pin) assertPin(pin);
	if (pin && audience !== 'admin') {
		process.stderr.write('Refused: --pin is only valid for --audience admin.\n');
		process.exitCode = 1;
		return;
	}

	const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: false });
	try {
		await app.init();
		const auth = app.get<AuthPort>(AUTH_PORT);
		const passwordHash = await auth.hashPassword(password);

		if (audience === 'admin') {
			const admins = app.get<AdminUserAuthRepository>(ADMIN_USER_AUTH_REPOSITORY);
			const user = await admins.findAuthStateByIdentifier(email);
			if (!user) {
				process.stderr.write(`Refused: no admin user for ${email}.\n`);
				process.exitCode = 1;
				return;
			}
			await admins.setPasswordHash(user.id, passwordHash);
			await admins.bumpTokenVersion(user.id);
			if (user.status !== 'active') {
				await admins.setStatus(user.id, 'active');
			}
			if (pin) {
				await admins.setPinHash(user.id, await auth.hashPassword(pin));
			}
			process.stdout.write(
				[
					'',
					'Local admin credentials rotated (hash written; plaintext shown once).',
					'',
					`  audience: admin`,
					`  id:       ${user.id}`,
					`  email:    ${email}`,
					`  password: ${password}`,
					...(pin ? [`  pin:      ${pin}`] : []),
					'',
					'Never commit this output. Use for local browser QA only.',
					'',
				].join('\n'),
			);
			return;
		}

		const customers = app.get<CustomerAuthRepository>(CUSTOMER_AUTH_REPOSITORY);
		const customer = await customers.findAuthStateByEmail(email);
		if (!customer) {
			process.stderr.write(`Refused: no customer for ${email}.\n`);
			process.exitCode = 1;
			return;
		}
		await customers.setPasswordHash(customer.id, passwordHash);
		await customers.bumpTokenVersion(customer.id);
		if (customer.status !== 'active') {
			await customers.setStatus(customer.id, 'active');
		}
		process.stdout.write(
			[
				'',
				'Local customer credentials rotated (hash written; plaintext shown once).',
				'',
				`  audience: storefront`,
				`  id:       ${customer.id}`,
				`  email:    ${email}`,
				`  password: ${password}`,
				`  status:   active`,
				'',
				'Never commit this output. Use for local browser QA only.',
				'',
			].join('\n'),
		);
	} finally {
		await app.close();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(
		`set-local-test-credentials failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
