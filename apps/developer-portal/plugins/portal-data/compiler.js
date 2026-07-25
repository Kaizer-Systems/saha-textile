/* ============================================================================
 * NEXT-GEN-UI · Governed portal-data compiler
 * ----------------------------------------------------------------------------
 * WHAT: one dependency-free build-time compiler for documentation frontmatter,
 * the governed instrument manifest, and the KB-derived Wave-1 datasets.
 * WHY: Mission Control, Gate Console, search, and future instruments must render
 * the same validated truth instead of maintaining parallel facts in components.
 * HOW: docs/_data JSON supplies authored structure; the machine-readable block
 * in project-progress.md supplies live chunk/gate state; this compiler validates
 * source paths, roadmap/gate/catalog alignment, and emits Docusaurus global data.
 * TUNING: extend DATASET_COMPILERS and the manifest schema when a new instrument
 * family lands. Do not weaken an assertion to make stale data build.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');

const PORTAL_TRUTH_START = '<!-- portal-truth:start -->';
const PORTAL_TRUTH_END = '<!-- portal-truth:end -->';
const VALID_CHUNK_STATUSES = new Set(['done', 'partial', 'next', 'planned']);
const VALID_GATE_STATUSES = new Set(['open', 'resolved']);
const VALID_STAGE_KINDS = new Set(['real', 'ghost']);

function normalizeSlashes(value) {
	return value.replace(/\\/g, '/');
}

function stripQuotes(value) {
	const trimmed = value.trim();
	if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseScalar(value) {
	const stripped = stripQuotes(value);
	if (stripped === 'true') return true;
	if (stripped === 'false') return false;
	if (/^\d+$/.test(stripped)) return Number(stripped);
	if (stripped.startsWith('[') && stripped.endsWith(']')) {
		const inner = stripped.slice(1, -1).trim();
		return inner.length === 0 ? [] : inner.split(',').map((item) => stripQuotes(item));
	}
	return stripped;
}

/**
 * Dependency-free parser for the flat frontmatter contract used by this portal.
 * It intentionally supports scalars, inline arrays, and top-level YAML lists;
 * nested arbitrary YAML does not belong in the portal metadata contract.
 */
function parseFrontMatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;

	const data = {};
	let listKey = null;
	for (const line of match[1].split(/\r?\n/)) {
		const listItem = line.match(/^\s+-\s+(.+)\s*$/);
		if (listKey && listItem) {
			data[listKey].push(parseScalar(listItem[1]));
			continue;
		}

		const field = line.match(/^([a-zA-Z0-9_]+):(?:\s*(.*))?$/);
		if (!field) {
			listKey = null;
			continue;
		}

		const [, key, rawValue = ''] = field;
		if (rawValue.trim() === '') {
			data[key] = [];
			listKey = key;
		} else {
			data[key] = parseScalar(rawValue);
			listKey = null;
		}
	}

	return data;
}

function toRoute(relativePath, slug) {
	if (typeof slug === 'string' && slug.length > 0) {
		return normalizeRoute(slug.startsWith('/') ? slug : `/${slug}`);
	}
	const withoutExtension = normalizeSlashes(relativePath).replace(/\.(md|mdx)$/, '');
	return normalizeRoute(`/${withoutExtension.replace(/\/index$/, '')}`);
}

function normalizeRoute(route) {
	const withoutQuery = route.split('?')[0];
	const [pathname, hash] = withoutQuery.split('#');
	let normalized = pathname || '/';
	normalized = normalized.replace(/\.(md|mdx|html)$/, '');
	if (!normalized.startsWith('/')) normalized = `/${normalized}`;
	normalized = path.posix.normalize(normalized);
	if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
	return hash ? `${normalized}#${hash}` : normalized;
}

function walkDocumentation(directory, baseDirectory, output) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('_')) continue;
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			walkDocumentation(absolutePath, baseDirectory, output);
		} else if (/\.(md|mdx)$/.test(entry.name)) {
			output.push({
				absolutePath,
				relativePath: normalizeSlashes(path.relative(baseDirectory, absolutePath)),
			});
		}
	}
}

