import assert from 'node:assert/strict';
import test from 'node:test';

import { findNameProblems, namesInExample, namesReadByCode, secretFilesCheckedByDeploy } from './names.mjs';

const deployScript = `check_inputs() {
	for name in api.env backup.env mongo-keyfile mongo-app-password \\
		redis-password; do
		[[ -s "$SECRETS/$name" ]] || die
	done
}`;

function agreeing() {
	return {
		inventory: {
			apiVariables: ['PORT', 'MONGODB_PASSWORD', 'REDIS_PASSWORD', 'SHOP_ORIGIN'],
			developmentOnlyApiVariables: ['OTP_LOCAL_FIXED_CODE'],
			composeProvidedApiVariables: ['SHOP_ORIGIN'],
			requiredApiVariablesByCurrentDeploymentValidator: ['PORT', 'MONGODB_PASSWORD', 'REDIS_PASSWORD'],
			infrastructureSecretFileNames: ['mongo-keyfile'],
			derivedSecretFiles: { 'mongo-app-password': 'MONGODB_PASSWORD', 'redis-password': 'REDIS_PASSWORD' },
		},
		exampleNames: namesInExample('PORT=4000\n# OTP_LOCAL_FIXED_CODE=\nMONGODB_PASSWORD=\n# a comment\n'),
		codeNames: namesReadByCode([
			{ path: 'a.ts', text: "env.REDIS_PASSWORD; process.env['SHOP_ORIGIN']; process.env.VITEST" },
		]),
		requiredFile: ['PORT', 'MONGODB_PASSWORD', 'REDIS_PASSWORD'],
		deployFiles: secretFilesCheckedByDeploy(deployScript),
		productionCompose: 'services:\n  api:\n    environment:\n      SHOP_ORIGIN: https://x\n',
	};
}

test('helpers read names from code, the example file and deploy.sh', () => {
	assert.deepEqual([...namesInExample('AA=1\n  # BB=\nnot=a name\nC_D=x')], ['AA', 'BB', 'C_D']);
	const code = namesReadByCode([
		{ path: 'one.ts', text: 'process.env.A_B + env.CC' },
		{ path: 'two.ts', text: 'process.env["A_B"]' },
	]);
	assert.deepEqual(
		[...code],
		[
			['A_B', ['one.ts', 'two.ts']],
			['CC', ['one.ts']],
		],
	);
	assert.deepEqual(
		[...secretFilesCheckedByDeploy(deployScript)],
		['api.env', 'backup.env', 'mongo-keyfile', 'mongo-app-password', 'redis-password'],
	);
	assert.equal(secretFilesCheckedByDeploy('no list here'), null);
});

test('no problems when everything agrees', () => {
	assert.deepEqual(findNameProblems(agreeing()), []);
});

test('a setting the code reads but the inventory lacks fails the check (as SHOP_ORIGIN did)', () => {
	const input = agreeing();
	input.codeNames.set('NEW_SETTING', ['apps/api/src/config/app-config.ts']);
	input.exampleNames.add('DOCUMENTED_ONLY');
	assert.deepEqual(findNameProblems(input), [
		'DOCUMENTED_ONLY is read by apps/api/.env.example but is missing from docker/infisical/variable-names.json. Add it there and to Infisical.',
		'NEW_SETTING is read by apps/api/src/config/app-config.ts but is missing from docker/infisical/variable-names.json. Add it there and to Infisical.',
	]);
});

test('every kind of drift is named', () => {
	const input = agreeing();
	input.inventory.apiVariables.push('STALE_NAME');
	input.inventory.requiredApiVariablesByCurrentDeploymentValidator = ['PORT'];
	input.requiredFile = ['PORT', 'MONGODB_PASSWORD', 'OTP_LOCAL_FIXED_CODE', 'GHOST'];
	input.inventory.composeProvidedApiVariables = ['SHOP_ORIGIN', 'NOT_AN_API_NAME'];
	input.productionCompose = 'services: {}';
	input.inventory.derivedSecretFiles['ghost-file'] = 'GHOST_PASSWORD';
	const problems = findNameProblems(input);
	for (const expected of [
		'STALE_NAME is in docker/infisical/variable-names.json but no code reads it. Remove it there and from Infisical.',
		'requiredApiVariablesByCurrentDeploymentValidator must list exactly the names in docker/production/required-secrets.txt.',
		'GHOST is required by docker/production/required-secrets.txt but missing from the inventory.',
		'OTP_LOCAL_FIXED_CODE is development-only, so a release can never satisfy required-secrets.txt.',
		'NOT_AN_API_NAME is listed as set by Compose but is not an API setting in the inventory.',
		'SHOP_ORIGIN is listed as set by Compose, but docker/production/compose.yaml does not set it.',
		'ghost-file is written from GHOST_PASSWORD, which is not in the inventory.',
		'ghost-file is written from GHOST_PASSWORD, so required-secrets.txt must list GHOST_PASSWORD.',
		'redis-password is written from REDIS_PASSWORD, so required-secrets.txt must list REDIS_PASSWORD.',
		'The secret files deploy.sh checks differ from the inventory (api.env, backup.env, infrastructureSecretFileNames and derivedSecretFiles).',
	]) {
		assert.ok(problems.includes(expected), `missing: ${expected}\n got: ${problems.join('\n')}`);
	}
	input.deployFiles = null;
	assert.ok(findNameProblems(input).some((problem) => problem.startsWith('Could not find the list of secret files')));
});

test('an inventory without the newer optional lists still checks', () => {
	const input = agreeing();
	delete input.inventory.composeProvidedApiVariables;
	delete input.inventory.derivedSecretFiles;
	input.inventory.infrastructureSecretFileNames = ['mongo-keyfile', 'mongo-app-password', 'redis-password'];
	assert.deepEqual(findNameProblems(input), []);
});

test('a setting the release writes itself is known without being an Infisical name, and must be read', () => {
	const input = agreeing();
	input.inventory.releaseWrittenApiVariables = ['RELEASE_ALLOWED_BLANK'];
	input.codeNames.set('RELEASE_ALLOWED_BLANK', ['apps/api/src/config/deployment-hardening.ts']);
	assert.deepEqual(findNameProblems(input), []);

	input.codeNames.delete('RELEASE_ALLOWED_BLANK');
	input.inventory.apiVariables.push('RELEASE_ALLOWED_BLANK');
	input.exampleNames.add('RELEASE_ALLOWED_BLANK');
	assert.deepEqual(findNameProblems(input), [
		'RELEASE_ALLOWED_BLANK is written by the release, so it must not also be an Infisical name in apiVariables.',
		'RELEASE_ALLOWED_BLANK is listed as written by the release, but no code reads it. Remove it.',
	]);
});
