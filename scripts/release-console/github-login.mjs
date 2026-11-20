#!/usr/bin/env node
/**
 * The Release Console's GitHub Connect terminal (owner, 20 Nov; brief QhMFJFyn5Gq1sosZ1AaTQG,
 * approved "as recommended"), run as the helper's fixed "github-login" job on the machine the
 * console runs on: the owner's Mac today, a server once the console is deployed there, on macOS,
 * Linux or Windows. Nothing typed in the console reaches it except the checked repository name.
 *
 *   1 · Tools       git (installed when the console starts); gh: the machine's own, or a pinned
 *                   copy fetched and checked against GitHub's checksums (gh-tools.mjs)
 *   Before gh's and git's first use, an update check (tool-updates.mjs): with an update it asks
 *   "[y/N]" through the Connect terminal (an `{"ask": …}` line, answered on standard input) and
 *   updates on yes; without one it says so and goes on.
 *   2 · Sign in     the saved sign-in when it still answers (unless --mode another), else gh's
 *                   browser sign-in: a one-time code entered at github.com/login/device
 *   3 · Git         `gh auth setup-git`, so Git uses the same sign-in and never asks for a token
 *   4 · Repository  whether the signed-in account can open owner/name
 *
 *   node scripts/release-console/github-login.mjs --repository owner/name [--mode login|another]
 *
 * Exit 0 once signed in (step 4 reports the repository either way); 1 when it stopped earlier.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { GH_VERSION, InstallError, findGh, installGh, manualInstall, versionOf } from './gh-tools.mjs';
import { ghUpdate, gitUpdate } from './tool-updates.mjs';

/** @param {string} text */
const say = (text) => process.stdout.write(`${text}\n`);
/** @param {string} text */
const warn = (text) => process.stderr.write(`${text}\n`);

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
export const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * @param {string} gh
 * @returns {(args: string[]) => { status: number | null, stdout: string, stderr: string, error?: Error }}
 */
const runner = (gh) => (args) => spawnSync(gh, args, { encoding: 'utf8', timeout: 30_000 });

/** The account the saved sign-in answers as, or null when there is none or it no longer works. */
export function signedInAs(run) {
	if (run(['auth', 'status', '--hostname', 'github.com']).status !== 0) return null;
	const who = run(['api', 'user', '--jq', '.login']);
	return who.status === 0 ? who.stdout.trim() || null : null;
}

/** gh's sign-in failure in plain words, from what it printed. */
export function whyLoginFailed(output) {
	if (/expired/i.test(output)) return 'The one-time code expired. Press Try again for a new one.';
	if (/access[_ ]denied|denied/i.test(output)) return 'Access was denied on GitHub. Press Try again to start over.';
	if (/could not resolve|no such host|network|timeout|connection refused/i.test(output))
		return 'github.com could not be reached. Check the network, then press Try again.';
	return 'The GitHub sign-in did not finish. Press Try again.';
}

/** Whether the account can open the repository, in one line (single sign-on named when GitHub says so). */
export function repositoryLine(account, repository, result) {
	const name = result.stdout?.trim() ?? '';
	if (result.status === 0 && name) {
		return name.toLowerCase() === repository.toLowerCase()
			? { ok: true, text: `✓ ${account} can open ${name}.` }
			: { ok: true, text: `✓ ${account} can open it; GitHub now calls it ${name}.` };
	}
	const said = `${result.stderr ?? ''}`;
	if (/SAML|single sign-on|SSO/i.test(said))
		return {
			ok: false,
			text: `✗ ${repository.split('/')[0]} uses single sign-on: authorise this sign-in for the organisation on github.com, then press Check again.`,
		};
	return { ok: false, text: `✗ ${account} cannot open ${repository}. Ask for access, or use another account.` };
}

/** Answers typed in the Connect terminal arrive on standard input, one per line; read only once asked. */
let reader = null;
function answers() {
	if (!reader) {
		/** @type {((line: string) => void)[]} */
		const waiting = [];
		let closed = false;
		const lines = createInterface({ input: process.stdin });
		lines.on('line', (line) => waiting.shift()?.(line));
		lines.on('close', () => {
			closed = true;
			for (const w of waiting.splice(0)) w('');
		});
		reader = {
			next: () => new Promise((resolve) => (closed ? resolve('') : waiting.push(resolve))),
			close: () => lines.close(),
		};
	}
	return reader.next();
}
/** Lets the process end: an open reader on standard input would keep it waiting. */
function closeAnswers() {
	reader?.close();
	reader = null;
}

/**
 * Asks a yes/no question through the Connect terminal and waits for the answer. Anything but y or
 * yes, an empty line included, is no.
 * @param {string} id
 * @param {string} question
 */
export async function ask(id, question, next = answers, out = process.stdout) {
	out.write(`${JSON.stringify({ ask: id, question })}\n`);
	const yes = /^y(es)?$/i.test((await next()).trim());
	out.write(`${JSON.stringify({ answered: id, yes })}\n`);
	out.write(`${question} ${yes ? 'y' : 'n'}\n`);
	return yes;
}

