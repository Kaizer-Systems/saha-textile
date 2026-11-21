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
	projects: ['local'],
	readBy: 'apps/tool/src',
	names: ['TOOL_A', 'TOOL_B', 'TOOL_C'],
	optional: ['TOOL_C'],
	...extra,
});

test('the release-console group is in the inventory: this computer only, read by the console API, five optional names', () => {
	const console = loadInventory().otherFolders.find((candidate) => candidate.folder === 'release-console');
	assert.ok(console);
	assert.deepEqual([...console.tiers], ['local']);
	assert.equal(console.readBy, 'apps/release-console-api/src');
	assert.equal(console.names.length, 12);
	// The API operations keys (Release Console, 21 Nov): optional until each environment's OPS_TOKEN exists.
	assert.deepEqual([...console.optional].sort(), [
		'CONSOLE_OPS_TOKEN_DEV',
		'CONSOLE_OPS_TOKEN_LOCAL',
		'CONSOLE_OPS_TOKEN_PRODUCTION',
		'CONSOLE_OPS_TOKEN_STAGING',
		'GOOGLE_SEARCH_CONSOLE_KEY',
	]);
	assert.deepEqual(console.oneOf, [
		['CONSOLE_DO_READ_TOKEN', 'CONSOLE_DO_WRITE_TOKEN'],
		['CONSOLE_CF_READ_TOKEN', 'CONSOLE_CF_WRITE_TOKEN'],
	]);
});

test('the github-actions group holds the geo refresh key: this computer only, read by the workflows', () => {
	const actions = loadInventory().otherFolders.find((candidate) => candidate.folder === 'github-actions');
	assert.ok(actions);
	assert.deepEqual([...actions.tiers], ['local']);
	assert.equal(actions.readBy, '.github/workflows');
	assert.deepEqual(actions.names, ['DATA_GOV_IN_API_KEY']);
});

test('a name still kept in a shop folder is pointed out, readable folder or not', () => {
	const [tool] = inventoryWith({ tool: group() }).otherFolders;
	const shop = {
		api: new Map([
			['TOOL_A', 'zz'],
			['PORT', '4000'],
		]),
		deployment: new Map(),
	};
	const unread = formatOtherFolder(otherFolderReport(tool, null, shop));
	assert.match(unread, /also still in a shop folder: \/api\/TOOL_A \(delete it there once it is here\)/);
	const read = otherFolderReport(
		tool,
		new Map([
			['TOOL_A', 'zz'],
			['TOOL_B', 'zz'],
		]),
		shop,
	);
	assert.deepEqual(read.alsoIn, ['/api/TOOL_A']);
	assert.ok(!formatOtherFolder(read).includes('zz'));
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
	refused({ tool: group({ oneOf: [['TOOL_A']] }) }, /oneOf needs sets of two names or more/);
	refused(
		{ tool: group({ oneOf: [['TOOL_A', 'TOOL_C']] }) },
		/oneOf lists TOOL_C, which is not one of its names, is optional/,
	);
	refused({ tool: group({ oneOf: [['TOOL_A', 'TOOL_Z']] }) }, /oneOf lists TOOL_Z/);
	refused(
		{
			tool: group({
				names: ['TOOL_A', 'TOOL_B', 'TOOL_C', 'TOOL_D'],
				oneOf: [
					['TOOL_A', 'TOOL_B'],
					['TOOL_B', 'TOOL_D'],
				],
			}),
		},
		/oneOf lists TOOL_B/,
	);
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
		needOneOf: [],
		optionalBlank: ['TOOL_C'],
		unknown: ['TOOL_X'],
		alsoIn: [],
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

test('a oneOf set is met by any one filled name; an unmet set is reported, a met one makes the rest optional', () => {
	const [tool] = inventoryWith({
		tool: group({
			names: ['TOOL_A', 'TOOL_READ', 'TOOL_CHANGE', 'X_READ', 'X_CHANGE'],
			optional: [],
			oneOf: [
				['TOOL_READ', 'TOOL_CHANGE'],
				['X_READ', 'X_CHANGE'],
			],
		}),
	}).otherFolders;
	const report = otherFolderReport(
		tool,
		new Map([
			['TOOL_A', 'zz'],
			['TOOL_READ', ''],
			['TOOL_CHANGE', 'zz'],
			['X_READ', ''],
			['X_CHANGE', ''],
		]),
	);
	assert.deepEqual(report.missing, []);
	assert.deepEqual(report.needOneOf, [['X_READ', 'X_CHANGE']]);
	assert.deepEqual(report.optionalBlank, ['TOOL_READ']);
	const text = formatOtherFolder(report);
	assert.match(text, /needs one of: X_READ or X_CHANGE/);
	assert.match(text, /optional, blank: TOOL_READ/);
	assert.ok(!text.includes('zz'));
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

test('local status leaves out settings the local pipeline sets itself; staging still needs them', () => {
	const inventory = loadInventory();
	const folders = { api: new Map(), backup: new Map(), infrastructure: new Map(), deployment: new Map() };
	const setByPipeline = new Set(['CLIENT_IP_HEADER']);
	assert.equal(
		projectReport(folders, { tier: 'local', inventory, setByPipeline }).requiredBlank.includes('CLIENT_IP_HEADER'),
		false,
	);
	assert.equal(
		projectReport(folders, { tier: 'staging', inventory, setByPipeline }).requiredBlank.includes(
			'CLIENT_IP_HEADER',
		),
		true,
	);
});