function collectDocumentationPages(repositoryRoot) {
	const documentationRoot = path.join(repositoryRoot, 'docs');
	const files = [];
	walkDocumentation(documentationRoot, documentationRoot, files);

	return files.map((file) => {
		const raw = fs.readFileSync(file.absolutePath, 'utf8');
		const frontMatter = parseFrontMatter(raw);
		return {
			...file,
			repositoryPath: normalizeSlashes(path.relative(repositoryRoot, file.absolutePath)),
			raw,
			frontMatter,
			route: toRoute(file.relativePath, frontMatter?.slug),
		};
	});
}

function readJson(repositoryRoot, repositoryPath, failures) {
	const absolutePath = path.join(repositoryRoot, repositoryPath);
	try {
		return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
	} catch (error) {
		failures.push(`${repositoryPath} is not valid JSON: ${error.message}`);
		return {};
	}
}

function requireString(value, label, failures) {
	if (typeof value !== 'string' || value.trim() === '') {
		failures.push(`${label} must be a non-empty string.`);
		return '';
	}
	return value;
}

function requireStringArray(value, label, failures) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
		failures.push(`${label} must be an array of non-empty strings.`);
		return [];
	}
	return value;
}

function requireUniqueIds(items, label, failures) {
	if (!Array.isArray(items)) {
		failures.push(`${label} must be an array.`);
		return;
	}
	const seen = new Set();
	for (const item of items) {
		const id = typeof item?.id === 'number' || typeof item?.id === 'string' ? String(item.id) : '';
		if (!id) {
			failures.push(`${label} contains an item without an id.`);
		} else if (seen.has(id)) {
			failures.push(`${label} contains duplicate id ${id}.`);
		}
		seen.add(id);
	}
}

function validateSources(repositoryRoot, sources, label, failures) {
	for (const source of requireStringArray(sources, `${label}.sourceOfTruth`, failures)) {
		if (!fs.existsSync(path.join(repositoryRoot, source))) {
			failures.push(`${label} references missing source ${source}.`);
		}
	}
}

function readProjectTruth(repositoryRoot, failures) {
	const progressPath = path.join(repositoryRoot, 'project-context/angular-context/project-progress.md');
	const progress = fs.readFileSync(progressPath, 'utf8');
	const start = progress.indexOf(PORTAL_TRUTH_START);
	const end = progress.indexOf(PORTAL_TRUTH_END);
	if (start === -1 || end === -1 || end <= start) {
		failures.push(`project-progress.md must contain ${PORTAL_TRUTH_START} … ${PORTAL_TRUTH_END}.`);
		return { schemaVersion: 0, lastVerified: '', chunks: {}, gates: {} };
	}

	const block = progress
		.slice(start + PORTAL_TRUTH_START.length, end)
		.replace(/```json|```/g, '')
		.trim();
	try {
		const truth = JSON.parse(block);
		if (truth.schemaVersion !== 1) failures.push('Portal truth block schemaVersion must be 1.');
		requireString(truth.lastVerified, 'Portal truth lastVerified', failures);
		if (!truth.chunks || typeof truth.chunks !== 'object') {
			failures.push('Portal truth must declare chunk statuses.');
		}
		if (!truth.gates || typeof truth.gates !== 'object') {
			failures.push('Portal truth must declare gate statuses.');
		}
		return truth;
	} catch (error) {
		failures.push(`Portal truth block is not valid JSON: ${error.message}`);
		return { schemaVersion: 0, lastVerified: '', chunks: {}, gates: {} };
	}
}

