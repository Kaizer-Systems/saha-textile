import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseEnvText } from './files.mjs';
import { SecretsError, describeError, loadInventory } from './inventory.mjs';
import {
	BEFORE_INFISICAL,
	DEV_ENV,
	OVERRIDES,
	PREVIOUS,
	describeChange,
	pullDevEnv,
	refreshBeforeDev,
} from './pull.mjs';

// Every made-up value carries this marker, so a test can prove no value reaches a message.
const MARK = 'zz-made-up-';
const inventory = loadInventory();

/** A throwaway repository root with an apps/api folder, removed after `fn`. */
function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), 'secrets-pull-'));
	mkdirSync(join(root, 'apps/api'), { recursive: true });
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function devProject(extra = {}) {
	return new Map(
		Object.entries({
			PORT: '4000',
			MONGODB_PASSWORD: `${MARK}mongo`,
			CSRF_SECRET: `${MARK}csrf with space`,
			MSG91_AUTH_KEY: '',
			...extra,
		}),
	);
}

/** Runs a pull and checks that no value reached what it prints. */
function pull(root, api, options = {}) {
	const result = pullDevEnv({ root, inventory, readApi: () => api, ...options });
	for (const line of result.lines) assert.ok(!line.includes(MARK), `a value leaked into: ${line}`);
	return result;
}

const read = (root, path) => readFileSync(join(root, path), 'utf8');

