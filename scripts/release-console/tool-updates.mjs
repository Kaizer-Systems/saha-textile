/**
 * Update checks for the tools Connect runs (owner, 20 Nov: "whenever any of its related commands
 * are supposed to be run, first there will be an update check"). Each check answers what is
 * installed, what the machine could move to, and how to move there, by whatever installed it:
 *
 *   gh   Homebrew when Homebrew owns it; otherwise the console fetches the newer release into its
 *        own tools folder (checked against GitHub's checksums), which needs no admin rights.
 *   git  Homebrew on macOS; apt on Debian and Ubuntu (directly only when the helper runs as root);
 *        winget on Windows. Where an update needs an admin password the console cannot type, the
 *        check says which command to run instead.
 */
import { spawnSync } from 'node:child_process';

import { installGh, latestGhVersion, newer, toolsDir, versionOf } from './gh-tools.mjs';

/** @typedef {(cmd: string, args: string[]) => { status: number | null, stdout: string, stderr?: string, error?: Error }} Run */

/** @type {Run} */
const sys = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000 });
const ok = (r) => !r.error && r.status === 0;

/**
 * @typedef {object} Update
 * @property {string} tool
 * @property {string | null} current
 * @property {string | null} latest     null when it could not be checked
 * @property {boolean} available
 * @property {string} note              why there is no check, or what an update would need
 * @property {(() => Promise<{ ok: boolean, text: string }>) | null} apply   null when the console cannot do it here
 */

/** gh: is a newer release out, and how this machine gets it. */
export async function ghUpdate({
	gh,
	run = sys,
	platform = process.platform,
	latest = latestGhVersion,
	env = process.env,
} = {}) {
	const current = versionOf(run(gh, ['--version']).stdout);
	const newest = await latest();
	const base = { tool: 'gh', current, latest: newest };
	if (!newest || !current)
		return {
			...base,
			available: false,
			note: newest ? '' : 'GitHub could not be asked for the newest release.',
			apply: null,
		};
	if (!newer(newest, current)) return { ...base, available: false, note: '', apply: null };
	const fromTools = gh.startsWith(toolsDir(env));
	const brewOwnsIt = !fromTools && platform !== 'win32' && ok(run('brew', ['list', '--versions', 'gh']));
	return {
		...base,
		available: true,
		note: brewOwnsIt ? 'Homebrew updates it.' : 'The console fetches the new release into its own tools folder.',
		apply: brewOwnsIt
			? async () => {
					const r = run('brew', ['upgrade', 'gh']);
					return {
						ok: ok(r),
						text: ok(r) ? `gh updated to ${newest} with Homebrew.` : 'Homebrew could not update gh.',
					};
				}
			: async () => {
					try {
						await installGh({ version: newest, env });
						return {
							ok: true,
							text: `gh ${newest} is ready in the console's tools folder and is used from now on.`,
						};
					} catch (error) {
						return { ok: false, text: `gh ${newest} could not be fetched: ${error.message}` };
					}
				},
	};
}

/** git: is a newer version available from what installed it, and can the console apply it here. */
export async function gitUpdate({
	run = sys,
	platform = process.platform,
	root = typeof process.getuid === 'function' && process.getuid() === 0,
} = {}) {
	const current = versionOf(run('git', ['--version']).stdout);
	const base = { tool: 'git', current };
	if (!current) return { ...base, latest: null, available: false, note: 'git is not installed here.', apply: null };

	if (platform === 'darwin') {
		if (!ok(run('brew', ['list', '--versions', 'git'])))
			return {
				...base,
				latest: null,
				available: false,
				note: "This git comes with Apple's command line tools; Software Update keeps it current.",
				apply: null,
			};
		const info = run('brew', ['info', '--json=v2', 'git']);
		let latest = null;
		try {
			latest = JSON.parse(info.stdout).formulae?.[0]?.versions?.stable ?? null;
		} catch {
			latest = null;
		}
		const available = !!latest && newer(latest, current);
		return {
			...base,
			latest,
			available,
			note: latest ? '' : 'Homebrew could not be asked for the newest git.',
			apply: available
				? async () => {
						const r = run('brew', ['upgrade', 'git']);
						return {
							ok: ok(r),
							text: ok(r) ? `git updated to ${latest} with Homebrew.` : 'Homebrew could not update git.',
						};
					}
				: null,
		};
	}

	if (platform === 'linux') {
		const policy = run('apt-cache', ['policy', 'git']);
		if (!ok(policy))
			return {
				...base,
				latest: null,
				available: false,
				note: 'This machine has no apt; its package manager keeps git current.',
				apply: null,
			};
		const latest = versionOf(/Candidate:\s*(\S+)/.exec(policy.stdout)?.[1] ?? '');
		const available = !!latest && newer(latest, current);
		return {
			...base,
			latest,
			available,
			note:
				available && !root
					? 'Updating needs an admin password: run sudo apt-get install --only-upgrade git'
					: '',
			apply:
				available && root
					? async () => {
							const r = run('apt-get', ['install', '-y', '--only-upgrade', 'git']);
							return {
								ok: ok(r),
								text: ok(r) ? `git updated to ${latest}.` : 'apt could not update git.',
							};
						}
					: null,
		};
	}

	if (platform === 'win32') {
		const list = run('winget', ['upgrade', '--id', 'Git.Git', '-e', '--accept-source-agreements']);
		const latest = ok(list) ? versionOf(/Git\.Git\s+\S+\s+(\S+)/.exec(list.stdout)?.[1] ?? '') : null;
		const available = !!latest && newer(latest, current);
		return {
			...base,
			latest,
			available,
			note: latest ? '' : 'winget could not be asked for the newest git.',
			apply: available
				? async () => {
						const r = run('winget', [
							'upgrade',
							'--id',
							'Git.Git',
							'-e',
							'--silent',
							'--accept-source-agreements',
							'--accept-package-agreements',
						]);
						return {
							ok: ok(r),
							text: ok(r)
								? `git updated to ${latest} with winget.`
								: 'winget could not update git (it may need an administrator).',
						};
					}
				: null,
		};
	}

	return {
		...base,
		latest: null,
		available: false,
		note: 'No update check for this operating system yet.',
		apply: null,
	};
}