function validateProjectTruth(repositoryRoot, truth, failures) {
	const roadmap = fs.readFileSync(
		path.join(
			repositoryRoot,
			'project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md',
		),
		'utf8',
	);
	const progress = fs.readFileSync(
		path.join(repositoryRoot, 'project-context/angular-context/project-progress.md'),
		'utf8',
	);
	const ownerLog = fs.readFileSync(
		path.join(repositoryRoot, 'project-context/angular-context/owner-decisions-log.md'),
		'utf8',
	);

	const chunkIds = Object.keys(truth.chunks ?? {});
	if (chunkIds.join('') !== 'ABCDEFGHIJ') {
		failures.push('Portal truth chunk keys must be exactly A–J in order.');
	}
	for (const id of chunkIds) {
		if (!VALID_CHUNK_STATUSES.has(truth.chunks[id])) {
			failures.push(`Portal truth Chunk ${id} has invalid status ${truth.chunks[id]}.`);
		}
		if (!roadmap.includes(`### Chunk ${id} —`)) {
			failures.push(`Roadmap is missing the Chunk ${id} heading required by Mission Control.`);
		}
	}

	if (truth.chunks?.A !== 'done' || !progress.includes('[DONE] **Chunk A (roadmap)')) {
		failures.push('Mission Control Chunk A must match the completed Chunk A progress bullet.');
	}
	if (truth.chunks?.B !== 'partial' || !progress.includes('[DONE] **Chunk B Pass 1a')) {
		failures.push('Mission Control Chunk B must be partial while Pass 1a is complete but Chunk B is not.');
	}
	if (
		truth.chunks?.C !== 'partial' ||
		!progress.includes('[DONE] §0b env-sync Pass 1') ||
		!progress.includes('[DONE] §0b Pass 2 (Mongo infra)')
	) {
		failures.push('Mission Control Chunk C must reflect the partial security/env/Mongo implementation.');
	}
	for (const id of ['D', 'E', 'F', 'G', 'H', 'I', 'J']) {
		const completedPattern = new RegExp(`\\[DONE\\][^\\n]{0,80}\\*\\*Chunk ${id}\\b`);
		if (truth.chunks?.[id] === 'planned' && completedPattern.test(progress)) {
			failures.push(`Chunk ${id} has a completed progress entry but Portal truth still says planned.`);
		}
	}

	for (const [gateId, status] of Object.entries(truth.gates ?? {})) {
		if (!VALID_GATE_STATUSES.has(status)) {
			failures.push(`Portal truth ${gateId} has invalid status ${status}.`);
			continue;
		}
		const row = roadmap.split(/\r?\n/).find((line) => line.includes(`**${gateId}**`));
		if (!row) {
			failures.push(`Roadmap gate table is missing ${gateId}.`);
			continue;
		}
		const roadmapResolved = /RESOLVED/i.test(row);
		if ((status === 'resolved') !== roadmapResolved) {
			failures.push(
				`${gateId} is ${status} in Portal truth but the roadmap row is ${
					roadmapResolved ? 'resolved' : 'open'
				}.`,
			);
		}
		if (status === 'resolved' && !ownerLog.includes(`— ${gateId}:`)) {
			failures.push(`${gateId} is resolved but has no matching owner-log decision heading.`);
		}
	}
	const roadmapGateIds = [...roadmap.matchAll(/^\| \*\*(G-[A-Z0-9-]+)\*\*/gm)].map((match) => match[1]);
	for (const gateId of roadmapGateIds) {
		if (!(gateId in (truth.gates ?? {}))) {
			failures.push(`Roadmap gate ${gateId} is missing from the Portal truth snapshot.`);
		}
	}
}

function parseCatalog(catalog) {
	const entries = new Map();
	for (const match of catalog.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)$/gm)) {
		entries.set(Number(match[1]), {
			heading: match[2].replace(/\s+/g, ' ').trim(),
			built: /✅|BUILT/.test(match[3]),
		});
	}
	return entries;
}

