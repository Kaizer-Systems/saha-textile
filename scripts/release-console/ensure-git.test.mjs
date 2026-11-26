import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GIT_MINIMUM, ensureGit, gitInstallCommands } from './ensure-git.mjs';

test('the install commands follow the operating system', () => {
	assert.deepEqual(
		gitInstallCommands('darwin', '', () => true),
		[['brew', ['install', 'git']]],
	);
	assert.deepEqual(
		gitInstallCommands('darwin', '', () => false),
		[['xcode-select', ['--install']]],
	);
	assert.equal(gitInstallCommands('win32')[0][0], 'winget');
	assert.match(gitInstallCommands('linux', 'ID=ubuntu\n').flat(2).join(' '), /ppa:git-core\/ppa/);
	assert.deepEqual(gitInstallCommands('linux', 'ID=debian\n').at(-1), ['sudo', ['apt-get', 'install', '-y', 'git']]);
	assert.deepEqual(gitInstallCommands('linux', 'ID="rocky"\nID_LIKE="rhel centos fedora"\n'), [
		['sudo', ['dnf', 'install', '-y', 'git']],
	]);
	assert.deepEqual(gitInstallCommands('linux', 'ID=alpine\n'), []);
});

test('a current git is left alone; a missing or old one is installed', () => {
	const calls = [];
	const machine = (versions) => (cmd, args) => {
		calls.push([cmd, ...args].join(' '));
		if (cmd === 'git') return { status: 0, stdout: `git version ${versions.shift() ?? '2.56.1'}` };
		return { status: 0, stdout: '' };
	};
	assert.deepEqual(ensureGit({ run: machine(['2.56.1']), platform: 'darwin' }).lines, ['✓ git 2.56.1']);
	calls.length = 0;
	const old = ensureGit({ run: machine(['2.30.0', '2.56.1']), platform: 'darwin' });
	assert.equal(old.ok, true);
	assert.match(old.lines[0], new RegExp(`older than ${GIT_MINIMUM.replace(/\./g, '\\.')}`));
	assert.ok(calls.includes('brew install git'));
	const none = ensureGit({
		run: () => ({ status: 1, error: new Error('ENOENT') }),
		platform: 'linux',
		osRelease: 'ID=alpine\n',
	});
	assert.equal(none.ok, false);
	assert.match(none.lines[0], /install git 2\.40\.0 or newer/);
});
