import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ghUpdate, gitUpdate } from './tool-updates.mjs';

/** A stand-in for the machine: answers commands from `answers` by command and first argument. */
const machine = (answers) => (cmd, args) => answers[`${cmd} ${args[0]}`] ?? { status: 1, stdout: '' };

test('gh: Homebrew updates a Homebrew gh; otherwise the console fetches the new release', async () => {
	const run = machine({
		'gh --version': { status: 0, stdout: 'gh version 2.104.0' },
		'brew list': { status: 0, stdout: 'gh 2.104.0' },
	});
	const viaBrew = await ghUpdate({ gh: 'gh', run, platform: 'darwin', latest: async () => '2.105.0' });
	assert.equal(viaBrew.available, true);
	assert.match(viaBrew.note, /Homebrew/);
	const elsewhere = await ghUpdate({
		gh: 'gh',
		run: machine({ 'gh --version': { status: 0, stdout: 'gh version 2.104.0' } }),
		platform: 'linux',
		latest: async () => '2.105.0',
	});
	assert.match(elsewhere.note, /tools folder/);
	const current = await ghUpdate({ gh: 'gh', run, platform: 'darwin', latest: async () => '2.104.0' });
	assert.equal(current.available, false);
	const offline = await ghUpdate({ gh: 'gh', run, platform: 'darwin', latest: async () => null });
	assert.match(offline.note, /could not be asked/);
});

test('git: Homebrew on macOS, apt on Linux (an admin command unless root), Apple’s git left alone', async () => {
	const brew = await gitUpdate({
		platform: 'darwin',
		run: machine({
			'git --version': { status: 0, stdout: 'git version 2.56.1' },
			'brew list': { status: 0, stdout: 'git 2.56.1' },
			'brew info': { status: 0, stdout: JSON.stringify({ formulae: [{ versions: { stable: '2.57.0' } }] }) },
		}),
	});
	assert.equal(brew.available, true);
	assert.ok(brew.apply);
	const apple = await gitUpdate({
		platform: 'darwin',
		run: machine({ 'git --version': { status: 0, stdout: 'git version 2.39.5 (Apple Git-154)' } }),
	});
	assert.equal(apple.available, false);
	assert.match(apple.note, /Apple/);
	const aptRun = machine({
		'git --version': { status: 0, stdout: 'git version 2.43.0' },
		'apt-cache policy': {
			status: 0,
			stdout: 'git:\n  Installed: 1:2.43.0-1ubuntu7\n  Candidate: 1:2.43.5-1ubuntu1\n',
		},
	});
	const user = await gitUpdate({ platform: 'linux', run: aptRun, root: false });
	assert.equal(user.available, true);
	assert.equal(user.apply, null);
	assert.match(user.note, /sudo apt-get install --only-upgrade git/);
	const asRoot = await gitUpdate({ platform: 'linux', run: aptRun, root: true });
	assert.ok(asRoot.apply);
	const missing = await gitUpdate({ platform: 'linux', run: machine({}) });
	assert.match(missing.note, /not installed/);
});
