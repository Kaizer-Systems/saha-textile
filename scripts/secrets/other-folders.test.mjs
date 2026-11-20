import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT, SecretsError, loadInventory } from './inventory.mjs';
import { otherFolderProblems } from './names.mjs';
import { formatOtherFolder, otherFolderReport, projectReport } from './render.mjs';

const real = JSON.parse(readFileSync(join(ROOT, 'docker/infisical/variable-names.json'), 'utf8'));

/** loadInventory on a copy of the inventory with other folders replaced. */
function inventoryWith(otherFolders) {
	const root = mkdtempSync(join(tmpdir(), 'other-folders-'));
	try {
		mkdirSync(join(root, 'docker/infisical'), { recursive: true });
		mkdirSync(join(root, 'docker/production'), { recursive: true });
		cpSync(
			join(ROOT, 'docker/production/required-secrets.txt'),
			join(root, 'docker/production/required-secrets.txt'),
		);
		writeFileSync(join(root, 'docker/infisical/variable-names.json'), JSON.stringify({ ...real, otherFolders }));
		return loadInventory(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const group = (extra = {}) => ({
	projects: ['dev'],
	readBy: 'apps/tool/src',
	names: ['TOOL_A', 'TOOL_B', 'TOOL_C'],
	optional: ['TOOL_C'],
	...extra,
});

test('an other folder may not reuse a shop folder, name an unknown project, skip readBy or repeat a name', () => {
	const refused = (otherFolders, message) =>
		assert.throws(
			() => inventoryWith(otherFolders),
			(error) => error instanceof SecretsError && message.test(error.message),
		);
	refused({ api: group() }, /may not reuse the shop's folder \/api/);
	refused({ tool: group({ projects: ['qa'] }) }, /unknown project: qa/);
	refused({ tool: group({ readBy: '' }) }, /needs readBy/);
	refused({ tool: group({ names: ['MONGODB_PASSWORD'], optional: [] }) }, /MONGODB_PASSWORD is listed twice/);
	refused({ tool: group(), other: group() }, /TOOL_A is listed twice/);
	refused({ tool: group({ optional: ['TOOL_Z'] }) }, /optional lists TOOL_Z/);
	assert.deepEqual(inventoryWith(undefined).otherFolders, []);
});

test('status reports filled, missing, blank, optional-blank and unknown names, and a folder it cannot read', () => {
	const [tool] = inventoryWith({ tool: group() }).otherFolders;
	const report = otherFolderReport(
		tool,
		new Map([
			['TOOL_A', 'zz-value'],
			['TOOL_C', ''],
			['TOOL_X', 'zz'],
		]),
	);
	assert.deepEqual(report, {
		folder: 'tool',
		readable: true,
		filled: 2,
		missing: ['TOOL_B'],
		blank: [],
		optionalBlank: ['TOOL_C'],
		unknown: ['TOOL_X'],
	});
	const text = formatOtherFolder(report);
	assert.match(text, /\/tool +2 filled/);
	assert.match(text, /not in Infisical yet: TOOL_B/);
	assert.match(text, /optional, blank: TOOL_C/);
	assert.match(text, /not in the inventory \(misspelt\?\): TOOL_X/);
	assert.ok(!text.includes('zz'), 'no value in the report');
	assert.match(formatOtherFolder(otherFolderReport(tool, new Map([['TOOL_B', '']]))), /blank: TOOL_B/);
	assert.equal(
		formatOtherFolder(otherFolderReport(tool, null)),
		'  /tool            could not be read (not created yet?); its 3 names are in docker/infisical/variable-names.json',
	);
});

test('the names check wants every listed name read in its readBy folder', () => {
	const groups = { tool: { readBy: 'apps/tool/src', names: ['TOOL_A', 'TOOL_B'] } };
	assert.deepEqual(
		otherFolderProblems(groups, { 'apps/tool/src': [{ path: 'a.ts', text: 'env.TOOL_A; TOOL_BB' }] }),
		['TOOL_B is listed for /tool, but nothing in apps/tool/src reads it.'],
	);
	assert.deepEqual(otherFolderProblems(groups, { 'apps/tool/src': [{ path: 'a.ts', text: 'TOOL_A TOOL_B' }] }), []);
	assert.deepEqual(otherFolderProblems(undefined, {}), []);
});

test('dev status leaves out settings the local pipeline sets itself; staging still needs them', () => {
	const inventory = loadInventory();
	const folders = { api: new Map(), backup: new Map(), infrastructure: new Map(), deployment: new Map() };
	const setByPipeline = new Set(['CLIENT_IP_HEADER']);
	assert.equal(
		projectReport(folders, { tier: 'dev', inventory, setByPipeline }).requiredBlank.includes('CLIENT_IP_HEADER'),
		false,
	);
	assert.equal(
		projectReport(folders, { tier: 'staging', inventory, setByPipeline }).requiredBlank.includes(
			'CLIENT_IP_HEADER',
		),
		true,
	);
});