function validateManifest(repositoryRoot, manifest, pages, catalog, failures) {
	if (manifest.schemaVersion !== 1) failures.push('Portal manifest schemaVersion must be 1.');
	requireString(manifest.lastVerified, 'Portal manifest lastVerified', failures);
	requireUniqueIds(manifest.instruments, 'Portal manifest instruments', failures);
	const catalogEntries = parseCatalog(catalog);
	if (catalogEntries.size !== 10) {
		failures.push(`Instrument catalog must expose exactly 10 numbered concepts; found ${catalogEntries.size}.`);
	}
	if (!Array.isArray(manifest.instruments) || manifest.instruments.length !== 10) {
		failures.push('Portal manifest must declare exactly 10 instruments.');
		return;
	}

	const routes = new Set(pages.map((page) => page.route));
	for (const instrument of manifest.instruments) {
		const catalogEntry = catalogEntries.get(instrument.id);
		if (!catalogEntry) {
			failures.push(`Portal manifest instrument ${instrument.id} is absent from the locked catalog.`);
			continue;
		}
		if (!catalogEntry.heading.includes(instrument.catalogHeading)) {
			failures.push(
				`Instrument ${instrument.id} heading drift: expected catalog text "${instrument.catalogHeading}".`,
			);
		}
		if (instrument.wave < 1 || instrument.wave > 4) {
			failures.push(`Instrument ${instrument.id} has invalid wave ${instrument.wave}.`);
		}
		const waveLine = catalog.split(/\r?\n/).find((line) => line.startsWith(`- **Wave ${instrument.wave}`));
		if (typeof instrument.waveLabel !== 'string' || !waveLine || !waveLine.includes(instrument.waveLabel)) {
			failures.push(
				`Instrument ${instrument.id} wave ${instrument.wave} does not match the catalog build order.`,
			);
		}
		const expectedStatus = catalogEntry.built ? 'built' : 'locked';
		if (instrument.status !== expectedStatus) {
			failures.push(
				`Instrument ${instrument.id} is ${instrument.status} in the manifest but ${expectedStatus} in the catalog.`,
			);
		}
		if (instrument.status === 'built') {
			if (!instrument.route || !routes.has(normalizeRoute(instrument.route))) {
				failures.push(`Built instrument ${instrument.id} must point to an existing documentation route.`);
			}
			for (const field of ['page', 'component', 'dataset']) {
				if (
					typeof instrument[field] !== 'string' ||
					!fs.existsSync(path.join(repositoryRoot, instrument[field]))
				) {
					failures.push(`Built instrument ${instrument.id} has missing ${field}: ${instrument[field]}.`);
				}
			}
		}
	}
}

function compileMissionControl(raw, truth, repositoryRoot, failures) {
	validateSources(repositoryRoot, raw.sourceOfTruth, 'missionControl', failures);
	if (raw.lastVerified !== truth.lastVerified) {
		failures.push('Mission Control lastVerified must match the project-progress Portal truth snapshot.');
	}
	requireUniqueIds(raw.chunks, 'Mission Control chunks', failures);
	requireUniqueIds(raw.gates, 'Mission Control gates', failures);
	const chunks = Array.isArray(raw.chunks) ? raw.chunks : [];
	const gates = Array.isArray(raw.gates) ? raw.gates : [];
	if (chunks.map((chunk) => chunk.id).join('') !== 'ABCDEFGHIJ') {
		failures.push('Mission Control chunks must be exactly A–J in display order.');
	}
	const chunkIds = new Set(chunks.map((chunk) => chunk.id));
	const gateIds = new Set(gates.map((gate) => gate.id));
	for (const chunk of chunks) {
		requireString(chunk.title, `Mission Control Chunk ${chunk.id}.title`, failures);
		requireString(chunk.summary, `Mission Control Chunk ${chunk.id}.summary`, failures);
		requireString(chunk.dod, `Mission Control Chunk ${chunk.id}.dod`, failures);
		for (const dependency of requireStringArray(chunk.deps, `Mission Control Chunk ${chunk.id}.deps`, failures)) {
			if (!chunkIds.has(dependency))
				failures.push(`Chunk ${chunk.id} references unknown dependency ${dependency}.`);
		}
		for (const gateId of requireStringArray(
			chunk.blockingGates,
			`Mission Control Chunk ${chunk.id}.blockingGates`,
			failures,
		)) {
			if (!gateIds.has(gateId)) failures.push(`Chunk ${chunk.id} references unknown gate ${gateId}.`);
		}
		if (!VALID_CHUNK_STATUSES.has(truth.chunks?.[chunk.id])) {
			failures.push(`Chunk ${chunk.id} has no valid status in Portal truth.`);
		}
	}
	for (const gate of gates) {
		if (!VALID_GATE_STATUSES.has(truth.gates?.[gate.id])) {
			failures.push(`${gate.id} has no valid status in Portal truth.`);
		}
	}
	for (const gateId of Object.keys(truth.gates ?? {})) {
		if (!gateIds.has(gateId)) failures.push(`Mission Control is missing ${gateId} from Portal truth.`);
	}
	return {
		lastVerified: raw.lastVerified,
		sourceOfTruth: raw.sourceOfTruth,
		chunks: chunks.map((chunk) => ({ ...chunk, status: truth.chunks[chunk.id] })),
		gates: gates.map((gate) => ({ ...gate, status: truth.gates[gate.id] })),
	};
}

