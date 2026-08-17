import 'dotenv/config';
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import type { AuthIdentity, Customer } from '@saha-textile/contracts';
import type {
	AuthIdentityRepository,
	AuthPort,
	CustomerAuthRepository,
	CustomerRepository,
} from '@saha-textile/core-domain';

import { AppModule } from './app.module';
import { AUTH_IDENTITY_REPOSITORY, AUTH_PORT, CUSTOMER_AUTH_REPOSITORY, CUSTOMER_REPOSITORY } from './infra/tokens';

/**
 * LOCAL-ONLY storefront accounts covering every SHAPE of sign-in an account can have.
 *
 *   pnpm --filter @saha-textile/api seed:local-auth-accounts -- --i-am-local
 *
 * ## Why this exists
 *
 * The catalogue seed produces plenty of customers, but every one of them has an email and no
 * credential of any kind — so none can actually sign in, and none exercises the cases the
 * account security screen is built around: an account that can only be entered through a
 * provider, one that would be locked out if its last provider were disconnected, one that has
 * every method at once. Building those screens against absent data means guessing, and a guess
 * about "can this person still get in afterwards?" is the kind that locks somebody out.
 *
 * ## What it guarantees
 *
 * Accounts are written through the REAL repositories and the REAL argon2 hasher, never by
 * hand-assembling documents. `CustomerRepository.create` is what turns `identities` into
 * `authIdentities` rows, so the linkage here is produced by the same code the application uses
 * rather than a parallel imitation that could drift.
 *
 * Provider subjects are deliberately synthetic and namespaced `local-…`. They are NOT real
 * Google or Facebook accounts and cannot be signed into with a provider button — they populate
 * the linked-identity list so the connect/disconnect rules have something to reason about.
 * Signing in as one of these accounts is done with its password, or with a one-time code.
 *
 * Re-running replaces these accounts and nothing else: it matches on the fixed local addresses
 * below and never touches a row it did not create.
 */

/** Shared across every seeded account: one thing to remember, printed once at the end. */
const LOCAL_PASSWORD = 'local-probe-password-2026';
const DOMAIN = '@local.saha-textile.test';

type Shape = {
	slug: string;
	displayName: string;
	/** Null means the account has NO password — provider or one-time code only. */
	password: boolean;
	providers: ('google' | 'facebook')[];
	status: Customer['status'];
	/** Why this row is worth keeping; printed so the list explains itself. */
	covers: string;
	/**
	 * How many saved addresses to give it.
	 *
	 * Not decoration: the account screens render addresses through an adapter that reshapes our
	 * `Address` into the ported view's flatter one, and an account with none exercises only the
	 * empty state. Two on one account covers the default badge and a non-default sibling.
	 */
	addresses?: number;
};

const SHAPES: Shape[] = [
	{
		slug: 'password-only',
		displayName: 'Password Only',
		password: true,
		providers: [],
		status: 'active',
		covers: 'the ordinary account; disconnect rows should be absent, connect rows offered',
		addresses: 1,
	},
	{
		slug: 'password-google',
		displayName: 'Password And Google',
		password: true,
		providers: ['google'],
		status: 'active',
		covers: 'disconnecting Google is safe because a password remains',
	},
	{
		slug: 'google-only',
		displayName: 'Google Only',
		password: false,
		providers: ['google'],
		status: 'active',
		covers: 'the lockout case — disconnecting the only provider must be refused until a password is set',
	},
	{
		slug: 'google-facebook',
		displayName: 'Google And Facebook',
		password: false,
		providers: ['google', 'facebook'],
		status: 'active',
		covers: 'no password, but two providers — either one may go, the second may not',
	},
	{
		slug: 'all-methods',
		displayName: 'Every Method',
		password: true,
		providers: ['google', 'facebook'],
		status: 'active',
		covers: 'every row present at once; nothing is the last remaining credential',
		addresses: 2,
	},
	{
		slug: 'disabled',
		displayName: 'Disabled Account',
		password: true,
		providers: [],
		status: 'disabled',
		covers: 'correct credentials must still be refused, with the same generic message',
	},
	{
		slug: 'locked',
		displayName: 'Locked Account',
		password: true,
		providers: [],
		status: 'locked',
		covers: 'as disabled — the screen must not offer sign-in it knows will fail',
	},
];

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

/** Same refusal gate as `set-local-test-credentials`: this writes accounts with known passwords. */
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

const emailFor = (shape: Shape) => `auth-${shape.slug}${DOMAIN}`;

/**
 * A stable, obviously-synthetic phone per shape.
 *
 * Phone is a login credential and carries a unique index, so these must not collide with each
 * other or with the catalogue seed. `+9199` plus the shape's position keeps them inside a
 * recognisable block.
 */
const phoneFor = (index: number) => `+9199000${String(index).padStart(5, '0')}`;

