import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT } from '../secrets/inventory.mjs';
import { CHECKS, CI_ONLY, PROOF } from './stages.mjs';

/** Every command line in a workflow's `run:` steps, single-line or block, whitespace collapsed. */
function runLines(file) {
	const lines = readFileSync(join(ROOT, '.github/workflows', file), 'utf8').split('\n');
	const commands = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(\s*)(?:- )?run: (.*)$/.exec(lines[index]);
		if (!match) continue;
		if (match[2].trim() !== '|') {
			commands.push(match[2].trim());
			continue;
		}
		const indent = match[1].length;
		while (
			index + 1 < lines.length &&
			(lines[index + 1].trim() === '' || /^\s*/.exec(lines[index + 1])[0].length > indent)
		) {
			index += 1;
			if (lines[index].trim()) commands.push(lines[index].trim());
		}
	}
	return commands.map((command) => command.replace(/\s+/g, ' '));
}

const ci = runLines('ci.yml');
const publish = runLines('publish-images.yml');

test('every check the local pipeline runs is a command CI runs', () => {
	for (const { run } of CHECKS) assert.ok(ci.includes(run), `ci.yml does not run: ${run}`);
	assert.ok(publish.includes(PROOF.run), `publish-images.yml does not run: ${PROOF.run}`);
});

test('every pnpm or bash command CI runs is a local check, or a step only a fresh runner needs', () => {
	const listed = new Set([...CHECKS.map(({ run }) => run), PROOF.run, ...CI_ONLY]);
	for (const command of [...ci, ...publish]) {
		if (!/^(pnpm|bash) /.test(command)) continue;
		assert.ok(listed.has(command), `CI runs "${command}", which scripts/pipeline/stages.mjs does not list`);
	}
});