function compileDecisionGates(raw, truth, repositoryRoot, failures) {
	validateSources(repositoryRoot, raw.sourceOfTruth, 'decisionGates', failures);
	if (raw.lastVerified !== truth.lastVerified) {
		failures.push('Decision Gate data lastVerified must match the project-progress Portal truth snapshot.');
	}
	requireUniqueIds(raw.gates, 'Decision gates', failures);
	const gates = Array.isArray(raw.gates) ? raw.gates : [];
	for (const gate of gates) {
		for (const field of ['label', 'question', 'source', 'seamsOk']) {
			requireString(gate[field], `Decision gate ${gate.id}.${field}`, failures);
		}
		requireStringArray(gate.blocksChunks, `Decision gate ${gate.id}.blocksChunks`, failures);
		requireStringArray(gate.blocksCollections, `Decision gate ${gate.id}.blocksCollections`, failures);
		requireStringArray(gate.blocksFeatures, `Decision gate ${gate.id}.blocksFeatures`, failures);
		if (!VALID_GATE_STATUSES.has(truth.gates?.[gate.id])) {
			failures.push(`${gate.id} has no valid status in Portal truth.`);
		}
	}
	const gateIds = new Set(gates.map((gate) => gate.id));
	for (const gateId of Object.keys(truth.gates ?? {})) {
		if (!gateIds.has(gateId)) failures.push(`Decision Gate dataset is missing ${gateId} from Portal truth.`);
	}
	return {
		lastVerified: raw.lastVerified,
		sourceOfTruth: raw.sourceOfTruth,
		impactChunks: Object.keys(truth.chunks ?? {}),
		impactCollections: [...new Set(gates.flatMap((gate) => gate.blocksCollections))],
		gates: gates.map((gate) => ({ ...gate, status: truth.gates[gate.id] })),
	};
}

function compileRequestFlight(raw, repositoryRoot, failures) {
	validateSources(repositoryRoot, raw.sourceOfTruth, 'requestFlight', failures);
	requireString(raw.lastVerified, 'requestFlight.lastVerified', failures);
	requireString(raw.method, 'requestFlight.method', failures);
	requireString(raw.path, 'requestFlight.path', failures);
	requireString(raw.title, 'requestFlight.title', failures);
	requireString(raw.summary, 'requestFlight.summary', failures);
	requireUniqueIds(raw.stages, 'Request Flight stages', failures);
	for (const stage of Array.isArray(raw.stages) ? raw.stages : []) {
		for (const field of ['label', 'sublabel', 'file', 'current', 'target']) {
			requireString(stage[field], `Request Flight ${stage.id}.${field}`, failures);
		}
		if (!VALID_STAGE_KINDS.has(stage.kind)) {
			failures.push(`Request Flight ${stage.id} has invalid kind ${stage.kind}.`);
		}
		if (stage.kind === 'ghost') {
			requireString(stage.chunk, `Request Flight ${stage.id}.chunk`, failures);
			if (!stage.file.startsWith('planned —')) {
				failures.push(`Ghost Request Flight stage ${stage.id} must label its file as planned.`);
			}
		} else if (!fs.existsSync(path.join(repositoryRoot, stage.file))) {
			failures.push(`Real Request Flight stage ${stage.id} references missing evidence ${stage.file}.`);
		}
	}
	return raw;
}

