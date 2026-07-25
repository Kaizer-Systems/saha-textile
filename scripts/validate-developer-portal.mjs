import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const documentationRoot = path.join(repositoryRoot, 'docs');
const portalRoot = path.join(repositoryRoot, 'apps', 'developer-portal');
const require = createRequire(import.meta.url);
const {
	collectDocumentationPages,
	compilePortalData,
	normalizeRoute,
} = require('../apps/developer-portal/plugins/portal-data/compiler');

const allowedStatuses = new Set(['implemented', 'scaffolded', 'planned', 'deferred', 'deprecated']);
const blockedTerms = [['fast', 'kart'].join('')];
const scannedExtensions = new Set(['.css', '.js', '.jsx', '.json', '.md', '.mdx', '.ts', '.tsx']);
const today = new Date().toISOString().slice(0, 10);

function gitOutput(arguments_) {
	try {
		return execFileSync('git', arguments_, {
			cwd: repositoryRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return '';
	}
}

const workingTreePaths = new Set(
	[
		gitOutput(['diff', '--name-only']),
		gitOutput(['diff', '--cached', '--name-only']),
		gitOutput(['ls-files', '--others', '--exclude-standard']),
	]
		.filter(Boolean)
		.flatMap((output) => output.split(/\r?\n/))
		.map((filePath) => filePath.replace(/\\/g, '/')),
);
const isGitRepository = gitOutput(['rev-parse', '--is-inside-work-tree']) === 'true';
const evidenceDateCache = new Map();

function latestEvidenceDate(source) {
	if (evidenceDateCache.has(source)) return evidenceDateCache.get(source);
	const normalizedSource = source.replace(/\\/g, '/').replace(/\/+$/, '');
	const hasWorkingChange = [...workingTreePaths].some(
		(filePath) => filePath === normalizedSource || filePath.startsWith(`${normalizedSource}/`),
	);
	const committedDate = gitOutput(['log', '-1', '--format=%cs', '--', normalizedSource]);
	const latest = hasWorkingChange ? today : committedDate || null;
	evidenceDateCache.set(source, latest);
	return latest;
}

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
	return path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
}

function stripCodeFences(content) {
	return content.replace(/```[\s\S]*?```/g, '');
}

function headingAnchor(text) {
	return text
		.toLocaleLowerCase('en')
		.replace(/<[^>]+>/g, '')
		.replace(/[`*_~[\](){}:;,.!?'"“”‘’]/g, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

function collectAnchors(content) {
	const anchors = new Set();
	for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const anchor = headingAnchor(match[1]);
		if (anchor) anchors.add(anchor);
	}
	for (const match of content.matchAll(/\bid=["']([^"']+)["']/g)) {
		anchors.add(match[1]);
	}
	return anchors;
}

function extractInternalLinks(content) {
	const withoutCode = stripCodeFences(content);
	const links = [];
	for (const match of withoutCode.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
		links.push(match[1]);
	}
	for (const match of withoutCode.matchAll(/\b(?:href|to)=["']([^"']+)["']/g)) {
		links.push(match[1]);
	}
	return links.filter(
		(link) =>
			link &&
			!link.startsWith('#') &&
			!link.startsWith('http://') &&
			!link.startsWith('https://') &&
			!link.startsWith('mailto:') &&
			!link.startsWith('tel:') &&
			!link.startsWith('{'),
	);
}

function resolveDocumentationLink(pageRoute, link) {
	if (link.startsWith('/')) return normalizeRoute(link);
	const [relativeTarget, hash] = link.split('#');
	const baseDirectory = path.posix.dirname(pageRoute);
	const route = normalizeRoute(path.posix.join(baseDirectory, relativeTarget || '.'));
	return hash ? `${route}#${hash}` : route;
}

const pages = collectDocumentationPages(repositoryRoot);
const documentationFiles = pages.map((page) => page.absolutePath);
const portalFiles = await listFiles(portalRoot);
const failures = [];

if (!isGitRepository) {
	failures.push('Provenance freshness requires this validator to run inside the Git repository.');
}

try {
	compilePortalData({ repositoryRoot });
} catch (error) {
	failures.push(error instanceof Error ? error.message : String(error));
}

for (const filePath of [...documentationFiles, ...portalFiles]) {
	const content = await readFile(filePath, 'utf8');
	const normalizedContent = content.toLocaleLowerCase('en');

	for (const blockedTerm of blockedTerms) {
		if (normalizedContent.includes(blockedTerm)) {
			failures.push(`${relativePath(filePath)} contains a forbidden vendor name.`);
		}
	}
}

const routeToPage = new Map(pages.map((page) => [page.route, page]));
for (const page of pages) {
	const displayPath = page.repositoryPath;
	const frontMatter = page.frontMatter;
	if (!frontMatter) {
		failures.push(`${displayPath} is missing YAML front matter.`);
		continue;
	}

	if (typeof frontMatter.status !== 'string' || !allowedStatuses.has(frontMatter.status)) {
		failures.push(`${displayPath} must declare one supported status.`);
	}
	if (!Array.isArray(frontMatter.audience) || frontMatter.audience.length === 0) {
		failures.push(`${displayPath} must declare a non-empty audience list.`);
	}
	if (!Array.isArray(frontMatter.source_of_truth) || frontMatter.source_of_truth.length === 0) {
		failures.push(`${displayPath} must declare a non-empty source_of_truth list.`);
	} else {
		const staleSources = [];
		for (const source of frontMatter.source_of_truth) {
			if (typeof source !== 'string' || !existsSync(path.join(repositoryRoot, source))) {
				failures.push(`${displayPath} references missing source_of_truth path ${String(source)}.`);
				continue;
			}
			const evidenceDate = latestEvidenceDate(source);
			if (
				typeof frontMatter.last_verified === 'string' &&
				evidenceDate &&
				frontMatter.last_verified < evidenceDate
			) {
				staleSources.push(`${source} (${evidenceDate})`);
			}
		}
		if (staleSources.length > 0) {
			failures.push(
				`${displayPath} was verified ${frontMatter.last_verified}, before newer evidence: ${staleSources.join(', ')}.`,
			);
		}
	}

	const verifiedDate = typeof frontMatter.last_verified === 'string' ? frontMatter.last_verified : '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)) {
		failures.push(`${displayPath} must declare last_verified as YYYY-MM-DD.`);
	} else if (verifiedDate > today) {
		failures.push(`${displayPath} last_verified cannot be in the future.`);
	}
}

for (const page of pages) {
	for (const link of extractInternalLinks(page.raw)) {
		const target = resolveDocumentationLink(page.route, link);
		const [targetRoute, targetAnchor] = target.split('#');
		const targetPage = routeToPage.get(targetRoute);
		if (!targetPage) {
			failures.push(`${page.repositoryPath} links to missing route ${targetRoute}.`);
			continue;
		}
		if (targetAnchor && !collectAnchors(targetPage.raw).has(targetAnchor)) {
			failures.push(`${page.repositoryPath} links to missing anchor #${targetAnchor} on ${targetRoute}.`);
		}
	}
}

for (const filePath of portalFiles) {
	if (!['.js', '.jsx', '.ts', '.tsx'].includes(path.extname(filePath))) continue;
	const content = await readFile(filePath, 'utf8');
	for (const link of extractInternalLinks(content)) {
		if (!link.startsWith('/')) continue;
		const [targetRoute, targetAnchor] = normalizeRoute(link).split('#');
		const targetPage = routeToPage.get(targetRoute);
		if (!targetPage) {
			failures.push(`${relativePath(filePath)} links to missing route ${targetRoute}.`);
		} else if (
			targetAnchor &&
			!collectAnchors(targetPage.raw).has(targetAnchor) &&
			!collectAnchors(content).has(targetAnchor)
		) {
			failures.push(`${relativePath(filePath)} links to missing anchor #${targetAnchor} on ${targetRoute}.`);
		}
	}
}

if (failures.length > 0) {
	console.error('Developer portal validation failed:\n');
	for (const failure of failures) {
		for (const line of failure.split('\n')) console.error(`- ${line}`);
	}
	process.exitCode = 1;
} else {
	console.log(
		`Developer portal validation passed: ${pages.length} pages, ${routeToPage.size} routes, governed instrument data, provenance freshness, deep links, and ${portalFiles.length} portal source files.`,
	);
}