/** Saved addresses, shaped exactly as the app writes them. */
function addressesFor(shape: Shape, index: number): Customer['addresses'] {
	const labels = ['Home', 'Office'];
	return Array.from({ length: shape.addresses ?? 0 }, (_unused, position) => ({
		id: `adr_${shape.slug}_${position}`,
		label: labels[position] ?? `Address ${position + 1}`,
		fullName: shape.displayName,
		line1: `${position + 12} Weavers Lane`,
		line2: position === 0 ? 'Near the silk market' : undefined,
		city: 'Kolkata',
		state: 'West Bengal',
		postalCode: `7000${String(position + 1).padStart(2, '0')}`,
		country: 'India',
		phone: phoneFor(index),
		// Exactly one default, which is what the badge in the address list reads.
		isDefault: position === 0,
	}));
}

function identitiesFor(shape: Shape, email: string): AuthIdentity[] {
	return shape.providers.map((provider) => ({
		provider,
		// Namespaced so it can never be mistaken for a real provider subject.
		providerId: `local-${provider}-${shape.slug}`,
		email,
	}));
}

async function main(): Promise<void> {
	assertLocalOnly();

	/**
	 * Errors and warnings stay ON deliberately. With `logger: false` a dependency-resolution
	 * failure is swallowed by Nest and the process just exits 1 with both streams empty, which
	 * is indistinguishable from a silent refusal.
	 */
	const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: ['error', 'warn'] });
	try {
		await app.init();
		const auth = app.get<AuthPort>(AUTH_PORT);
		const customers = app.get<CustomerRepository>(CUSTOMER_REPOSITORY);
		const customerAuth = app.get<CustomerAuthRepository>(CUSTOMER_AUTH_REPOSITORY);
		const identities = app.get<AuthIdentityRepository>(AUTH_IDENTITY_REPOSITORY);
		const passwordHash = await auth.hashPassword(LOCAL_PASSWORD);

		const rows: string[] = [];
		for (const [index, shape] of SHAPES.entries()) {
			const email = emailFor(shape);
			const existing = await customers.findByEmail(email);
			/**
			 * Retire and re-create rather than update in place: a rerun must not leave an identity
			 * from a previous shape attached, which is exactly the stale row that makes a security
			 * screen lie about what can still open the account.
			 *
			 * `deleted` is a soft delete, and for email and phone that is enough — their unique
			 * indexes are partial on the non-deleted statuses, so retiring the row releases both
			 * for the replacement. Tombstones accumulate one per rerun, which is what
			 * `DEC-DELETE-RETENTION` asks for.
			 *
			 * Linked identities are NOT released by that: `authIdentities` is unique on
			 * `(provider, providerSubject)` and a soft delete leaves those rows attached. So the
			 * provider subjects are released explicitly below, by owner rather than by email —
			 * `findByEmail` cannot see a tombstone, and it is the tombstones from earlier runs
			 * that still hold the pair.
			 */
			if (existing) await customers.setStatus(existing.id, 'deleted');

			for (const identity of identitiesFor(shape, email)) {
				const holder = await identities.findByProviderSubject(identity.provider, identity.providerId!);
				if (holder) await identities.unlink(holder.subjectType, holder.subjectId, holder.provider);
			}

			const customer: Customer = {
				id: `cus_${randomUUID()}`,
				email,
				emailVerified: true,
				phone: phoneFor(index),
				// Both proven: `DEC-SIGNUP-VERIFICATION` says no account exists otherwise.
				phoneVerified: true,
				displayName: shape.displayName,
				status: 'active',
				identities: identitiesFor(shape, email),
				addresses: addressesFor(shape, index),
				contacts: [],
				savedSizes: [],
				measurementProfiles: [],
				guestCartId: null,
			};
			const created = await customers.create(customer);

			if (shape.password) await customerAuth.setPasswordHash(created.id, passwordHash);
			// Applied last: an account created disabled could not have had a hash written to it.
			if (shape.status !== 'active') await customerAuth.setStatus(created.id, shape.status);

			const methods = [shape.password ? 'password' : null, ...shape.providers].filter(Boolean).join(' + ');
			rows.push(
				`  ${email.padEnd(46)} ${(methods || 'none').padEnd(28)} ${shape.status.padEnd(9)} ${shape.covers}`,
			);
		}

		process.stdout.write(
			[
				'',
				'Local storefront auth accounts seeded (real repositories, real argon2 hashes).',
				'',
				`  ${'email'.padEnd(46)} ${'methods'.padEnd(28)} ${'status'.padEnd(9)} covers`,
				...rows,
				'',
				`  password (all of the above): ${LOCAL_PASSWORD}`,
				`  phones:                      ${phoneFor(0)} … ${phoneFor(SHAPES.length - 1)}`,
				'',
				'Provider subjects are synthetic `local-…` values, not real Google/Facebook accounts:',
				'they populate the linked-identity list; sign in with the password or a one-time code.',
				'',
				'Local browser QA only. Never run against anything but the local Docker Mongo.',
				'',
			].join('\n'),
		);
	} finally {
		await app.close();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(
		`seed-local-auth-accounts failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