test('first pull writes apps/api/.env owner-only, and a second one finds it up to date', () => {
	withRoot((root) => {
		const first = pull(root, devProject());
		assert.equal(first.outcome, 'written');
		assert.match(read(root, DEV_ENV), /^# Written by pnpm secrets:pull/);
		assert.equal(statSync(join(root, DEV_ENV)).mode & 0o777, 0o600);
		assert.deepEqual(Object.fromEntries(parseEnvText(read(root, DEV_ENV))), {
			CSRF_SECRET: `${MARK}csrf with space`,
			MONGODB_PASSWORD: `${MARK}mongo`,
			PORT: '4000',
		});
		assert.ok(!existsSync(join(root, PREVIOUS)), 'nothing to keep on a first pull');
		assert.match(first.lines[1], /3 added \(CSRF_SECRET, MONGODB_PASSWORD, PORT\); 0 unchanged/);

		const second = pull(root, devProject());
		assert.equal(second.outcome, 'unchanged');
		assert.match(second.lines[0], /up to date: 3 settings from Infisical saha-textile-dev/);
	});
});

test('a changed value is written, the previous copy kept, and only names are reported', () => {
	withRoot((root) => {
		pull(root, devProject());
		const before = read(root, DEV_ENV);
		const result = pull(root, devProject({ MONGODB_PASSWORD: `${MARK}rotated`, PORT: '', REDIS_PORT: '6380' }));
		assert.equal(result.outcome, 'written');
		assert.equal(read(root, PREVIOUS), before);
		assert.equal(statSync(join(root, PREVIOUS)).mode & 0o777, 0o600);
		assert.equal(
			result.lines[1],
			'  1 added (REDIS_PORT); 1 removed (PORT); 1 changed (MONGODB_PASSWORD); 1 unchanged.',
		);
		assert.equal(parseEnvText(read(root, DEV_ENV)).get('MONGODB_PASSWORD'), `${MARK}rotated`);
	});
});

test('overrides are laid on top, and an empty override removes a setting', () => {
	withRoot((root) => {
		writeFileSync(join(root, OVERRIDES), `PORT=4100\nCSRF_SECRET=\n# a comment\n`);
		const result = pull(root, devProject());
		const values = parseEnvText(read(root, DEV_ENV));
		assert.equal(values.get('PORT'), '4100');
		assert.equal(values.has('CSRF_SECRET'), false);
		assert.ok(result.lines.includes(`  2 settings from ${OVERRIDES} laid on top.`));
	});
});

test('a hand-written file is left alone before pnpm dev', () => {
	withRoot((root) => {
		writeFileSync(join(root, DEV_ENV), `PORT=4000\n`);
		const result = pull(root, devProject(), { auto: true });
		assert.equal(result.outcome, 'kept');
		assert.match(result.lines[0], /still the hand-written copy/);
		assert.equal(read(root, DEV_ENV), 'PORT=4000\n');
	});
});

test('switching a hand-written file stops on settings Infisical lacks, until --replace', () => {
	withRoot((root) => {
		const handWritten = `PORT=4000\nMSG91_AUTH_KEY=${MARK}msg91\nSPACES_KEY=${MARK}spaces\n`;
		writeFileSync(join(root, DEV_ENV), handWritten);

		const refused = pull(root, devProject());
		assert.equal(refused.outcome, 'kept');
		assert.equal(refused.lines[1], '  MSG91_AUTH_KEY, SPACES_KEY');
		assert.equal(read(root, DEV_ENV), handWritten);

		const dry = pull(root, devProject(), { dryRun: true });
		assert.equal(dry.outcome, 'dry-run');
		assert.match(dry.lines[1], /2 added .*; 2 removed \(MSG91_AUTH_KEY, SPACES_KEY\); 1 unchanged/);
		assert.equal(read(root, DEV_ENV), handWritten);

		const replaced = pull(root, devProject(), { replace: true });
		assert.equal(replaced.outcome, 'written');
		assert.equal(read(root, BEFORE_INFISICAL), handWritten);
		assert.equal(read(root, PREVIOUS), handWritten);
		assert.ok(replaced.lines.includes(`  Your hand-written file is kept as ${BEFORE_INFISICAL}.`));

		// The first hand-written copy is never overwritten by a later switch.
		writeFileSync(join(root, DEV_ENV), 'PORT=1\n');
		pull(root, devProject(), { replace: true });
		assert.equal(read(root, BEFORE_INFISICAL), handWritten);
	});
});

test('a hand-written file whose settings Infisical all has switches without --replace', () => {
	withRoot((root) => {
		writeFileSync(join(root, DEV_ENV), `PORT=4000\nMSG91_AUTH_KEY=\n`);
		const result = pull(root, devProject());
		assert.equal(result.outcome, 'written');
		assert.equal(read(root, BEFORE_INFISICAL), `PORT=4000\nMSG91_AUTH_KEY=\n`);
	});
});

test('a misspelt name in Infisical stops a pull, and pnpm dev goes on with the last copy', () => {
	withRoot((root) => {
		pull(root, devProject());
		const before = read(root, DEV_ENV);
		const misspelt = devProject({ MONGODB_PASWORD: `${MARK}typo` });
		assert.throws(
			() => pull(root, misspelt),
			(error) => error instanceof SecretsError && /MONGODB_PASWORD/.test(error.message),
		);
		const auto = refreshBeforeDev({ root, inventory, readApi: () => misspelt });
		assert.equal(auto.outcome, 'kept');
		assert.match(auto.lines[0], /^Using the last copy of apps\/api\/.env\. apps\/api\/.env was not written:/);
		assert.ok(!auto.lines[0].includes(MARK));
		assert.equal(read(root, DEV_ENV), before);
	});
});

test('pnpm dev goes on when Infisical cannot be read, or fails in a way we did not expect', () => {
	withRoot((root) => {
		const signedOut = refreshBeforeDev({
			root,
			inventory,
			readApi: () => {
				throw new SecretsError('Infisical could not read /api (exit 1). Sign in with: infisical login.');
			},
		});
		assert.deepEqual(signedOut, {
			outcome: 'kept',
			lines: [
				'Using the last copy of apps/api/.env. Infisical could not read /api (exit 1). Sign in with: infisical login.',
			],
		});
		const odd = refreshBeforeDev({
			root,
			inventory,
			readApi: () => {
				throw new SyntaxError(`Unexpected token in ${MARK}value`);
			},
		});
		assert.equal(odd.lines[0], 'Using the last copy of apps/api/.env. Unexpected failure (SyntaxError).');
	});
});

test('describeChange and describeError say only names and kinds', () => {
	assert.equal(describeChange({ added: [], removed: [], changed: [], same: 4 }), '4 unchanged.');
	const coded = Object.assign(new Error(`${MARK}x`), { code: 'EACCES' });
	assert.equal(describeError(coded), 'Unexpected failure (EACCES).');
	assert.equal(describeError(undefined), 'Unexpected failure (unknown).');
});
