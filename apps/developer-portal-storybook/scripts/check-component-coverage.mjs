import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '../..');
const storyRoot = resolve(packageDirectory, 'src');
const applicationRoots = {
	storefront: resolve(repositoryRoot, 'apps/storefront/src/app'),
	admin: resolve(repositoryRoot, 'apps/admin/src/app'),
};
const applicationAliases = {
	'@core/': 'core',
	'@data-access/': 'data-access',
	'@features/': 'features',
	'@layout/': 'layout',
	'@shared/': 'shared',
};

function filesUnder(directory, matcher) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...filesUnder(absolute, matcher));
		} else if (matcher(absolute)) {
			files.push(absolute);
		}
	}
	return files;
}

function sourceImports(file) {
	return [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function existingModuleFile(candidate) {
	for (const path of [candidate, `${candidate}.ts`, resolve(candidate, 'index.ts')]) {
		try {
			if (statSync(path).isFile()) return path;
		} catch {
			// The candidate is not a repository module at this exact path.
		}
	}
	return undefined;
}

function resolveImport(specifier, importer, applicationRoot) {
	if (specifier.startsWith('.')) {
		return existingModuleFile(resolve(dirname(importer), specifier));
	}
	const alias = Object.keys(applicationAliases).find((prefix) => specifier.startsWith(prefix));
	if (!alias) return undefined;
	return existingModuleFile(resolve(applicationRoot, applicationAliases[alias], specifier.slice(alias.length)));
}

function isReusableComponent(applicationRoot, file) {
	const path = relative(applicationRoot, file);
	return path.startsWith('shared/ui/') || path.startsWith('layout/') || path.includes('/widgets/');
}

const storyFiles = filesUnder(storyRoot, (file) => file.endsWith('.stories.ts'));
const failures = [];
const report = [];

for (const [application, applicationRoot] of Object.entries(applicationRoots)) {
	const componentFiles = filesUnder(applicationRoot, (file) => {
		if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) return false;
		return readFileSync(file, 'utf8').includes('@Component(');
	});
	const queue = [...storyFiles];
	const visited = new Set();
	while (queue.length) {
		const file = queue.pop();
		if (!file || visited.has(file)) continue;
		visited.add(file);
		for (const specifier of sourceImports(file)) {
			if (specifier.startsWith('.')) {
				const imported = resolveImport(specifier, file, applicationRoot);
				if (!imported) {
					failures.push(`unresolved import in ${relative(repositoryRoot, file)}: ${specifier}`);
					continue;
				}
				if (!visited.has(imported)) queue.push(imported);
				continue;
			}
			const imported = resolveImport(specifier, file, applicationRoot);
			if (imported && !visited.has(imported)) queue.push(imported);
		}
	}

	const reusableComponents = componentFiles.filter((file) => isReusableComponent(applicationRoot, file));
	const uncovered = reusableComponents.filter((file) => !visited.has(file));
	const reachable = componentFiles.filter((file) => visited.has(file));
	report.push({
		application,
		total: componentFiles.length,
		reusable: reusableComponents.length,
		coveredReusable: reusableComponents.length - uncovered.length,
		reachable: reachable.length,
		uncovered,
	});
	for (const file of uncovered) {
		failures.push(`${application}: ${relative(applicationRoot, file)}`);
	}
}

for (const item of report) {
	process.stdout.write(
		`Storybook ${item.application}: ${item.coveredReusable}/${item.reusable} reusable components accounted for; ` +
			`${item.reachable}/${item.total} application components reached by stories.\n`,
	);
}

if (failures.length) {
	process.stderr.write(
		`Storybook reusable-component coverage is incomplete:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
	);
	process.exitCode = 1;
} else {
	const totalComponents = report.reduce((sum, item) => sum + item.total, 0);
	const reusableComponents = report.reduce((sum, item) => sum + item.reusable, 0);
	process.stdout.write(
		`Storybook coverage gate passed: ${reusableComponents} reusable components classified across ${totalComponents} Angular components.\n`,
	);
}
