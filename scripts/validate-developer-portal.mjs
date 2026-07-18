import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const documentationRoot = path.join(repositoryRoot, 'docs');
const portalRoot = path.join(repositoryRoot, 'apps', 'developer-portal');

const allowedStatuses = new Set(['implemented', 'scaffolded', 'planned', 'deferred', 'deprecated']);
const blockedTerms = [['fast', 'kart'].join('')];
const scannedExtensions = new Set(['.css', '.js', '.jsx', '.json', '.md', '.mdx', '.ts', '.tsx']);

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (entry.name === 'build' || entry.name === 'node_modules' || entry.name === '.docusaurus') {
			continue;
		}

		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(absolutePath)));
		} else if (scannedExtensions.has(path.extname(entry.name))) {
			files.push(absolutePath);
		}
	}

	return files;
}

function relativePath(filePath) {
	return path.relative(repositoryRoot, filePath);
}

function readFrontMatter(content) {
	if (!content.startsWith('---\n')) {
		return null;
	}

	const closingMarker = content.indexOf('\n---', 4);
	return closingMarker === -1 ? null : content.slice(4, closingMarker);
}

const documentationFiles = (await listFiles(documentationRoot)).filter((filePath) =>
	['.md', '.mdx'].includes(path.extname(filePath)),
);
const portalFiles = await listFiles(portalRoot);
const failures = [];

for (const filePath of [...documentationFiles, ...portalFiles]) {
	const content = await readFile(filePath, 'utf8');
	const normalizedContent = content.toLocaleLowerCase('en');

	for (const blockedTerm of blockedTerms) {
		if (normalizedContent.includes(blockedTerm)) {
			failures.push(`${relativePath(filePath)} contains a forbidden vendor name.`);
		}
	}
}

for (const filePath of documentationFiles) {
	const content = await readFile(filePath, 'utf8');
	const frontMatter = readFrontMatter(content);
	const displayPath = relativePath(filePath);

	if (!frontMatter) {
		failures.push(`${displayPath} is missing YAML front matter.`);
		continue;
	}

	const status = frontMatter.match(/^status:\s*['"]?([a-z-]+)['"]?\s*$/m)?.[1];
	if (!status || !allowedStatuses.has(status)) {
		failures.push(`${displayPath} must declare one supported status.`);
	}

	if (!/^audience:\s*/m.test(frontMatter)) {
		failures.push(`${displayPath} is missing audience metadata.`);
	}

	if (!/^source_of_truth:\s*/m.test(frontMatter)) {
		failures.push(`${displayPath} is missing source_of_truth metadata.`);
	}

	const verifiedDate = frontMatter.match(/^last_verified:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?\s*$/m)?.[1];
	if (!verifiedDate) {
		failures.push(`${displayPath} must declare last_verified as YYYY-MM-DD.`);
	}
}

if (failures.length > 0) {
	console.error('Developer portal validation failed:\n');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.log(
		`Developer portal validation passed for ${documentationFiles.length} documentation pages and ${portalFiles.length} portal source files.`,
	);
}
