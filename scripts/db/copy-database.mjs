/**
 * `pnpm db:copy -- --from <place> --to <place> [--from-ssh user@host] [--to-ssh user@host] [--apply --confirm <db>]`
 *
 * Copies one shop database into another, as it is, under the destination's own logins (owner, 2026-11-23: this
 * computer's data into staging; later a trimmed staging into production). Without --apply it only reports what
 * each side holds.
 *
 * - Places: `local` (this computer's MongoDB), `stack` (the full Docker stack), and `development`, `staging`,
 *   `production` (servers, over SSH with the admin login, which is in the docker group). Production is never a
 *   source, and this computer's own database is never a destination.
 * - The dump streams straight from one database container into the other (`mongodump --archive | mongorestore
 *   --drop`, renamed to the destination's database); nothing is written to disk. The administrator login each
 *   container already holds does the work; no password leaves a container, and the copy never touches the
 *   destination's users, so its app and monitor logins stay as they are.
 * - On a destination with apps, the API and worker stop while the copy lands (the edge shows the back-in-a-moment
 *   pages), start again, then run the release steps (roles, indexes, migrations) and rebuild the search index.
 * - Afterwards every collection's document count is compared with the source.
 *
 * After a copy, mailbox tokens and e-document keys sealed with the source's keys cannot be opened with the
 * destination's: those connections show "needs connecting again". Sessions from the source do not sign anyone in.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { exportFolder } from '../secrets/infisical.mjs';
import { describeError, loadInventory } from '../secrets/inventory.mjs';
import {
	checkConfirmation,
	checkDatabaseName,
	DatabaseCopyError,
	ENDPOINTS,
	formatCopyReport,
	parseCopyArgs,
	shellQuote,
} from './plan.mjs';

const ROOT_LOGIN =
	'-u "$(cat /run/secrets/mongo-root-username)" -p "$(cat /run/secrets/mongo-root-password)" --authenticationDatabase admin';

/** Runs `docker …` here or on the server, and returns its output. */
function docker(place, args, { input } = {}) {
	const argv = ['docker', ...args];
	const result = place.ssh
		? spawnSync('ssh', ['-o', 'BatchMode=yes', place.ssh, argv.map(shellQuote).join(' ')], {
				input,
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
			})
		: spawnSync(argv[0], argv.slice(1), { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) {
		const last = (result.stderr || '').trim().split('\n').slice(-3).join(' / ');
		throw new DatabaseCopyError(`${place.name}: docker ${args[0]} failed (exit ${result.status}): ${last}`);
	}
	return result.stdout;
}

function containers(place, service, { all = false } = {}) {
	return docker(place, [
		'ps',
		...(all ? ['-a'] : []),
		'-q',
		'--filter',
		`label=com.docker.compose.project=${place.project}`,
		'--filter',
		`label=com.docker.compose.service=${service}`,
	])
		.split('\n')
		.filter(Boolean);
}

function mongoContainer(place) {
	const [id] = containers(place, 'mongo');
	if (!id) throw new DatabaseCopyError(`${place.name}: its database container is not running.`);
	return id;
}

const COUNTS = `const out = {};
for (const name of db.getCollectionNames().filter((n) => !n.startsWith('system.')).sort())
  out[name] = db.getCollection(name).countDocuments({});
print(JSON.stringify(out));`;

function counts(place) {
	const out = docker(
		place,
		[
			'exec',
			'-i',
			'-e',
			`APP_DATABASE=${place.database}`,
			mongoContainer(place),
			'sh',
			'-c',
			`mongosh --quiet ${ROOT_LOGIN} "$APP_DATABASE" --eval "$(cat)"`,
		],
		{ input: COUNTS },
	);
	const line = out.trim().split('\n').pop() ?? '{}';
	return JSON.parse(line);
}

/** Streams the source's dump into the destination's restore. */
function stream(source, destination) {
	const side = (place, args) => {
		const argv = ['docker', ...args];
		return place.ssh
			? spawn('ssh', ['-o', 'BatchMode=yes', place.ssh, argv.map(shellQuote).join(' ')], {
					stdio: ['pipe', 'pipe', 'pipe'],
				})
			: spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
	};
	const dump = side(source, [
		'exec',
		'-e',
		`APP_DATABASE=${source.database}`,
		mongoContainer(source),
		'sh',
		'-c',
		`mongodump --quiet --archive --gzip --db "$APP_DATABASE" ${ROOT_LOGIN}`,
	]);
	const restore = side(destination, [
		'exec',
		'-i',
		'-e',
		`FROM_DATABASE=${source.database}`,
		'-e',
		`TO_DATABASE=${destination.database}`,
		mongoContainer(destination),
		'sh',
		'-c',
		`mongorestore --quiet --archive --gzip --drop --nsFrom "$FROM_DATABASE.*" --nsTo "$TO_DATABASE.*" ${ROOT_LOGIN}`,
	]);
	dump.stdout.pipe(restore.stdin);
	const finished = (child, label) =>
		new Promise((resolve, reject) => {
			let errors = '';
			child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-2000)));
			child.on('error', reject);
			child.on('close', (code) =>
				code === 0
					? resolve(undefined)
					: reject(
							new DatabaseCopyError(
								`${label} failed (exit ${code}): ${errors.trim().split('\n').slice(-3).join(' / ')}`,
							),
						),
			);
		});
	return Promise.all([
		finished(dump, `dump from ${source.name}`),
		finished(restore, `restore into ${destination.name}`),
	]);
}

