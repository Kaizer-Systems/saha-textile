import 'dotenv/config';
import 'reflect-metadata';

import {
	MongoAuthIdentityRepository,
	MongoCustomerRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';

/**
 * LOCAL-ONLY: returns a real person's Google / Facebook account to "never signed up here".
 *
 *   pnpm --filter @saha-textile/api reset:local-customer -- --i-am-local \
 *     --email someone@gmail.com [--email other@example.com] [--phone +919800000000]
 *
 * ## Why this exists
 *
 * Social sign-in can only be tested end to end with REAL provider accounts — the subjects come
 * from Google and Meta, so they cannot be seeded. Each signup round therefore creates a customer
 * that the next round's "first time here" scenario has to get rid of again, and doing that by
 * hand in `mongosh` is how somebody deletes the wrong rows (see the `authIdentities` incident in
 * `project-progress.mdx`, 2026-08-18).
 *
 * ## What it does
 *
 * For every customer matching a given email or phone: soft-deletes the row and detaches every
 * linked provider identity. Soft delete releases the email and phone — their unique indexes are
 * partial on the non-deleted statuses — but NOT the `(provider, providerSubject)` pair, so the
 * identities are unlinked explicitly; otherwise the next Google click would find the tombstone
 * and refuse to begin a signup. The same reasoning as `seed-local-auth-accounts`.
 *
 * Built on the Mongo repositories directly rather than a Nest application context: it runs
 * from source under `tsx`, which does not emit decorator metadata, so Nest's injector cannot
 * resolve constructor dependencies there. Two repositories with no dependencies need no
 * container. Excluded from `nest build`, like the other local-only tools.
 *
 * It does not touch the provider side. Revoking the Google grant or removing the app from
 * Facebook is only needed to see a first-time CONSENT screen again, and is done in the browser.
 */

function readArguments(name: string): string[] {
	return process.argv.flatMap((value, index, all) => (value === name && all[index + 1] ? [all[index + 1]!] : []));
}

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

/** Same refusal gate as the other local tools: this deletes accounts by address. */
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

async function main(): Promise<void> {
	assertLocalOnly();

	const emails = readArguments('--email').map((email) => email.trim().toLowerCase());
	const phones = readArguments('--phone').map((phone) => phone.trim());
	if (emails.length === 0 && phones.length === 0) {
		process.stderr.write(
			'Usage: reset:local-customer -- --i-am-local --email <addr> [--email <addr>] [--phone <e164>]\n',
		);
		process.exitCode = 1;
		return;
	}

	await connectMongo();
	try {
		const customers = new MongoCustomerRepository();
		const identities = new MongoAuthIdentityRepository();

		const matches = new Map<string, string>();
		for (const email of emails) {
			const found = await customers.findByEmail(email);
			if (found) matches.set(found.id, email);
		}
		for (const phone of phones) {
			const found = await customers.findByPhone(phone);
			if (found) matches.set(found.id, phone);
		}

		const rows: string[] = [];
		for (const [customerId, matchedOn] of matches) {
			const linked = await identities.listForSubject('customer', customerId);
			for (const identity of linked) await identities.unlink('customer', customerId, identity.provider);
			await customers.setStatus(customerId, 'deleted');
			const providers = linked.map((identity) => identity.provider).join(', ') || 'none';
			rows.push(`  ${customerId}  matched ${matchedOn}  unlinked: ${providers}`);
		}

		process.stdout.write(
			rows.length > 0
				? ['', 'Reset (soft-deleted, identities unlinked):', ...rows, ''].join('\n')
				: '\nNo live customer matched; nothing changed.\n',
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`reset-local-customer failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
