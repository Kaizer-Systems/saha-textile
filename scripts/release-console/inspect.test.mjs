import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMMANDS, InspectError, commandList, factsOf, mongoReport, terminal, topOf } from './inspect.mjs';

test('only saha-textile containers and saha_textile databases are ever named', async () => {
	await assert.rejects(topOf('postgres'), InspectError);
	await assert.rejects(factsOf('saha-textile-x; rm -rf /'), InspectError);
	await assert.rejects(mongoReport('saha-textile-mongo', 'admin'), InspectError);
	await assert.rejects(mongoReport('saha-textile-mongo', 'saha_textile_local"; db.dropDatabase()'), InspectError);
});

test('the terminal runs only its fixed commands', async () => {
	await assert.rejects(terminal('saha-textile-mongo', 'rm -rf /'), InspectError);
	await assert.rejects(terminal('saha-textile-mongo', 'disk-free; reboot'), InspectError);
	assert.ok(commandList().every((c) => c.id in COMMANDS));
	// No command takes text from the caller: each builds its own arguments from the container name only.
	for (const c of Object.values(COMMANDS)) assert.ok(!c.args('saha-textile-x').some((a) => /\$\{|undefined/.test(a)));
	// The environment command prints names, never values.
	assert.match(COMMANDS['env-names'].args('saha-textile-x').join(' '), /cut -d= -f1/);
});
