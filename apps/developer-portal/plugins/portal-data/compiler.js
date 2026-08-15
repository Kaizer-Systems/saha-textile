/* ============================================================================
 * NEXT-GEN-UI · Governed portal-data compiler
 * ----------------------------------------------------------------------------
 * WHAT: one dependency-free build-time compiler for documentation frontmatter,
 * the governed instrument manifest, and the KB-derived instrument datasets.
 * WHY: Mission Control, Gate Console, Schema Nebula, search, and future instruments must render
 * the same validated truth instead of maintaining parallel facts in components.
 * HOW: docs/_data JSON supplies authored structure; the machine-readable block
 * in project-progress.mdx supplies live chunk/gate state; this compiler validates
 * source paths, roadmap/gate/catalog alignment, and emits Docusaurus global data.
 * TUNING: extend DATASET_COMPILERS and the manifest schema when a new instrument
 * family lands. Do not weaken an assertion to make stale data build.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');

const PORTAL_TRUTH_START = '{/* portal-truth:start */}';
const PORTAL_TRUTH_END = '{/* portal-truth:end */}';
const VALID_CHUNK_STATUSES = new Set(['done', 'partial', 'next', 'planned']);
const VALID_GATE_STATUSES = new Set(['open', 'resolved']);
const VALID_STAGE_KINDS = new Set(['real', 'ghost']);
const VALID_SCHEMA_COLLECTION_STATES = new Set(['existing', 'planned']);
const VALID_SCHEMA_TARGET_ACTIONS = new Set(['refactor', 'add']);
const VALID_COMMAND_TARGET_SOURCES = new Set(['journey-pages', 'decision-gates', 'document-status']);
const SCHEMA_NEBULA_ROUTE = '/database/schema-nebula';
const SCHEMA_NEBULA_NODE_COUNT = 65;
const SCHEMA_NEBULA_EXISTING_MODEL_COUNT = 35;
const SCHEMA_NEBULA_GROUPED_MODEL_FILES = new Map([
	['categoryPlacements', 'catalog-structure.model.ts'],
	['categoryFacetConfigs', 'catalog-structure.model.ts'],
	['attributeDefinitions', 'catalog-structure.model.ts'],
	['productVariants', 'product-variant.model.ts'],
	['productBundles', 'merchandising.model.ts'],
	['productRelations', 'merchandising.model.ts'],
	['mediaAssets', 'media.model.ts'],
	['faqEntries', 'content.model.ts'],
	['reviews', 'content.model.ts'],
	['inventoryLedger', 'inventory.model.ts'],
	['inventoryCostLayers', 'inventory.model.ts'],
	['adminUsers', 'admin-user.model.ts'],
	['authSessions', 'auth-session.model.ts'],
	['otpChallenges', 'auth-challenge.model.ts'],
	['oauthStates', 'auth-challenge.model.ts'],
	['passwordResetTokens', 'auth-token.model.ts'],
	['emailVerificationTokens', 'auth-token.model.ts'],
	['adminInvites', 'auth-token.model.ts'],
	['authIdentities', 'credential.model.ts'],
	['passwordCredentials', 'credential.model.ts'],
	['pinCredentials', 'credential.model.ts'],
	['roles', 'rbac.model.ts'],
	['adminUserRoleAssignments', 'rbac.model.ts'],
	['consentEvents', 'consent.model.ts'],
	['auditLogs', 'governance.model.ts'],
	['notificationChannelSettings', 'governance.model.ts'],
	['notificationTemplates', 'governance.model.ts'],
	['messageOutbox', 'governance.model.ts'],
]);
const SCHEMA_NEBULA_NON_TARGET_MODEL_FILES = new Set([
	// The auth architecture explicitly keeps rate-limit storage outside the locked
	// 65-node physical target graph; the adapter may change without inventing a star.
	'auth-rate-limit.model.ts',
]);
const COMMAND_VERBS_ROUTE = '/frontend/portal-experience-layer';
const COMMAND_VERB_ORDER = ['trace', 'gate', 'status'];
const COMMAND_VERB_EXAMPLES = {
	trace: 'trace checkout',
	gate: 'gate numbering',
	status: 'status api',
};
const FIRST_FLIGHT_ROUTE = '/getting-started/first-flight';
const FIRST_FLIGHT_PERSONA_ORDER = ['beginner', 'frontend', 'backend', 'operator'];
const FIRST_FLIGHT_STOP_COUNTS = {
	beginner: 6,
	frontend: 6,
	backend: 7,
	operator: 7,
};
const FIRST_FLIGHT_REQUIRED_IMPLEMENTATION = [
	'apps/developer-portal/src/components/FirstFlight/index.tsx',
	'apps/developer-portal/src/components/FirstFlight/FirstFlightHUD.tsx',
	'apps/developer-portal/src/components/FirstFlight/MissionDebrief.tsx',
	'apps/developer-portal/src/components/FirstFlight/useFirstFlightProgress.ts',
];
const VALID_PORTAL_PAGE_STATUSES = new Set(['implemented', 'scaffolded', 'planned', 'deferred', 'deprecated']);

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

function collectDocumentationAnchors(content) {
	const anchors = new Set();
	for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const anchor = headingAnchor(match[1]);
		if (anchor) anchors.add(anchor);
	}
	for (const match of content.matchAll(/\bid=["']([^"']+)["']/g)) {
		anchors.add(match[1]);
	}
	for (const match of content.matchAll(/\bdata-first-flight-anchor=["']([^"']+)["']/g)) {
		anchors.add(match[1]);
	}
	return anchors;
}

