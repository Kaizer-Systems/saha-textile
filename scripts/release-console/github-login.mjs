#!/usr/bin/env node
/**
 * The Release Console's GitHub connection on the machine the console runs on (owner, 20 Nov): the
 * owner's Mac today, a server when the console is deployed, on any operating system gh runs on.
 * The console's helper runs this file as its fixed "github-login" job and shows its lines in the
 * Connect terminal; nothing typed in the console reaches it.
 *
 * When gh is signed in and that sign-in still answers, it says so and ends. Otherwise it starts
 * gh's browser sign-in: gh prints a one-time code (and copies it where a clipboard exists), opens
 * github.com/login/device where a browser exists, and waits until the code is approved there,
 * from any device. Exit 0 means connected.
 */
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @param {string[]} args */
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 30_000 });
/** @param {string} text */
const say = (text) => process.stdout.write(`${text}\n`);

export const LOGIN_ARGS = [
	'auth',
	'login',
	'--hostname',
	'github.com',
	'--git-protocol',
	'https',
	'--web',
	'--skip-ssh-key',
];

/** The account the saved sign-in answers as, or null when there is none or it no longer works. */
export function signedInAs(run = gh) {
	if (run(['auth', 'status', '--hostname', 'github.com']).status !== 0) return null;
	const who = run(['api', 'user', '--jq', '.login']);
	return who.status === 0 ? who.stdout.trim() || null : null;
}

export function main() {
	const version = gh(['--version']);
	if (version.error || version.status !== 0) {
		process.stderr.write(
			'The GitHub CLI (gh) is not installed on this machine. Install it from https://cli.github.com, then press Connect again.\n',
		);
		process.exitCode = 1;
		return;
	}
	const account = signedInAs();
	if (account) {
		say(`Already signed in to GitHub as ${account}.`);
		return;
	}
	say('Signing in to GitHub: enter the one-time code below at github.com/login/device.');
	const child = spawn('gh', LOGIN_ARGS, { stdio: ['ignore', 'inherit', 'inherit'] });
	// Closing the Connect terminal stops this job; gh must stop with it, not keep waiting alone.
	for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT'])) process.on(signal, () => child.kill(signal));
	child.on('error', () => {
		process.stderr.write('gh could not start.\n');
		process.exitCode = 1;
	});
	child.on('close', (code) => {
		if (code === 0) say(`Signed in to GitHub as ${signedInAs() ?? 'your account'}.`);
		process.exitCode = code ?? 1;
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
