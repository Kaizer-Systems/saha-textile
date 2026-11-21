/**
 * Keeps the Infisical inventory (`docker/infisical/variable-names.json`) in step with the code, so a
 * new API setting cannot ship without a place in Infisical, and a removed one does not linger there.
 * Runs in `pnpm lint` as `check:infisical-names`.
 */

/** Read by build, test or tool code, never set in a deployment. */
export const TOOL_NAMES = new Map([
	['INIT_CWD', 'set by pnpm for the local photo seed'],
	['SAHA_TEXTILE_DOCUMENTATION_BUILD', 'set by the portal build when it generates the API reference'],
	['VITEST', 'set by Vitest during tests'],
]);

const ENV_READ = /(?:process\.env|\benv)(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g;
const EXAMPLE_LINE = /^\s*#?\s*([A-Z][A-Z0-9_]+)=/;

/**
 * Setting names read by TypeScript source, with the files reading each.
 * @param {Array<{ path: string, text: string }>} files
 */
export function namesReadByCode(files) {
	/** @type {Map<string, string[]>} */
	const names = new Map();
	for (const { path, text } of files) {
		for (const match of text.matchAll(ENV_READ)) {
			const name = match[1] ?? match[2];
			names.set(name, [...(names.get(name) ?? []), path]);
		}
	}
	return names;
}

/**
 * Names documented in `apps/api/.env.example`, commented-out ones included.
 * @param {string} text
 */
export function namesInExample(text) {
	return new Set(
		text
			.split('\n')
			.map((line) => line.match(EXAMPLE_LINE)?.[1])
			.filter(Boolean),
	);
}

/**
 * The certificate files deploy.sh insists on in certs/, read from its `for name in … ; do` list in
 * check_inputs (the one that tests $SAHA_TEXTILE_ROOT/certs).
 * @param {string} deployScript
 */
export function certificateFilesCheckedByDeploy(deployScript) {
	const match = deployScript.match(/for name in ([a-z0-9. -]+); do\s*\n\s*\[\[ -s "\$SAHA_TEXTILE_ROOT\/certs\//);
	return match ? new Set(match[1].split(/\s+/).filter(Boolean)) : null;
}

/**
 * The secret files deploy.sh insists on, read from its `for name in … ; do` list in check_inputs.
 * @param {string} deployScript
 */
export function secretFilesCheckedByDeploy(deployScript) {
	const match = deployScript.match(/for name in (api\.env[\s\S]*?); do/);
	if (!match) return null;
	return new Set(match[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean));
}

/**
 * @param {object} input
 * @param {any} input.inventory                   the parsed variable-names.json
 * @param {Set<string>} input.exampleNames
 * @param {Map<string, string[]>} input.codeNames
 * @param {string[]} input.requiredFile            required-secrets.txt names
 * @param {Set<string> | null} input.deployFiles  secret files deploy.sh checks
 * @param {Set<string> | null} [input.deployCerts]  certificate files deploy.sh checks in certs/
 * @param {string} input.productionCompose
 * @returns {string[]} problems, empty when everything agrees
 */
export function findNameProblems({
	inventory,
	exampleNames,
	codeNames,
	requiredFile,
	deployFiles,
	deployCerts,
	productionCompose,
}) {
	const problems = [];
	const known = new Set([...inventory.apiVariables, ...inventory.developmentOnlyApiVariables]);
	const used = new Set([...exampleNames, ...codeNames.keys()]);
	// Written into api.env by the release itself, never stored in Infisical (RELEASE_ALLOWED_BLANK).
	const releaseWritten = new Set(inventory.releaseWrittenApiVariables ?? []);
	for (const name of [...releaseWritten].sort()) {
		if (known.has(name)) {
			problems.push(
				`${name} is written by the release, so it must not also be an Infisical name in apiVariables.`,
			);
		}
		if (!codeNames.has(name)) {
			problems.push(`${name} is listed as written by the release, but no code reads it. Remove it.`);
		}
	}

	for (const name of [...used].sort()) {
		if (known.has(name) || releaseWritten.has(name) || TOOL_NAMES.has(name)) continue;
		const where = codeNames.get(name)?.[0] ?? 'apps/api/.env.example';
		problems.push(
			`${name} is read by ${where} but is missing from docker/infisical/variable-names.json. Add it there and to Infisical.`,
		);
	}
	for (const name of [...known].sort()) {
		if (!used.has(name)) {
			problems.push(
				`${name} is in docker/infisical/variable-names.json but no code reads it. Remove it there and from Infisical.`,
			);
		}
	}

	const required = [...requiredFile].sort();
	const recorded = [...inventory.requiredApiVariablesByCurrentDeploymentValidator].sort();
	if (required.join() !== recorded.join()) {
		problems.push(
			'requiredApiVariablesByCurrentDeploymentValidator must list exactly the names in docker/production/required-secrets.txt.',
		);
	}
	for (const name of required) {
		if (!known.has(name))
			problems.push(
				`${name} is required by docker/production/required-secrets.txt but missing from the inventory.`,
			);
		if (inventory.developmentOnlyApiVariables.includes(name)) {
			problems.push(`${name} is development-only, so a release can never satisfy required-secrets.txt.`);
		}
	}

	for (const name of inventory.composeProvidedApiVariables ?? []) {
		if (!known.has(name))
			problems.push(`${name} is listed as set by Compose but is not an API setting in the inventory.`);
		if (!new RegExp(`^\\s+${name}:`, 'm').test(productionCompose)) {
			problems.push(`${name} is listed as set by Compose, but docker/production/compose.yaml does not set it.`);
		}
	}
	for (const [file, name] of Object.entries(inventory.derivedSecretFiles ?? {})) {
		if (!known.has(name)) problems.push(`${file} is written from ${name}, which is not in the inventory.`);
		if (!required.includes(name))
			problems.push(`${file} is written from ${name}, so required-secrets.txt must list ${name}.`);
	}

	const expectedFiles = new Set([
		'api.env',
		'backup.env',
		...inventory.infrastructureSecretFileNames,
		...Object.keys(inventory.derivedSecretFiles ?? {}),
	]);
	if (!deployFiles) {
		problems.push('Could not find the list of secret files in docker/production/bin/deploy.sh (check_inputs).');
	} else if ([...expectedFiles].sort().join() !== [...deployFiles].sort().join()) {
		problems.push(
			'The secret files deploy.sh checks differ from the inventory (api.env, backup.env, infrastructureSecretFileNames and derivedSecretFiles).',
		);
	}
	const certs = inventory.certificateFileNames ?? [];
	if (deployCerts !== undefined && certs.length) {
		if (!deployCerts)
			problems.push('Could not find the certificate list in docker/production/bin/deploy.sh (check_inputs).');
		else if ([...certs].sort().join() !== [...deployCerts].sort().join())
			problems.push('The certificate files deploy.sh checks differ from certificateFileNames in the inventory.');
	}
	return problems;
}

/**
 * Folders the shop never reads (variable-names.json `otherFolders`): every listed name must be read
 * somewhere in the code folder the group names as `readBy`, so a renamed or dropped key is caught.
 * @param {Record<string, { readBy: string, names: string[] }>} otherFolders
 * @param {Record<string, { path: string, text: string }[]>} filesByReader  readBy → its source files
 * @returns {string[]}
 */
export function otherFolderProblems(otherFolders, filesByReader) {
	const problems = [];
	for (const [folder, group] of Object.entries(otherFolders ?? {})) {
		const files = filesByReader[group.readBy] ?? [];
		for (const name of group.names ?? []) {
			const word = new RegExp(`\\b${name}\\b`);
			if (!files.some((file) => word.test(file.text))) {
				problems.push(`${name} is listed for /${folder}, but nothing in ${group.readBy} reads it.`);
			}
		}
	}
	return problems;
}
