import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'find-images.sh');
const DIGEST = `sha256:${'a'.repeat(64)}`;

/** Runs find-images.sh with stand-in `git` and `docker` that know only the images in `known`. */
function find(known) {
	const dir = mkdtempSync(join(tmpdir(), 'find-images-'));
	try {
		writeFileSync(join(dir, 'git'), '#!/bin/sh\necho 1234567890abcdef\n');
		writeFileSync(
			join(dir, 'docker'),
			`#!/bin/sh\ncase "$4" in\n${known.map((t) => `  *saha-textile-${t}:tree-1234567890abcdef) echo ${DIGEST} ;;`).join('\n')}\n  *) echo 'not found' >&2; exit 1 ;;\nesac\n`,
		);
		chmodSync(join(dir, 'git'), 0o755);
		chmodSync(join(dir, 'docker'), 0o755);
		const out = join(dir, 'out');
		writeFileSync(out, '');
		const r = spawnSync('bash', [script], {
			encoding: 'utf8',
			env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_REPOSITORY_OWNER: 'Kaizer-Systems', GITHUB_OUTPUT: out },
		});
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, '', 'prints nothing');
		return readFileSync(out, 'utf8');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('finds the four images by tree and pins them by digest', () => {
	const out = find(['api', 'storefront', 'admin', 'ops']);
	assert.match(out, /^api=ghcr\.io\/kaizer-systems\/saha-textile-api@sha256:a{64}$/m);
	assert.match(out, /^ops=ghcr\.io\/kaizer-systems\/saha-textile-ops@sha256:a{64}$/m);
	assert.match(out, /^found=true$/m);
});

test('one missing image means not found', () => {
	assert.match(find(['api', 'storefront', 'admin']), /^found=false$/m);
});