function waitHealthy(place, id, seconds = 180) {
	for (let waited = 0; waited < seconds; waited += 3) {
		const state = docker(place, [
			'inspect',
			'--format',
			'{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}',
			id,
		]).trim();
		if (state === 'running healthy' || state === 'running') return;
		spawnSync('sleep', ['3']);
	}
	throw new DatabaseCopyError(`${place.name}: the API did not come back healthy within ${seconds} s.`);
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseCopyArgs(argv);
	const inventory = loadInventory();
	const place = (name, ssh) => {
		const endpoint = ENDPOINTS[name];
		let database = endpoint.database;
		if (!database) {
			const project = inventory.projects[name];
			database = exportFolder({
				projectId: project.projectId,
				environment: project.environment,
				folder: 'api',
			}).get('MONGODB_DB_NAME');
		}
		return {
			name,
			ssh,
			project: endpoint.project,
			apps: endpoint.apps,
			database: checkDatabaseName(database, name),
		};
	};
	const source = place(args.from, args.fromSsh);
	const destination = place(args.to, args.toSsh);
	checkConfirmation(args, destination.database);

	const before = { source: counts(source), destination: counts(destination) };
	const steps = [];
	let after = null;
	if (args.apply) {
		const stopped = destination.apps.flatMap((service) => containers(destination, service));
		if (stopped.length) {
			docker(destination, ['stop', ...stopped]);
			steps.push(
				`Stopped ${stopped.length} app containers (${destination.apps.join(', ')}) while the copy lands.`,
			);
		}
		try {
			await stream(source, destination);
			steps.push(
				`Copied ${source.database} into ${destination.database} (collections replaced, users untouched).`,
			);
			// Counted before the apps start: the release steps then add what this release needs.
			after = counts(destination);
		} finally {
			if (stopped.length) {
				docker(destination, ['start', ...stopped]);
				steps.push('Started them again.');
			}
		}
		const [api] = destination.apps.includes('api') ? containers(destination, 'api') : [];
		if (api) {
			waitHealthy(destination, api);
			for (const [label, script] of [
				['Release steps', 'dist/release-steps.js'],
				['Search index rebuilt', 'dist/rebuild-search-index.js'],
			]) {
				const out = docker(destination, ['exec', api, 'node', script]).trim().split('\n').pop();
				steps.push(`${label}: ${out}`);
			}
		} else if (destination.apps.length) {
			steps.push('No API is running there: run its release steps and the search rebuild when it starts.');
		}
	}
	console.log(
		formatCopyReport({
			from: source.name,
			to: destination.name,
			fromDatabase: source.database,
			toDatabase: destination.database,
			apply: args.apply,
			source: before.source,
			destination: before.destination,
			after,
			steps,
		}),
	);
	if (!after) return 0;
	const sameEverywhere = Object.keys(before.source).every((name) => after[name] === before.source[name]);
	return sameEverywhere ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().then(
		(code) => process.exit(code),
		(error) => {
			console.error(error instanceof DatabaseCopyError ? error.message : describeError(error));
			process.exit(1);
		},
	);
}
