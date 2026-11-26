#!/usr/bin/env node
/**
 * The full accounts run (owner, 24 Nov): months of daily work on a throwaway database, every posting and report
 * checked against figures worked out by hand, then the sandbox removed.
 *
 *   ACCOUNTS_E2E_API_DIST=<api build outside apps/api> node scripts/accounts-e2e/run.mjs [--keep]
 *
 * `--keep` leaves the sandbox database and the API running for a look afterwards (Ctrl+C stops it). With
 * ACCOUNTS_E2E_PASSWORD_FILE set, a kept run writes the test administrator's password to that file (owner-only), so a
 * browser check can sign in; it is never printed.
 */
import { writeFileSync } from 'node:fs';

import { Admin } from './client.mjs';
import { scenarios } from './scenarios.mjs';
import { ADMIN_EMAIL, dropSandbox, prepare, startApi } from './stack.mjs';

const keep = process.argv.includes('--keep');
const report = [];
let api;

function line(status, name, detail = '') {
	report.push({ status, name, detail });
	process.stdout.write(
		`${status === 'pass' ? '✓' : status === 'fail' ? '✗' : '·'} ${name}${detail ? ` — ${detail}` : ''}\n`,
	);
}

try {
	const password = await prepare();
	const passwordFile = process.env.ACCOUNTS_E2E_PASSWORD_FILE;
	if (keep && passwordFile) writeFileSync(passwordFile, password, { mode: 0o600 });
	api = await startApi();
	const admin = new Admin('owner');
	await admin.signIn(ADMIN_EMAIL, password);
	line('pass', 'Sandbox up and the test administrator signed in');
	for (const scenario of scenarios) {
		try {
			const detail = await scenario.run({
				admin,
				password,
				check: (ok, name, d) => line(ok ? 'pass' : 'fail', name, d),
			});
			line('pass', scenario.name, detail ?? '');
		} catch (error) {
			line('fail', scenario.name, error instanceof Error ? error.message : String(error));
			if (!scenario.optional) break;
		}
	}
} catch (error) {
	line('fail', 'Run stopped', error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
	const out = process.env.ACCOUNTS_E2E_REPORT;
	if (out) writeFileSync(out, JSON.stringify(report, null, 2));
	if (keep) {
		process.stdout.write('Kept: the sandbox API stays up until Ctrl+C.\n');
	} else {
		api?.child.kill('SIGKILL');
		await dropSandbox().catch((error) => line('fail', 'Removing the sandbox', String(error)));
		line('pass', 'Sandbox database and search index removed');
	}
	const failed = report.filter((r) => r.status === 'fail').length;
	process.stdout.write(`\n${report.filter((r) => r.status === 'pass').length} passed, ${failed} failed\n`);
	if (!keep) process.exit(failed ? 1 : 0);
}
