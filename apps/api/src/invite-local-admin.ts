import 'dotenv/config';
import 'reflect-metadata';

import {
	MongoAdminInviteRepository,
	MongoAdminUserAuthRepository,
	MongoAdminUserRepository,
	MongoAuditLogRepository,
	MongoAuthRateLimitRepository,
	MongoCustomerAuthRepository,
	MongoCustomerRepository,
	MongoEmailVerificationTokenRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
	MongoTransactionManager,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { AdminRole } from '@saha-textile/contracts';
import type { NotificationMessage, NotificationPort, NotificationResult } from '@saha-textile/core-domain';

import { AdminInviteService } from './auth/admin-invite.service';
import { AuthService } from './auth/auth.service';
import { loadConfig } from './config/app-config';
import { Argon2JwtAuth } from './infra/argon2-jwt.auth';

/**
 * LOCAL-ONLY: creates an admin invitation and prints its accept link once.
 *
 *   pnpm --filter @saha-textile/api invite:local-admin -- \
 *     --i-am-local --email pin-check@saha-textile.test [--role staff|admin] \
 *     [--admin-url https://localhost:4300]
 *
 * ## Why this exists
 *
 * An invitation's token leaves the API exactly once, inside the `admin_invite` email, and the
 * console notification adapter deliberately withholds every variable so tokens never reach a
 * log. That is right for the application and leaves local QA with no way to follow an invite:
 * without MSG91 there is no email, and without the email there is no link. This tool runs the
 * REAL `AdminInviteService.create` — same token shape, same HMAC, same audit row — and swaps
 * only the delivery: the notification port here hands the token back instead of sending it.
 *
 * In staging and production the link is built by the `admin_invite` MSG91 email template
 * (`<admin host>/auth/accept-invite?token=##token##`), so the API never holds a hostname.
 *
 * Refuses production, non-loopback Mongo and non-`_local` databases, like the other local
 * tools. Excluded from `nest build`.
 */

function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertLocalOnly(): void {
	if (!process.argv.includes('--i-am-local')) {
		throw new Error('Refused: pass --i-am-local (this tool is for local Docker Mongo only).');
	}
	if (process.env.NODE_ENV === 'production') {
		throw new Error('Refused: NODE_ENV=production.');
	}
	const host = (process.env.MONGODB_HOST || '127.0.0.1').toLowerCase();
	if (!new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']).has(host)) {
		throw new Error(`Refused: MONGODB_HOST=${host} is not a loopback host.`);
	}
	if (!(process.env.MONGODB_DB_NAME ?? '').endsWith('_local')) {
		throw new Error('Refused: MONGODB_DB_NAME must end in _local.');
	}
}

/** Keeps the invitation's variables instead of delivering them. */
class CapturingNotifications implements NotificationPort {
	public captured: NotificationMessage | null = null;

	async send(message: NotificationMessage): Promise<NotificationResult> {
		this.captured = message;
		return { status: 'sent', providerMessageId: 'local_invite_tool', outboxEntryId: 'local_invite_tool' };
	}

	async isChannelEnabled(): Promise<boolean> {
		return true;
	}
}

async function main(): Promise<void> {
	assertLocalOnly();

	const email = readArgument('--email');
	if (!email || !email.includes('@')) throw new Error('Refused: --email is required.');
	const role = AdminRole.parse(readArgument('--role') ?? 'staff');
	const adminUrl = new URL(readArgument('--admin-url') ?? 'https://localhost:4300');

	await connectMongo();
	try {
		const config = loadConfig();
		const notifications = new CapturingNotifications();
		const auth = new AuthService(
			config,
			new Argon2JwtAuth(config),
			new MongoCustomerAuthRepository(),
			new MongoAdminUserAuthRepository(),
			new MongoCustomerRepository(),
			new MongoAdminUserRepository(),
			new MongoOtpChallengeRepository(),
			new MongoPasswordResetTokenRepository(),
			new MongoEmailVerificationTokenRepository(),
			new MongoAuthRateLimitRepository(),
			notifications,
		);
		const invites = new AdminInviteService(
			auth,
			new MongoAdminInviteRepository(),
			new MongoAdminUserAuthRepository(),
			new MongoAdminUserRepository(),
			new MongoAuditLogRepository(),
			notifications,
			new MongoTransactionManager(),
		);

		const invite = await invites.create({ request: { email, role }, invitedByUserId: 'local_invite_tool' });
		const token = notifications.captured?.variables?.['token'];
		if (typeof token !== 'string') throw new Error('The invitation was created but no token was captured.');

		const link = new URL('/auth/accept-invite', adminUrl);
		link.searchParams.set('token', token);
		process.stdout.write(
			[
				'',
				'Local admin invitation created (link shown once).',
				'',
				`  email:   ${invite.emailNormalized}`,
				`  role:    ${invite.role}`,
				`  expires: ${invite.expiresAt}`,
				`  link:    ${link.toString()}`,
				'',
				'Never commit this output. Use for local browser QA only.',
				'',
			].join('\n'),
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`invite-local-admin failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