function validateDatasetPages(manifest, pages, compiled, failures) {
	const pageByPath = new Map(pages.map((page) => [page.repositoryPath, page]));
	for (const [datasetKey, binding] of Object.entries(manifest.datasets ?? {})) {
		const page = pageByPath.get(binding.page);
		if (!page) {
			failures.push(`${datasetKey} is bound to missing page ${binding.page}.`);
			continue;
		}
		if (!compiled[datasetKey]) {
			failures.push(`${datasetKey} has no compiled dataset.`);
			continue;
		}
		if (page.frontMatter?.last_verified !== compiled[datasetKey].lastVerified) {
			failures.push(
				`${binding.page} last_verified must equal ${datasetKey}.lastVerified (${compiled[datasetKey].lastVerified}).`,
			);
		}
		if (!Array.isArray(page.frontMatter?.source_of_truth)) {
			failures.push(`${binding.page} must use a source_of_truth list.`);
		} else {
			for (const requiredSource of compiled[datasetKey].sourceOfTruth) {
				if (!page.frontMatter.source_of_truth.includes(requiredSource)) {
					failures.push(`${binding.page} provenance is missing ${requiredSource}.`);
				}
			}
			if (!page.frontMatter.source_of_truth.includes(binding.file)) {
				failures.push(`${binding.page} provenance is missing governed dataset ${binding.file}.`);
			}
			if (!page.frontMatter.source_of_truth.includes('docs/_data/portal-manifest.json')) {
				failures.push(`${binding.page} provenance is missing docs/_data/portal-manifest.json.`);
			}
		}
	}
}

function compilePortalData({ repositoryRoot }) {
	const failures = [];
	const pages = collectDocumentationPages(repositoryRoot);
	const manifestPath = 'docs/_data/portal-manifest.json';
	const manifest = readJson(repositoryRoot, manifestPath, failures);
	const catalogPath = 'project-context/angular-context/developer-portal-interactive-instruments-catalog.md';
	const catalog = fs.readFileSync(path.join(repositoryRoot, catalogPath), 'utf8');
	const truth = readProjectTruth(repositoryRoot, failures);

	validateProjectTruth(repositoryRoot, truth, failures);
	validateManifest(repositoryRoot, manifest, pages, catalog, failures);

	const missionRaw = readJson(
		repositoryRoot,
		manifest.datasets?.missionControl?.file ?? 'docs/_data/instruments/mission-control.json',
		failures,
	);
	const gatesRaw = readJson(
		repositoryRoot,
		manifest.datasets?.decisionGates?.file ?? 'docs/_data/instruments/decision-gates.json',
		failures,
	);
	const flightRaw = readJson(
		repositoryRoot,
		manifest.datasets?.requestFlight?.file ?? 'docs/_data/instruments/request-flight.json',
		failures,
	);

	const compiled = {
		missionControl: compileMissionControl(missionRaw, truth, repositoryRoot, failures),
		decisionGates: compileDecisionGates(gatesRaw, truth, repositoryRoot, failures),
		requestFlight: compileRequestFlight(flightRaw, repositoryRoot, failures),
	};
	validateDatasetPages(manifest, pages, compiled, failures);

	if (manifest.lastVerified !== truth.lastVerified) {
		failures.push('Portal manifest lastVerified must match the project-progress Portal truth snapshot.');
	}
	if (failures.length > 0) {
		throw new Error(`Governed portal-data compilation failed:\n- ${failures.join('\n- ')}`);
	}

	return {
		schemaVersion: manifest.schemaVersion,
		lastVerified: manifest.lastVerified,
		instruments: manifest.instruments,
		...compiled,
	};
}

module.exports = {
	collectDocumentationPages,
	compilePortalData,
	normalizeRoute,
	parseFrontMatter,
};