function commandTargetFromPage(page, kind, section) {
	const frontMatter = page.frontMatter ?? {};
	return {
		id: page.route,
		title: frontMatter.title,
		path: page.route,
		kind,
		section,
		status: frontMatter.status,
		keywords: [
			frontMatter.description,
			frontMatter.search_keywords,
			Array.isArray(frontMatter.audience) ? frontMatter.audience.join(' ') : '',
			page.route,
		]
			.filter(Boolean)
			.join(' '),
	};
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

function requireUniqueStringArray(value, label, failures) {
	const items = requireStringArray(value, label, failures);
	if (new Set(items).size !== items.length) {
		failures.push(`${label} must not contain duplicate values.`);
	}
	return items;
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
	const progressPath = path.join(repositoryRoot, 'docs/engineering-live-context/project-progress.mdx');
	const progress = fs.readFileSync(progressPath, 'utf8');
	const start = progress.indexOf(PORTAL_TRUTH_START);
	const end = progress.indexOf(PORTAL_TRUTH_END);
	if (start === -1 || end === -1 || end <= start) {
		failures.push(`project-progress.mdx must contain ${PORTAL_TRUTH_START} … ${PORTAL_TRUTH_END}.`);
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
			'docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx',
		),
		'utf8',
	);
	const progress = fs.readFileSync(
		path.join(repositoryRoot, 'docs/engineering-live-context/project-progress.mdx'),
		'utf8',
	);
	const ownerLog = fs.readFileSync(
		path.join(repositoryRoot, 'docs/engineering-live-context/owner-decisions-log.mdx'),
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
	if (truth.chunks?.B !== 'done' || !progress.includes('[DONE] **Chunk B Pass 4')) {
		failures.push('Mission Control Chunk B must be done when the completed Pass 4 progress evidence is present.');
	}
	if (
		truth.chunks?.C !== 'done' ||
		!progress.includes('[DONE] **Chunk C Pass 1') ||
		!progress.includes('[DONE] **Chunk C Pass 2') ||
		!progress.includes('[DONE] **Chunk C Pass 3') ||
		!progress.includes('[DONE] **Chunk C closed out')
	) {
		failures.push('Mission Control Chunk C must be done only when all three passes and close-out evidence exist.');
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
		if (status === 'resolved' && !ownerLog.includes(gateId)) {
			failures.push(`${gateId} is resolved but has no matching owner-log decision marker.`);
		}
	}
	const roadmapGateIds = [...roadmap.matchAll(/^\| \*\*(G-[A-Z0-9-]+)\*\*/gm)].map((match) => match[1]);
	for (const gateId of roadmapGateIds) {
		if (!(gateId in (truth.gates ?? {}))) {
			failures.push(`Roadmap gate ${gateId} is missing from the Portal truth snapshot.`);
		}
	}
}

function validateManifest(repositoryRoot, manifest, pages, failures) {
	if (manifest.schemaVersion !== 1) failures.push('Portal manifest schemaVersion must be 1.');
	requireString(manifest.lastVerified, 'Portal manifest lastVerified', failures);
	requireUniqueIds(manifest.instruments, 'Portal manifest instruments', failures);
	if (!Array.isArray(manifest.instruments) || manifest.instruments.length !== 10) {
		failures.push('Portal manifest must declare exactly 10 instruments.');
		return;
	}

	const routes = new Set(pages.map((page) => page.route));
	const instrumentKeys = new Set();
	for (const [index, instrument] of manifest.instruments.entries()) {
		if (instrument.id !== index + 1) {
			failures.push(
				`Portal manifest instruments must use ordered ids 1–10; found ${instrument.id} at index ${index}.`,
			);
		}
		const instrumentKey = requireString(instrument.key, `Instrument ${instrument.id}.key`, failures);
		if (instrumentKeys.has(instrumentKey)) {
			failures.push(`Portal manifest contains duplicate instrument key ${instrumentKey}.`);
		}
		instrumentKeys.add(instrumentKey);
		requireString(instrument.catalogHeading, `Instrument ${instrument.id}.catalogHeading`, failures);
		requireString(instrument.waveLabel, `Instrument ${instrument.id}.waveLabel`, failures);
		if (instrument.wave < 1 || instrument.wave > 4) {
			failures.push(`Instrument ${instrument.id} has invalid wave ${instrument.wave}.`);
		}
		if (!['built', 'locked'].includes(instrument.status)) {
			failures.push(`Instrument ${instrument.id} has invalid status ${instrument.status}.`);
		}
		if (instrument.route !== undefined) {
			const route = requireString(instrument.route, `Instrument ${instrument.id}.route`, failures);
			if (!route.startsWith('/')) {
				failures.push(`Instrument ${instrument.id}.route must be root-relative.`);
			}
		}
		for (const field of ['page', 'component', 'dataset']) {
			if (
				instrument[field] !== undefined &&
				(typeof instrument[field] !== 'string' || !fs.existsSync(path.join(repositoryRoot, instrument[field])))
			) {
				failures.push(`Instrument ${instrument.id} has invalid ${field}: ${instrument[field]}.`);
			}
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
	const decisionRegister =
		raw.decisionRegister && typeof raw.decisionRegister === 'object' && !Array.isArray(raw.decisionRegister)
			? raw.decisionRegister
			: {};
	const pendingDecisionPath = path.join(repositoryRoot, 'docs/engineering-live-context/pending-decisions.mdx');
	const ownerLogPath = path.join(repositoryRoot, 'docs/engineering-live-context/owner-decisions-log.mdx');
	const pendingDecisionText = fs.readFileSync(pendingDecisionPath, 'utf8');
	const ownerLogText = fs.readFileSync(ownerLogPath, 'utf8');
	const openDecisionIds = [...new Set(pendingDecisionText.match(/\bDEC-[A-Z0-9-]+\b/g) ?? [])];
	if (decisionRegister.openCount !== openDecisionIds.length) {
		failures.push(
			`Decision Gate register openCount must match pending-decisions (${openDecisionIds.length}); found ${decisionRegister.openCount}.`,
		);
	}
	const newlyLocked = requireUniqueStringArray(
		decisionRegister.newlyLocked,
		'Decision Gate register newlyLocked',
		failures,
	);
	if (newlyLocked.length !== 4) {
		failures.push(
			`Decision Gate register must record exactly four newly locked decisions; found ${newlyLocked.length}.`,
		);
	}
	for (const decisionId of newlyLocked) {
		if (!/^DEC-[A-Z0-9-]+$/.test(decisionId)) {
			failures.push(`Decision Gate register has invalid decision id ${decisionId}.`);
		}
		if (!ownerLogText.includes(decisionId)) {
			failures.push(`Newly locked decision ${decisionId} is absent from the owner decision log.`);
		}
		if (openDecisionIds.includes(decisionId)) {
			failures.push(`Newly locked decision ${decisionId} still appears in pending-decisions.`);
		}
	}
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
		decisionRegister: {
			openCount: decisionRegister.openCount,
			newlyLocked,
		},
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

function collectionIdToModelStem(collectionId) {
	if (collectionId.endsWith('ies')) return `${collectionId.slice(0, -3)}y`;
	if (collectionId.endsWith('s')) return collectionId.slice(0, -1);
	return collectionId;
}

function compileSchemaNebula(raw, truth, repositoryRoot, manifest, failures) {
	if (raw.schemaVersion !== 1) failures.push('Schema Nebula schemaVersion must be 1.');
	const lastVerified = requireString(raw.lastVerified, 'schemaNebula.lastVerified', failures);
	if (lastVerified !== truth.lastVerified) {
		failures.push('Schema Nebula lastVerified must match the project-progress Portal truth snapshot.');
	}
	const route = requireString(raw.route, 'schemaNebula.route', failures);
	if (normalizeRoute(route) !== SCHEMA_NEBULA_ROUTE) {
		failures.push(`Schema Nebula route must remain ${SCHEMA_NEBULA_ROUTE}.`);
	}
	requireString(raw.title, 'schemaNebula.title', failures);
	requireString(raw.summary, 'schemaNebula.summary', failures);

	const sourceOfTruth = requireUniqueStringArray(raw.sourceOfTruth, 'schemaNebula.sourceOfTruth', failures);
	validateSources(repositoryRoot, sourceOfTruth, 'schemaNebula', failures);
	const sourceAliases =
		raw.sourceAliases && typeof raw.sourceAliases === 'object' && !Array.isArray(raw.sourceAliases)
			? raw.sourceAliases
			: {};
	if (Object.keys(sourceAliases).length === 0) {
		failures.push('schemaNebula.sourceAliases must be a non-empty object.');
	}
	for (const [alias, sourcePath] of Object.entries(sourceAliases)) {
		requireString(alias, 'Schema Nebula source alias', failures);
		const validatedPath = requireString(sourcePath, `Schema Nebula sourceAliases.${alias}`, failures);
		if (validatedPath && !fs.existsSync(path.join(repositoryRoot, validatedPath))) {
			failures.push(`Schema Nebula source alias ${alias} references missing source ${validatedPath}.`);
		}
		if (validatedPath && !sourceOfTruth.includes(validatedPath)) {
			failures.push(`Schema Nebula source alias ${alias} is absent from sourceOfTruth.`);
		}
	}

	const inventory =
		raw.inventory && typeof raw.inventory === 'object' && !Array.isArray(raw.inventory) ? raw.inventory : {};
	if (inventory.nodeCount !== SCHEMA_NEBULA_NODE_COUNT) {
		failures.push(`Schema Nebula inventory.nodeCount must remain ${SCHEMA_NEBULA_NODE_COUNT}.`);
	}
	if (inventory.existingModelCount !== SCHEMA_NEBULA_EXISTING_MODEL_COUNT) {
		failures.push(`Schema Nebula inventory.existingModelCount must remain ${SCHEMA_NEBULA_EXISTING_MODEL_COUNT}.`);
	}
	if (inventory.targetOnlyCount !== SCHEMA_NEBULA_NODE_COUNT - SCHEMA_NEBULA_EXISTING_MODEL_COUNT) {
		failures.push(
			`Schema Nebula inventory.targetOnlyCount must remain ${
				SCHEMA_NEBULA_NODE_COUNT - SCHEMA_NEBULA_EXISTING_MODEL_COUNT
			}.`,
		);
	}
	requireString(inventory.countPolicy, 'schemaNebula.inventory.countPolicy', failures);
	requireString(inventory.statusPolicy, 'schemaNebula.inventory.statusPolicy', failures);

	requireUniqueIds(raw.clusters, 'Schema Nebula clusters', failures);
	const clusters = Array.isArray(raw.clusters) ? raw.clusters : [];
	const clusterIds = new Set(clusters.map((cluster) => cluster.id));
	const validChunkIds = new Set(Object.keys(truth.chunks ?? {}));
	for (const cluster of clusters) {
		requireString(cluster.id, 'Schema Nebula cluster.id', failures);
		requireString(cluster.label, `Schema Nebula cluster ${cluster.id}.label`, failures);
		requireString(cluster.summary, `Schema Nebula cluster ${cluster.id}.summary`, failures);
		for (const chunkId of requireUniqueStringArray(
			cluster.owningChunks,
			`Schema Nebula cluster ${cluster.id}.owningChunks`,
			failures,
		)) {
			if (!validChunkIds.has(chunkId)) {
				failures.push(`Schema Nebula cluster ${cluster.id} references unknown Chunk ${chunkId}.`);
			}
		}
	}

	requireUniqueIds(raw.collections, 'Schema Nebula collections', failures);
	const collections = Array.isArray(raw.collections) ? raw.collections : [];
	if (collections.length !== SCHEMA_NEBULA_NODE_COUNT) {
		failures.push(
			`Schema Nebula must contain ${SCHEMA_NEBULA_NODE_COUNT} collection nodes; found ${collections.length}.`,
		);
	}
	const collectionIds = new Set(collections.map((collection) => collection.id));
	const pendingDecisions = fs.readFileSync(
		path.join(repositoryRoot, 'docs/engineering-live-context/pending-decisions.mdx'),
		'utf8',
	);
	const knownDecisionIds = new Set(pendingDecisions.match(/\bDEC-[A-Z0-9-]+\b/g) ?? []);
	const declaredCurrentModels = [];
	const clusterUseCounts = new Map(clusters.map((cluster) => [cluster.id, 0]));

	for (const collection of collections) {
		const collectionId = requireString(collection.id, 'Schema Nebula collection.id', failures);
		if (!/^[a-z][A-Za-z0-9]*$/.test(collectionId)) {
			failures.push(`Schema Nebula collection id ${collectionId} must use lower camelCase.`);
		}
		if (collection.label !== collectionId) {
			failures.push(`Schema Nebula ${collectionId}.label must equal its physical collection name.`);
		}
		if (!clusterIds.has(collection.cluster)) {
			failures.push(`Schema Nebula ${collectionId} references unknown cluster ${collection.cluster}.`);
		} else {
			clusterUseCounts.set(collection.cluster, (clusterUseCounts.get(collection.cluster) ?? 0) + 1);
		}
		if (!VALID_SCHEMA_COLLECTION_STATES.has(collection.currentState)) {
			failures.push(`Schema Nebula ${collectionId} has invalid currentState ${collection.currentState}.`);
		}
		if (!VALID_SCHEMA_TARGET_ACTIONS.has(collection.targetAction)) {
			failures.push(`Schema Nebula ${collectionId} has invalid targetAction ${collection.targetAction}.`);
		}
		requireString(collection.purpose, `Schema Nebula ${collectionId}.purpose`, failures);
		const source = requireString(collection.source, `Schema Nebula ${collectionId}.source`, failures);
		const sourceAlias = source.split(/\s+/)[0];
		if (!sourceAliases[sourceAlias]) {
			failures.push(`Schema Nebula ${collectionId} uses unknown source alias ${sourceAlias}.`);
		}
		for (const chunkId of requireUniqueStringArray(
			collection.owningChunks,
			`Schema Nebula ${collectionId}.owningChunks`,
			failures,
		)) {
			if (!validChunkIds.has(chunkId)) {
				failures.push(`Schema Nebula ${collectionId} references unknown Chunk ${chunkId}.`);
			}
		}
		for (const decisionId of requireUniqueStringArray(
			collection.blockingDecisions,
			`Schema Nebula ${collectionId}.blockingDecisions`,
			failures,
		)) {
			if (!knownDecisionIds.has(decisionId)) {
				failures.push(`Schema Nebula ${collectionId} references unknown decision ${decisionId}.`);
			}
		}
		for (const reference of requireUniqueStringArray(
			collection.references,
			`Schema Nebula ${collectionId}.references`,
			failures,
		)) {
			if (!collectionIds.has(reference)) {
				failures.push(`Schema Nebula ${collectionId} references unknown collection ${reference}.`);
			}
			if (reference === collectionId) {
				failures.push(`Schema Nebula ${collectionId} must not reference itself.`);
			}
		}

		if (collection.currentState === 'existing') {
			if (collection.targetAction !== 'refactor') {
				failures.push(`Existing Schema Nebula node ${collectionId} must use targetAction refactor.`);
			}
			const currentModel = requireString(
				collection.currentModel,
				`Schema Nebula ${collectionId}.currentModel`,
				failures,
			);
			if (currentModel) {
				declaredCurrentModels.push(currentModel);
				if (!fs.existsSync(path.join(repositoryRoot, currentModel))) {
					failures.push(`Schema Nebula ${collectionId} references missing model ${currentModel}.`);
				}
				const expectedModelFile =
					SCHEMA_NEBULA_GROUPED_MODEL_FILES.get(collectionId) ??
					`${collectionIdToModelStem(collectionId)}.model.ts`;
				if (path.posix.basename(normalizeSlashes(currentModel)) !== expectedModelFile) {
					failures.push(
						`Schema Nebula ${collectionId} must map to ${expectedModelFile}, not ${currentModel}.`,
					);
				}
			}
		} else if (collection.currentState === 'planned') {
			if (collection.targetAction !== 'add') {
				failures.push(`Planned Schema Nebula node ${collectionId} must use targetAction add.`);
			}
			if (collection.currentModel !== undefined) {
				failures.push(`Planned Schema Nebula node ${collectionId} must not claim a currentModel.`);
			}
		}
	}

	for (const [clusterId, useCount] of clusterUseCounts) {
		if (useCount === 0) failures.push(`Schema Nebula cluster ${clusterId} contains no collections.`);
	}
	const existingCollections = collections.filter((collection) => collection.currentState === 'existing');
	const plannedCollections = collections.filter((collection) => collection.currentState === 'planned');
	if (existingCollections.length !== SCHEMA_NEBULA_EXISTING_MODEL_COUNT) {
		failures.push(
			`Schema Nebula must expose ${SCHEMA_NEBULA_EXISTING_MODEL_COUNT} existing model nodes; found ${existingCollections.length}.`,
		);
	}
	if (plannedCollections.length !== SCHEMA_NEBULA_NODE_COUNT - SCHEMA_NEBULA_EXISTING_MODEL_COUNT) {
		failures.push(
			`Schema Nebula must expose ${
				SCHEMA_NEBULA_NODE_COUNT - SCHEMA_NEBULA_EXISTING_MODEL_COUNT
			} planned nodes; found ${plannedCollections.length}.`,
		);
	}
	const modelDirectory = 'packages/adapters-db-mongo/src/models';
	const modelFiles = fs.readdirSync(path.join(repositoryRoot, modelDirectory));
	for (const excludedFile of SCHEMA_NEBULA_NON_TARGET_MODEL_FILES) {
		if (!modelFiles.includes(excludedFile)) {
			failures.push(`Schema Nebula non-target model exception is stale: ${excludedFile} no longer exists.`);
		}
	}
	const discoveredModels = modelFiles
		.filter((fileName) => fileName.endsWith('.model.ts') && !SCHEMA_NEBULA_NON_TARGET_MODEL_FILES.has(fileName))
		.map((fileName) => `${modelDirectory}/${fileName}`)
		.sort();
	const declaredModels = [...new Set(declaredCurrentModels)].sort();
	if (JSON.stringify(discoveredModels) !== JSON.stringify(declaredModels)) {
		failures.push(
			`Schema Nebula solid nodes must match current adapter models exactly; discovered ${discoveredModels.join(
				', ',
			)}, declared ${declaredModels.join(', ')}.`,
		);
	}

	const sourceCorpus = sourceOfTruth
		.map((sourcePath) => path.join(repositoryRoot, sourcePath))
		.filter((absolutePath) => fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile())
		.map((absolutePath) => fs.readFileSync(absolutePath, 'utf8'))
		.join('\n');
	for (const collectionId of collectionIds) {
		if (!sourceCorpus.includes(collectionId)) {
			failures.push(`Schema Nebula collection ${collectionId} is absent from its governed source corpus.`);
		}
	}

	const instrument = manifest.instruments?.find((item) => item.key === 'schema-nebula');
	if (!instrument) {
		failures.push('Portal manifest is missing the schema-nebula instrument.');
	} else {
		if (normalizeRoute(instrument.route ?? '') !== SCHEMA_NEBULA_ROUTE) {
			failures.push(`Manifest schema-nebula route must remain ${SCHEMA_NEBULA_ROUTE}.`);
		}
		if (instrument.dataset !== manifest.datasets?.schemaNebula?.file) {
			failures.push('Manifest schema-nebula instrument and schemaNebula dataset paths must match.');
		}
	}

	return {
		...raw,
		sourceOfTruth,
		clusters,
		collections,
	};
}

function compileCommandVerbs(raw, truth, repositoryRoot, pages, decisionGates, manifest, failures) {
	if (raw.schemaVersion !== 1) failures.push('Command Verbs schemaVersion must be 1.');
	const lastVerified = requireString(raw.lastVerified, 'commandVerbs.lastVerified', failures);
	if (lastVerified !== truth.lastVerified) {
		failures.push('Command Verbs lastVerified must match the project-progress Portal truth snapshot.');
	}
	requireString(raw.title, 'commandVerbs.title', failures);
	requireString(raw.summary, 'commandVerbs.summary', failures);
	const sourceOfTruth = requireUniqueStringArray(raw.sourceOfTruth, 'commandVerbs.sourceOfTruth', failures);
	validateSources(repositoryRoot, sourceOfTruth, 'commandVerbs', failures);

	requireUniqueIds(raw.verbs, 'Command Verbs verbs', failures);
	const verbs = Array.isArray(raw.verbs) ? raw.verbs : [];
	if (verbs.map((verb) => verb.id).join(',') !== COMMAND_VERB_ORDER.join(',')) {
		failures.push(`Command Verbs must be exactly ${COMMAND_VERB_ORDER.join(', ')} in display order.`);
	}

	const routeToPage = new Map(pages.map((page) => [page.route, page]));
	const compiledVerbs = [];
	for (const verb of verbs) {
		const verbId = requireString(verb.id, 'Command Verbs verb.id', failures);
		const token = requireString(verb.token, `Command Verbs ${verbId}.token`, failures);
		if (token !== verbId || token !== token.toLocaleLowerCase('en')) {
			failures.push(`Command Verbs ${verbId}.token must equal its lowercase id.`);
		}
		requireString(verb.label, `Command Verbs ${verbId}.label`, failures);
		requireString(verb.description, `Command Verbs ${verbId}.description`, failures);
		const example = requireString(verb.example, `Command Verbs ${verbId}.example`, failures);
		if (COMMAND_VERB_EXAMPLES[verbId] !== example) {
			failures.push(`Command Verbs ${verbId}.example must remain "${COMMAND_VERB_EXAMPLES[verbId]}".`);
		}
		if (!VALID_COMMAND_TARGET_SOURCES.has(verb.targetSource)) {
			failures.push(`Command Verbs ${verbId} has invalid targetSource ${verb.targetSource}.`);
		}
		const emptyRoute = requireString(verb.emptyRoute, `Command Verbs ${verbId}.emptyRoute`, failures);
		if (emptyRoute && !routeToPage.has(normalizeRoute(emptyRoute))) {
			failures.push(`Command Verbs ${verbId}.emptyRoute does not resolve: ${emptyRoute}.`);
		}

		let targets = [];
		if (verb.targetSource === 'journey-pages') {
			const routePrefixes = requireUniqueStringArray(
				verb.routePrefixes,
				`Command Verbs ${verbId}.routePrefixes`,
				failures,
			);
			const includeRoutes = requireUniqueStringArray(
				verb.includeRoutes,
				`Command Verbs ${verbId}.includeRoutes`,
				failures,
			).map(normalizeRoute);
			if (!routePrefixes.includes('/business-flows/')) {
				failures.push('The trace verb must derive journey targets from /business-flows/.');
			}
			if (!includeRoutes.includes('/backend/request-lifecycle')) {
				failures.push('The trace verb must include the Request Flight Simulator route.');
			}
			for (const route of includeRoutes) {
				if (!routeToPage.has(route)) {
					failures.push(`Command Verbs ${verbId} includes missing route ${route}.`);
				}
			}
			targets = pages
				.filter(
					(page) =>
						routePrefixes.some((prefix) => page.route.startsWith(prefix)) ||
						includeRoutes.includes(page.route),
				)
				.filter((page) => typeof page.frontMatter?.title === 'string')
				.map((page) => commandTargetFromPage(page, 'journey', 'Journey'));
		} else if (verb.targetSource === 'decision-gates') {
			targets = decisionGates.gates.map((gate) => ({
				id: gate.id,
				title: gate.label,
				path: `/decisions/gate-console?gate=${encodeURIComponent(gate.id)}`,
				kind: 'gate',
				section: 'Decision gate',
				status: gate.status,
				keywords: [
					gate.id,
					gate.question,
					gate.source,
					...gate.blocksChunks.map((chunk) => `Chunk ${chunk}`),
					...gate.blocksCollections,
					...gate.blocksFeatures,
				].join(' '),
			}));
		} else if (verb.targetSource === 'document-status') {
			targets = pages
				.filter(
					(page) =>
						typeof page.frontMatter?.title === 'string' && typeof page.frontMatter?.status === 'string',
				)
				.map((page) => commandTargetFromPage(page, 'status', 'Documentation status'));
		}

		targets.sort((left, right) => {
			const leftIsDefault = normalizeRoute(left.path) === normalizeRoute(emptyRoute);
			const rightIsDefault = normalizeRoute(right.path) === normalizeRoute(emptyRoute);
			if (leftIsDefault !== rightIsDefault) return leftIsDefault ? -1 : 1;
			return left.title.localeCompare(right.title);
		});
		if (targets.length === 0) {
			failures.push(`Command Verbs ${verbId} compiled no targets.`);
		}
		if (new Set(targets.map((target) => target.id)).size !== targets.length) {
			failures.push(`Command Verbs ${verbId} compiled duplicate target ids.`);
		}
		compiledVerbs.push({ ...verb, targets });
	}

	const instrument = manifest.instruments?.find((item) => item.key === 'command-verbs');
	if (!instrument) {
		failures.push('Portal manifest is missing the command-verbs instrument.');
	} else {
		if (normalizeRoute(instrument.route ?? '') !== COMMAND_VERBS_ROUTE) {
			failures.push(`Manifest command-verbs route must remain ${COMMAND_VERBS_ROUTE}.`);
		}
		if (instrument.dataset !== manifest.datasets?.commandVerbs?.file) {
			failures.push('Manifest command-verbs instrument and commandVerbs dataset paths must match.');
		}
	}

	return {
		...raw,
		sourceOfTruth,
		verbs: compiledVerbs,
	};
}

function compileFirstFlight(raw, truth, repositoryRoot, pages, manifest, failures) {
	if (raw.schemaVersion !== 1) failures.push('First Flight schemaVersion must be 1.');
	const lastVerified = requireString(raw.lastVerified, 'firstFlight.lastVerified', failures);
	if (lastVerified !== truth.lastVerified) {
		failures.push('First Flight lastVerified must match the project-progress Portal truth snapshot.');
	}
	const route = normalizeRoute(requireString(raw.route, 'firstFlight.route', failures));
	if (route !== FIRST_FLIGHT_ROUTE) {
		failures.push(`First Flight route must remain ${FIRST_FLIGHT_ROUTE}.`);
	}
	requireString(raw.title, 'firstFlight.title', failures);
	requireString(raw.summary, 'firstFlight.summary', failures);
	const sourceOfTruth = requireUniqueStringArray(raw.sourceOfTruth, 'firstFlight.sourceOfTruth', failures);
	validateSources(repositoryRoot, sourceOfTruth, 'firstFlight', failures);

	const targetContract =
		raw.targetContract && typeof raw.targetContract === 'object' && !Array.isArray(raw.targetContract)
			? raw.targetContract
			: {};
	if (targetContract.primary !== 'stable-heading-id') {
		failures.push('First Flight targetContract.primary must remain stable-heading-id.');
	}
	if (targetContract.enhancementAttribute !== 'data-first-flight-anchor') {
		failures.push('First Flight targetContract.enhancementAttribute must remain data-first-flight-anchor.');
	}
	if (targetContract.missingTarget !== 'fail-build') {
		failures.push('First Flight targetContract.missingTarget must remain fail-build.');
	}

	const navigationPolicy =
		raw.navigationPolicy && typeof raw.navigationPolicy === 'object' && !Array.isArray(raw.navigationPolicy)
			? raw.navigationPolicy
			: {};
	if (navigationPolicy.mode !== 'url-query') {
		failures.push('First Flight navigationPolicy.mode must remain url-query.');
	}
	if (navigationPolicy.personaParam !== 'firstFlight') {
		failures.push('First Flight navigationPolicy.personaParam must remain firstFlight.');
	}
	if (navigationPolicy.stepParam !== 'step') {
		failures.push('First Flight navigationPolicy.stepParam must remain step.');
	}
	if (navigationPolicy.personaParam === navigationPolicy.stepParam) {
		failures.push('First Flight navigation parameter names must be distinct.');
	}
	if (navigationPolicy.persistsProgress !== false) {
		failures.push('First Flight navigationPolicy.persistsProgress must remain false.');
	}

	const progressPolicy =
		raw.progressPolicy && typeof raw.progressPolicy === 'object' && !Array.isArray(raw.progressPolicy)
			? raw.progressPolicy
			: {};
	if (progressPolicy.mode !== 'device-local') {
		failures.push('First Flight progressPolicy.mode must remain device-local.');
	}
	if (progressPolicy.storageKey !== 'saha-textile.portal.first-flight.v1') {
		failures.push('First Flight progressPolicy.storageKey must remain saha-textile.portal.first-flight.v1.');
	}
	if (progressPolicy.payloadVersion !== 1) {
		failures.push('First Flight progressPolicy.payloadVersion must remain 1.');
	}
	if (progressPolicy.optIn !== 'explicit-per-persona') {
		failures.push('First Flight progressPolicy.optIn must remain explicit-per-persona.');
	}
	if (progressPolicy.resumeStrategy !== 'furthest-reached') {
		failures.push('First Flight progressPolicy.resumeStrategy must remain furthest-reached.');
	}
	if (progressPolicy.completionScope !== 'per-persona') {
		failures.push('First Flight progressPolicy.completionScope must remain per-persona.');
	}
	for (const field of ['resettable', 'telemetry', 'writesToApplicationApis', 'writesToRepository']) {
		if (typeof progressPolicy[field] !== 'boolean') {
			failures.push(`First Flight progressPolicy.${field} must be boolean.`);
		}
	}
	if (progressPolicy.resettable !== true) {
		failures.push('First Flight progress must remain user-resettable.');
	}
	for (const field of ['telemetry', 'writesToApplicationApis', 'writesToRepository']) {
		if (progressPolicy[field] !== false) {
			failures.push(`First Flight progressPolicy.${field} must remain false.`);
		}
	}

	const debriefPolicy =
		raw.debriefPolicy && typeof raw.debriefPolicy === 'object' && !Array.isArray(raw.debriefPolicy)
			? raw.debriefPolicy
			: {};
	if (debriefPolicy.trigger !== 'final-checkpoint') {
		failures.push('First Flight debriefPolicy.trigger must remain final-checkpoint.');
	}
	if (debriefPolicy.presentation !== 'route-overlay') {
		failures.push('First Flight debriefPolicy.presentation must remain route-overlay.');
	}
	if (debriefPolicy.requiresStoredProgress !== false) {
		failures.push('First Flight debrief must remain available without stored progress.');
	}
	if (debriefPolicy.persistsCompletionOnlyWhenOptedIn !== true) {
		failures.push('First Flight completion may persist only after explicit progress opt-in.');
	}

	requireUniqueIds(raw.personas, 'First Flight personas', failures);
	const personas = Array.isArray(raw.personas) ? raw.personas : [];
	if (personas.map((persona) => persona.id).join(',') !== FIRST_FLIGHT_PERSONA_ORDER.join(',')) {
		failures.push(
			`First Flight personas must be exactly ${FIRST_FLIGHT_PERSONA_ORDER.join(', ')} in display order.`,
		);
	}
	const routeToPage = new Map(pages.map((page) => [page.route, page]));
	const compiledPersonas = [];

	for (const persona of personas) {
		const personaId = requireString(persona.id, 'First Flight persona.id', failures);
		for (const field of ['label', 'summary', 'outcome']) {
			requireString(persona[field], `First Flight ${personaId}.${field}`, failures);
		}
		if (!Number.isInteger(persona.durationMinutes) || persona.durationMinutes < 5 || persona.durationMinutes > 20) {
			failures.push(`First Flight ${personaId}.durationMinutes must be an integer from 5 to 20.`);
		}
		requireUniqueIds(persona.stops, `First Flight ${personaId}.stops`, failures);
		const stops = Array.isArray(persona.stops) ? persona.stops : [];
		if (stops.length < 5 || stops.length > 7) {
			failures.push(`First Flight ${personaId} must contain five to seven stops.`);
		}
		if (FIRST_FLIGHT_STOP_COUNTS[personaId] !== stops.length) {
			failures.push(
				`First Flight ${personaId} must retain exactly ${FIRST_FLIGHT_STOP_COUNTS[personaId]} governed stops.`,
			);
		}
		const normalizedRoutes = [];
		const compiledStops = [];
		for (const stop of stops) {
			const stopId = requireString(stop.id, `First Flight ${personaId} stop.id`, failures);
			for (const field of ['title', 'instruction', 'why']) {
				requireString(stop[field], `First Flight ${personaId}.${stopId}.${field}`, failures);
			}
			const stopRoute = requireString(stop.route, `First Flight ${personaId}.${stopId}.route`, failures);
			const normalizedStopRoute = normalizeRoute(stopRoute);
			if (stopRoute !== normalizedStopRoute || stopRoute.includes('#') || stopRoute.includes('?')) {
				failures.push(
					`First Flight ${personaId}.${stopId}.route must be a normalized route without a query or hash.`,
				);
			}
			normalizedRoutes.push(normalizedStopRoute);
			const page = routeToPage.get(normalizedStopRoute);
			if (!page) {
				failures.push(`First Flight ${personaId}.${stopId} references missing route ${normalizedStopRoute}.`);
			}

			const anchor = requireString(stop.anchor, `First Flight ${personaId}.${stopId}.anchor`, failures);
			if (anchor.startsWith('#') || anchor.includes(' ')) {
				failures.push(`First Flight ${personaId}.${stopId}.anchor must be an unprefixed stable identifier.`);
			}
			if (page && !collectDocumentationAnchors(page.raw).has(anchor)) {
				failures.push(
					`First Flight ${personaId}.${stopId} references missing anchor #${anchor} on ${normalizedStopRoute}.`,
				);
			}
			const pageTitle = page?.frontMatter?.title;
			const pageStatus = page?.frontMatter?.status;
			if (typeof pageTitle !== 'string' || pageTitle.trim() === '') {
				failures.push(`First Flight ${personaId}.${stopId} target ${normalizedStopRoute} has no page title.`);
			}
			if (!VALID_PORTAL_PAGE_STATUSES.has(pageStatus)) {
				failures.push(
					`First Flight ${personaId}.${stopId} target ${normalizedStopRoute} has invalid page status ${pageStatus}.`,
				);
			}
			compiledStops.push({
				...stop,
				route: normalizedStopRoute,
				pageTitle,
				pageStatus,
				sourcePath: page?.repositoryPath,
			});
		}
		if (new Set(normalizedRoutes).size !== normalizedRoutes.length) {
			failures.push(`First Flight ${personaId} must not visit the same route twice.`);
		}
		compiledPersonas.push({ ...persona, stops: compiledStops });
	}

	const instrument = manifest.instruments?.find((item) => item.key === 'first-flight');
	if (!instrument) {
		failures.push('Portal manifest is missing the first-flight instrument.');
	} else {
		if (normalizeRoute(instrument.route ?? '') !== FIRST_FLIGHT_ROUTE) {
			failures.push(`Manifest first-flight route must remain ${FIRST_FLIGHT_ROUTE}.`);
		}
		if (instrument.dataset !== manifest.datasets?.firstFlight?.file) {
			failures.push('Manifest first-flight instrument and firstFlight dataset paths must match.');
		}
		if (instrument.status === 'built') {
			const landingPage = routeToPage.get(FIRST_FLIGHT_ROUTE);
			if (landingPage?.frontMatter?.status !== 'implemented') {
				failures.push('Built First Flight requires its landing page status to be implemented.');
			}
			for (const implementationPath of FIRST_FLIGHT_REQUIRED_IMPLEMENTATION) {
				if (!fs.existsSync(path.join(repositoryRoot, implementationPath))) {
					failures.push(`Built First Flight is missing implementation evidence ${implementationPath}.`);
				}
			}
		}
	}

	return {
		...raw,
		route,
		sourceOfTruth,
		targetContract,
		navigationPolicy,
		progressPolicy,
		debriefPolicy,
		personas: compiledPersonas,
	};
}

function validateDatasetBindings(repositoryRoot, manifest, pages, compiled, failures) {
	const pageByPath = new Map(pages.map((page) => [page.repositoryPath, page]));
	const instrumentByKey = new Map(
		(Array.isArray(manifest.instruments) ? manifest.instruments : []).map((instrument) => [
			instrument.key,
			instrument,
		]),
	);
	for (const [datasetKey, binding] of Object.entries(manifest.datasets ?? {})) {
		const file = requireString(binding?.file, `${datasetKey}.file`, failures);
		if (file && !fs.existsSync(path.join(repositoryRoot, file))) {
			failures.push(`${datasetKey} references missing dataset ${file}.`);
		}
		const instrumentKey = requireString(binding?.instrument, `${datasetKey}.instrument`, failures);
		const instrument = instrumentByKey.get(instrumentKey);
		if (!instrument) {
			failures.push(`${datasetKey} references unknown instrument ${instrumentKey}.`);
		} else if (instrument.dataset !== file) {
			failures.push(`${datasetKey}.file must match instrument ${instrumentKey}.dataset.`);
		}
		if (!compiled[datasetKey]) {
			failures.push(`${datasetKey} has no compiled dataset.`);
			continue;
		}
		if (binding.page === undefined) {
			if (instrument?.status === 'built') {
				failures.push(`Built instrument ${instrumentKey} requires a dataset page binding.`);
			}
			continue;
		}
		const pagePath = requireString(binding.page, `${datasetKey}.page`, failures);
		const page = pageByPath.get(pagePath);
		if (!page) {
			failures.push(`${datasetKey} is bound to missing page ${pagePath}.`);
			continue;
		}
		if (instrument?.page !== pagePath) {
			failures.push(`${datasetKey}.page must match instrument ${instrumentKey}.page.`);
		}
		if (page.frontMatter?.last_verified !== compiled[datasetKey].lastVerified) {
			failures.push(
				`${pagePath} last_verified must equal ${datasetKey}.lastVerified (${compiled[datasetKey].lastVerified}).`,
			);
		}
		if (!Array.isArray(page.frontMatter?.source_of_truth)) {
			failures.push(`${pagePath} must use a source_of_truth list.`);
		} else {
			for (const requiredSource of compiled[datasetKey].sourceOfTruth) {
				if (!page.frontMatter.source_of_truth.includes(requiredSource)) {
					failures.push(`${pagePath} provenance is missing ${requiredSource}.`);
				}
			}
			if (!page.frontMatter.source_of_truth.includes(file)) {
				failures.push(`${pagePath} provenance is missing governed dataset ${file}.`);
			}
			if (!page.frontMatter.source_of_truth.includes('docs/_data/portal-manifest.json')) {
				failures.push(`${pagePath} provenance is missing docs/_data/portal-manifest.json.`);
			}
		}
	}
}

function compilePortalData({ repositoryRoot }) {
	const failures = [];
	const pages = collectDocumentationPages(repositoryRoot);
	const manifestPath = 'docs/_data/portal-manifest.json';
	const manifest = readJson(repositoryRoot, manifestPath, failures);
	const truth = readProjectTruth(repositoryRoot, failures);

	validateProjectTruth(repositoryRoot, truth, failures);
	validateManifest(repositoryRoot, manifest, pages, failures);

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
	const schemaRaw = readJson(
		repositoryRoot,
		manifest.datasets?.schemaNebula?.file ?? 'docs/_data/instruments/schema-nebula.json',
		failures,
	);
	const commandVerbsRaw = readJson(
		repositoryRoot,
		manifest.datasets?.commandVerbs?.file ?? 'docs/_data/instruments/command-verbs.json',
		failures,
	);
	const firstFlightRaw = readJson(
		repositoryRoot,
		manifest.datasets?.firstFlight?.file ?? 'docs/_data/instruments/first-flight.json',
		failures,
	);

	const missionControl = compileMissionControl(missionRaw, truth, repositoryRoot, failures);
	const decisionGates = compileDecisionGates(gatesRaw, truth, repositoryRoot, failures);
	const requestFlight = compileRequestFlight(flightRaw, repositoryRoot, failures);
	const schemaNebula = compileSchemaNebula(schemaRaw, truth, repositoryRoot, manifest, failures);
	const commandVerbs = compileCommandVerbs(
		commandVerbsRaw,
		truth,
		repositoryRoot,
		pages,
		decisionGates,
		manifest,
		failures,
	);
	const firstFlight = compileFirstFlight(firstFlightRaw, truth, repositoryRoot, pages, manifest, failures);
	const compiled = {
		missionControl,
		decisionGates,
		requestFlight,
		schemaNebula,
		commandVerbs,
		firstFlight,
	};
	validateDatasetBindings(repositoryRoot, manifest, pages, compiled, failures);

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
	compileFirstFlight,
	compilePortalData,
	normalizeRoute,
	parseFrontMatter,
};
