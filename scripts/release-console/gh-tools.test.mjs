import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { GH_VERSION, InstallError, checksumFor, ghAsset, installGh, manualInstall, versionOf } from './gh-tools.mjs';

test('picks GitHub’s release file for each operating system and CPU', () => {
	assert.equal(ghAsset('darwin', 'arm64').name, `gh_${GH_VERSION}_macOS_arm64.zip`);
	assert.equal(ghAsset('linux', 'x64').name, `gh_${GH_VERSION}_linux_amd64.tar.gz`);
	assert.equal(ghAsset('linux', 'arm64').name, `gh_${GH_VERSION}_linux_arm64.tar.gz`);
	assert.deepEqual(ghAsset('win32', 'x64'), { name: `gh_${GH_VERSION}_windows_amd64.zip`, binary: 'gh.exe' });
	assert.equal(ghAsset('darwin', 'ia32'), null);
	assert.equal(ghAsset('sunos', 'x64'), null);
	assert.match(manualInstall('win32'), /winget install --id GitHub\.cli/);
	assert.equal(versionOf('gh version 2.105.0 (2026-11-17)'), '2.105.0');
});

test('reads one checksum line', () => {
	const hash = 'a'.repeat(64);
	assert.equal(checksumFor(`${hash}  gh_x.zip\n${'b'.repeat(64)}  other.zip\n`, 'gh_x.zip'), hash);
	assert.equal(checksumFor('nothing', 'gh_x.zip'), null);
});

/** A stand-in GitHub: serves the checksum list and the archive. */
function github(archive, sums) {
	return async (url) => {
		const body = url.endsWith('checksums.txt') ? Buffer.from(sums) : archive;
		return { ok: true, status: 200, arrayBuffer: async () => body };
	};
}

test('installs only an archive that matches GitHub’s checksum', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gh-tools-'));
	try {
		const env = { CONSOLE_TOOLS_DIR: dir };
		const asset = ghAsset('linux', 'x64');
		const archive = Buffer.from('pretend archive');
		const good = `${createHash('sha256').update(archive).digest('hex')}  ${asset.name}\n`;
		const unpack = (_file, out) => {
			mkdirSync(join(out, 'gh_x', 'bin'), { recursive: true });
			writeFileSync(join(out, 'gh_x', 'bin', 'gh'), '#!/bin/sh\necho gh version 2.105.0\n');
		};
		const path = await installGh({ fetch: github(archive, good), env, platform: 'linux', arch: 'x64', unpack });
		assert.equal(path, join(dir, 'gh', GH_VERSION, 'bin', 'gh'));
		assert.match(readFileSync(path, 'utf8'), /gh version/);

		const bad = `${'0'.repeat(64)}  ${asset.name}\n`;
		await assert.rejects(
			installGh({
				fetch: github(archive, bad),
				env: { CONSOLE_TOOLS_DIR: join(dir, 'other') },
				platform: 'linux',
				arch: 'x64',
				unpack,
			}),
			(e) => e instanceof InstallError && /does not match GitHub's checksum/.test(e.message),
		);
		assert.ok(!existsSync(join(dir, 'other', 'gh')), 'nothing kept after a mismatch');
		await assert.rejects(
			installGh({ fetch: github(archive, good), env, platform: 'sunos', arch: 'x64', unpack }),
			/publishes no GitHub CLI/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
