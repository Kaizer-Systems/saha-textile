/**
 * Git when the Release Console starts (owner, 20 Nov, brief QhMFJFyn5Gq1sosZ1AaTQG, Q3 = A): installed
 * when missing and upgraded when older than GIT_MINIMUM, with the machine's own package manager,
 * in the terminal that runs `pnpm console:up`, where an admin password can be typed. Newer versions
 * above the minimum are offered later, in the Connect terminal's update check. A failure here only
 * warns: the console still starts.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { newer, versionOf } from './gh-tools.mjs';

export const GIT_MINIMUM = '2.40.0';

/** @typedef {(cmd: string, args: string[], opts?: object) => { status: number | null, stdout?: string, error?: Error }} Run */

/** The commands that install or upgrade git here, by operating system and Linux family. */
export function gitInstallCommands(platform = process.platform, osRelease = '', has = (cmd) => true) {
	if (platform === 'darwin') return has('brew') ? [['brew', ['install', 'git']]] : [['xcode-select', ['--install']]];
	if (platform === 'win32') return [['winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget']]];
	if (platform === 'linux') {
		const id = /^ID=(.*)$/m.exec(osRelease)?.[1]?.replace(/"/g, '') ?? '';
		const like = /^ID_LIKE=(.*)$/m.exec(osRelease)?.[1] ?? '';
		if (id === 'ubuntu')
			// Git's own maintained package source keeps Ubuntu's git current.
			return [
				['sudo', ['add-apt-repository', '-y', 'ppa:git-core/ppa']],
				['sudo', ['apt-get', 'update']],
				['sudo', ['apt-get', 'install', '-y', 'git']],
			];
		if (id === 'debian' || /debian/.test(like))
			return [
				['sudo', ['apt-get', 'update']],
				['sudo', ['apt-get', 'install', '-y', 'git']],
			];
		if (/fedora|rhel|centos|rocky|almalinux/.test(`${id} ${like}`))
			return [['sudo', ['dnf', 'install', '-y', 'git']]];
	}
	return [];
}

/**
 * Checks git and installs or upgrades it when needed. Answers what it did, in lines to print.
 * @param {{ run?: Run, platform?: string, osRelease?: string, say?: (line: string) => void }} [io]
 */
export function ensureGit({
	say = () => undefined,
	run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts }),
	platform = process.platform,
	osRelease = (() => {
		try {
			return readFileSync('/etc/os-release', 'utf8');
		} catch {
			return '';
		}
	})(),
} = {}) {
	const current = () => {
		const r = run('git', ['--version']);
		return !r.error && r.status === 0 ? versionOf(r.stdout ?? '') : null;
	};
	/** @type {string[]} */
	const printed = [];
	const note = (line) => {
		printed.push(line);
		say(line);
	};
	const before = current();
	if (before && !newer(GIT_MINIMUM, before)) {
		note(`✓ git ${before}`);
		return { ok: true, lines: printed };
	}
	const has = (cmd) => {
		const r = run(cmd, ['--version']);
		return !r.error && r.status === 0;
	};
	const steps = gitInstallCommands(platform, osRelease, has);
	if (!steps.length) {
		note(
			`! git ${before ?? 'is missing'}: install git ${GIT_MINIMUM} or newer with this machine's package manager.`,
		);
		return { ok: false, lines: printed };
	}
	note(
		before
			? `! git ${before} is older than ${GIT_MINIMUM}: updating it…`
			: '! git is not installed: installing it…',
	);
	for (const [cmd, args] of steps) {
		note(`  ${cmd} ${args.join(' ')}`);
		// Inherits the terminal, so sudo, Homebrew and winget can ask what they need to.
		const r = run(cmd, args, { stdio: 'inherit' });
		if (r.error || r.status !== 0) {
			note('! That did not finish; the console starts anyway. Run it yourself, then pnpm console:up again.');
			return { ok: false, lines: printed };
		}
	}
	const after = current();
	note(after ? `✓ git ${after}` : '! git still does not answer; the console starts anyway.');
	return { ok: !!after, lines: printed };
}