/**
 * The update check before a tool's first use: two lines when there is nothing to update, a
 * question when there is, then the update or the reason it cannot run here.
 * @param {import('./tool-updates.mjs').Update} u
 */
export async function updateStep(u, question = ask) {
	say(`Checking for ${u.tool} updates…`);
	if (!u.available) {
		say(
			u.latest || !u.note
				? `✓ No ${u.tool} update available (${u.current}).`
				: `! ${u.note} Continuing with ${u.tool} ${u.current}.`,
		);
		return false;
	}
	const yes = await question(`update-${u.tool}`, `Update ${u.tool} ${u.current} → ${u.latest}? [y/N]`);
	if (!yes) {
		say(`- Continuing with ${u.tool} ${u.current}.`);
		return false;
	}
	if (!u.apply) {
		say(`! ${u.note || 'The console cannot update it here.'} Continuing with ${u.tool} ${u.current}.`);
		return false;
	}
	say(`Updating ${u.tool}…`);
	const result = await u.apply();
	say(result.ok ? `✓ ${result.text}` : `! ${result.text} Continuing with ${u.tool} ${u.current}.`);
	return result.ok;
}

/** Parses --repository and --mode; refuses anything else. */
export function argsOf(argv) {
	const at = (flag) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? (argv[i + 1] ?? '') : '';
	};
	const repository = at('--repository');
	const mode = at('--mode') || 'login';
	if (!REPOSITORY.test(repository)) throw new Error('Give the repository as owner/name.');
	if (mode !== 'login' && mode !== 'another') throw new Error('Mode is login or another.');
	return { repository, mode };
}

export async function main(argv = process.argv) {
	let stopping = false;
	/** @type {import('node:child_process').ChildProcess | null} */
	let child = null;
	const stop = (signal) => {
		stopping = true;
		child?.kill(signal);
	};
	process.on('SIGTERM', () => stop('SIGTERM'));
	process.on('SIGINT', () => stop('SIGINT'));

	const { repository, mode } = argsOf(argv);

	say('1 · Tools');
	const git = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000 });
	const gitVersion = !git.error && git.status === 0 ? versionOf(git.stdout) : null;
	say(
		gitVersion
			? `✓ git ${gitVersion}`
			: '! git not found: the console installs it when it starts. Step 3 is skipped.',
	);
	let gh = findGh();
	if (!gh) {
		say(`! gh not found on this machine. Installing GitHub CLI ${GH_VERSION}…`);
		try {
			// An install runs to the end even if the terminal closes; it stops after it.
			gh = await installGh({ say });
		} catch (error) {
			warn(`✗ ${error instanceof InstallError ? error.message : 'The download failed.'}`);
			warn(`  Install it by hand instead: ${manualInstall()}`);
			process.exitCode = 1;
			return;
		}
		if (stopping) {
			say('Installed. Stopped before signing in.');
			process.exitCode = 1;
			return;
		}
	}
	say(`✓ gh ${versionOf(runner(gh)(['--version']).stdout) ?? ''}`.trimEnd());

	// gh's first use is the sign-in: check for an update first.
	if (await updateStep(await ghUpdate({ gh }))) gh = findGh() ?? gh;
	if (stopping) return void (process.exitCode = 1);
	const run = runner(gh);

	say('2 · Sign in');
	let account = signedInAs(run);
	if (account && mode === 'login') say(`✓ Already signed in to GitHub as ${account}.`);
	else {
		say(
			mode === 'another'
				? 'Signing in another GitHub account: enter the one-time code below at github.com/login/device.'
				: 'Enter the one-time code below at github.com/login/device.',
		);
		const done = await new Promise((resolve) => {
			let output = '';
			child = spawn(gh, LOGIN_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });
			const relay = (write) => (chunk) => {
				output += String(chunk);
				write(String(chunk));
			};
			child.stdout?.on(
				'data',
				relay((t) => process.stdout.write(t)),
			);
			child.stderr?.on(
				'data',
				relay((t) => process.stderr.write(t)),
			);
			child.on('error', () => resolve({ status: 1, output: 'gh could not start' }));
			child.on('close', (status) => resolve({ status, output }));
		});
		child = null;
		if (done.status !== 0 || stopping) {
			warn(`✗ ${stopping ? 'Stopped.' : whyLoginFailed(done.output)}`);
			process.exitCode = 1;
			return;
		}
		account = signedInAs(run) ?? 'your account';
		say(`✓ Signed in to GitHub as ${account}.`);
	}

	say('3 · Git uses this sign-in');
	if (!gitVersion) say('- skipped: git is not installed.');
	else {
		// git's first use: check for an update first.
		await updateStep(await gitUpdate());
		if (stopping) return void (process.exitCode = 1);
		const setup = run(['auth', 'setup-git', '--hostname', 'github.com']);
		say(
			setup.status === 0
				? '✓ Git on this machine now signs in through gh.'
				: '! gh could not set up Git; Git may still ask for a token.',
		);
	}

	say('4 · Repository');
	say(repositoryLine(account, repository, run(['api', `repos/${repository}`, '--jq', '.full_name'])).text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
		.catch((error) => {
			warn(`✗ ${error.message}`);
			process.exitCode = 1;
		})
		.finally(closeAnswers);
}
