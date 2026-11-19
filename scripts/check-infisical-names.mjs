#!/usr/bin/env node
/**
 * pnpm check:infisical-names — fails when the API's settings and the Infisical inventory
 * (`docker/infisical/variable-names.json`) disagree. See scripts/secrets/names.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './secrets/inventory.mjs';
import { findNameProblems, namesInExample, namesReadByCode, secretFilesCheckedByDeploy } from './secrets/names.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'apps/api/src', 'packages/*/src'], {
	cwd: ROOT,
	encoding: 'utf8',
});
const sources = listed
	.split('\n')
	.filter((path) => /\.ts$/.test(path) && !/\.(spec|test)\.ts$|\.d\.ts$/.test(path))
	.map((path) => ({ path, text: read(path) }));

const inventory = JSON.parse(read('docker/infisical/variable-names.json'));
const problems = findNameProblems({
	inventory,
	exampleNames: namesInExample(read('apps/api/.env.example')),
	codeNames: namesReadByCode(sources),
	requiredFile: read('docker/production/required-secrets.txt')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#')),
	deployFiles: secretFilesCheckedByDeploy(read('docker/production/bin/deploy.sh')),
	productionCompose: read('docker/production/compose.yaml'),
});

if (problems.length > 0) {
	console.error('Infisical inventory out of step:');
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log(
	`Infisical inventory matches the code: ${inventory.apiVariables.length + inventory.developmentOnlyApiVariables.length} API settings.`,
);
