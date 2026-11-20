#!/usr/bin/env node
/**
 * `pnpm pipeline:local`: the stages a change goes through on GitHub, run on this Mac, ending with the
 * result running on the full local stack with the dev project's real values (plan step 6, owner
 * decision L2 = A+, 2026-11-19).
 *
 *   pnpm pipeline:local                     all six stages
 *   pnpm pipeline:local -- --from images    start at one stage (checks, proof, images, release,
 *                                           deploy, record)
 *   pnpm pipeline:local -- --only release   one stage
 *   pnpm pipeline:local -- --json           one JSON event per line on stdout (commands' own output
 *                                           goes to stderr), for the Release Console later
 *   pnpm pipeline:local -- --branch dev     build another branch than the one checked out here
 *
 * Every run starts with a pull (owner, 20 Nov: "should always start with a git pull so as latest
 * code is there"): it fetches GitHub and fast-forwards the branch to GitHub's copy when that copy is
 * ahead. It never merges, never switches this folder's branch, and a branch that exists only on
 * this computer is built as it is. A branch other than the checked-out one is checked in a clean
 * copy of its last commit, as GitHub checks it.
 *
 *   1 checks   the CI jobs' commands (scripts/pipeline/stages.mjs, kept in step with ci.yml)
 *   2 proof    deploy, rollback, backup and restore on throwaway values (pnpm production:proof)
 *   3 images   built once from the last COMMIT (as GitHub builds them; uncommitted changes are not
 *              in them), tagged sha-<commit> and tree-<tree>, pushed to a registry on this Mac
 *   4 release  a full release folder from the dev project's real values (scripts/secrets/release.mjs),
 *              then the droplet's own `deploy.sh --check-only` on it
 *   5 deploy   the full stack runs those image digests with the dev project's values
 *   6 record   readiness and config checks through the stack's edge, one line in
 *              .local-release/runs.log
 *
 * Names and outcomes only: no value is printed. Stops at the first failing stage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnvText, readIfPresent } from '../secrets/files.mjs';
import { exportProject } from '../secrets/infisical.mjs';
import { loadInventory, SecretsError } from '../secrets/inventory.mjs';
import { IMAGE_NAMES, IMAGES_FILE, LOCAL_RELEASE_DIR, writeLocalRelease } from '../secrets/release.mjs';
import { stackAddresses, stackPort, STACK_ENV_DIR } from '../secrets/stack.mjs';
import { CHECKS, PROOF, STAGES } from './stages.mjs';
import { BRANCH_NAME } from '../release-console/git-branches.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY_CONTAINER = 'saha-textile-local-registry';
const REGISTRY = `localhost:${process.env.LOCAL_REGISTRY_PORT || '5056'}`;
const TARGETS = ['api', 'storefront', 'admin', 'ops'];

/**
 * Which stages to run.
 * @param {string[]} args
 */
export function parseArgs(args) {
	const flags = args.filter((arg) => arg !== '--');
	const json = flags.includes('--json');
	const value = (flag) => {
		const index = flags.indexOf(flag);
		return index === -1 ? undefined : flags[index + 1];
	};
	const from = value('--from');
	const only = value('--only');
	const branch = value('--branch');
	if (flags.includes('--branch') && (branch === undefined || !BRANCH_NAME.test(branch)))
		throw new SecretsError(`"${branch ?? ''}" is not a branch name.`);
	for (const stage of [from, only]) {
		if (stage !== undefined && !STAGES.includes(stage)) {
			throw new SecretsError(`Unknown stage "${stage}". Use one of: ${STAGES.join(', ')}.`);
		}
	}
	const known = new Set(['--json', '--from', '--only', '--branch', from, only, branch]);
	const unknown = flags.filter((flag) => !known.has(flag));
	if (unknown.length > 0) throw new SecretsError(`Unknown option ${unknown[0]}.`);
	if (from && only) throw new SecretsError('Use --from or --only, not both.');
	const stages = only ? [only] : STAGES.slice(from ? STAGES.indexOf(from) : 0);
	return branch ? { stages, json, branch } : { stages, json };
}

/** @param {{ json: boolean }} options */
function reporter({ json }) {
	const event = (fields) => {
		if (json) process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...fields })}\n`);
	};
	return {
		stage(stage, status, extra = {}) {
			event({ stage, status, ...extra });
			if (json) return;
			const mark = { started: '▶', passed: '✓', failed: '✗' }[status];
			const tail = extra.seconds === undefined ? '' : ` (${extra.seconds} s)`;
			process.stderr.write(`${mark} ${stage}${tail}${extra.reason ? `: ${extra.reason}` : ''}\n`);
		},
		step(stage, step) {
			event({ stage, step });
			if (!json) process.stderr.write(`  · ${step}\n`);
		},
		note(stage, note) {
			event({ stage, note });
			if (!json) process.stderr.write(`  ${note}\n`);
		},
	};
}

/**
 * Runs one command; its own output goes to stderr in --json mode so stdout stays events only.
 * @param {string} command
 * @param {{ json: boolean, env?: NodeJS.ProcessEnv, input?: string }} options
 */
function sh(command, { json, env, input }) {
	const result = spawnSync('bash', ['-c', command], {
		cwd: ROOT,
		env: { ...process.env, ...env },
		stdio: [input === undefined ? 'inherit' : 'pipe', json ? 2 : 'inherit', 'inherit'],
		input,
	});
	if (result.status !== 0) throw new SecretsError(`"${command}" failed.`);
}

/** @param {string[]} args */
function capture(command, args) {
	const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
	if (result.status !== 0) throw new SecretsError(`${command} ${args[0]} failed.`);
	return result.stdout.trim();
}

/** @typedef {(args: string[]) => { ok: boolean, out: string }} GitSync */
/** @type {GitSync} */
const gitSync = (args) => {
	const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
	return { ok: r.status === 0, out: String(r.stdout ?? '').trim() };
};

/**
 * The pull every run starts with. Fetches GitHub, then: a branch only on this computer is built as
 * it is; one only on GitHub is built from GitHub's copy; one behind GitHub is fast-forwarded (in
 * this folder when it is checked out here, else its ref only); one that has moved on both sides
 * stops the run, because only a person should merge. Answers the commit to build and whether it is
 * the checked-out branch.
 * @param {string | undefined} wanted
 * @param {{ note: (text: string) => void, git?: GitSync }} io
 */
export function pullBranch(wanted, { note, git = gitSync }) {
	const head = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
	const current = head.ok ? head.out : null;
	const branch = wanted || current;
	if (!branch) throw new SecretsError('This folder is on no branch: choose the branch to build.');
	note(`git pull · ${branch}`);
	if (!git(['fetch', '--prune', 'origin']).ok)
		note('GitHub could not be reached; building the commits this computer has.');
	const has = (ref) => git(['rev-parse', '--verify', '--quiet', ref]).ok;
	const local = has(`refs/heads/${branch}`);
	const remote = has(`refs/remotes/origin/${branch}`);
	const commitOf = (ref) => git(['rev-parse', ref]).out;
	const checkedOut = branch === current;
	if (!local && !remote) throw new SecretsError(`There is no branch ${branch} on this computer or on GitHub.`);
	if (!remote) {
		note(`${branch} is only on this computer: nothing to pull.`);
		return { commit: commitOf(`refs/heads/${branch}`), branch, checkedOut };
	}
	if (!local) {
		note(`${branch} is only on GitHub: building GitHub's copy.`);
		return { commit: commitOf(`refs/remotes/origin/${branch}`), branch, checkedOut: false };
	}
	const count = (range) => Number(git(['rev-list', '--count', range]).out) || 0;
	const behind = count(`${branch}..origin/${branch}`);
	const ahead = count(`origin/${branch}..${branch}`);
	if (behind > 0 && ahead > 0)
		throw new SecretsError(
			`${branch} has ${ahead} commit(s) GitHub lacks and GitHub has ${behind} it lacks. Merge them in a terminal, then run again.`,
		);
	if (behind > 0) {
		const pulled = checkedOut
			? git(['merge', '--ff-only', `origin/${branch}`])
			: git(['fetch', 'origin', `${branch}:${branch}`]);
		if (!pulled.ok)
			throw new SecretsError(
				`The pull could not fast-forward ${branch}${checkedOut ? ' (uncommitted changes in the same files?)' : ''}. Pull it in a terminal, then run again.`,
			);
		note(`Pulled ${behind} commit(s) into ${branch}.`);
	} else
		note(
			ahead
				? `${branch} is ${ahead} commit(s) ahead of GitHub: nothing to pull.`
				: `${branch} is up to date with GitHub.`,
		);
	return { commit: commitOf(`refs/heads/${branch}`), branch, checkedOut };
}

const stages = {
	checks({ json, report, state }) {
		if (state.checkedOut) {
			for (const check of CHECKS) {
				report.step('checks', check.name);
				sh(check.run, { json });
			}
			return;
		}
		// Another branch than this folder's: its last commit, in a clean copy, as GitHub checks it.
		const copy = join(ROOT, LOCAL_RELEASE_DIR, 'checks-copy');
		rmSync(copy, { recursive: true, force: true });
		mkdirSync(copy, { recursive: true, mode: 0o700 });
		try {
			sh(`git archive --format=tar ${state.commit} | tar -x -C "${copy}"`, { json });
			report.step('checks', `pnpm install in a clean copy of ${state.branch}`);
			sh(`cd "${copy}" && pnpm install --frozen-lockfile --prefer-offline`, { json });
			for (const check of CHECKS) {
				report.step('checks', check.name);
				sh(`cd "${copy}" && ${check.run}`, { json });
			}
		} finally {
			rmSync(copy, { recursive: true, force: true });
		}
	},

	proof({ json, report, state }) {
		// In a clean copy of the last commit, as GitHub runs it: the proof builds its images from the
		// folder it runs in, and this folder may hold uncommitted work (other chats share it).
		const checkout = join(ROOT, LOCAL_RELEASE_DIR, 'checkout');
		rmSync(checkout, { recursive: true, force: true });
		mkdirSync(checkout, { recursive: true, mode: 0o700 });
		sh(`git archive --format=tar ${state.commit} | tar -x -C "${checkout}"`, { json });
		reportDirty(report, 'proof', state.commit);
		report.step('proof', PROOF.name);
		const inCheckout = `cd "${checkout}" && ${PROOF.run}`;
		try {
			sh(inCheckout, { json });
		} finally {
			// The proof leaves its stack running for inspection; this run removes it.
			sh(`${inCheckout} clean`, { json });
			rmSync(checkout, { recursive: true, force: true });
		}
	},

	images({ json, report, state }) {
		const commit = state.commit;
		const tree = capture('git', ['rev-parse', `${commit}^{tree}`]);
		const dirty = reportDirty(report, 'images', commit);
		const running = spawnSync('docker', ['inspect', REGISTRY_CONTAINER], { stdio: 'ignore' }).status === 0;
		if (!running) {
			report.step('images', 'Starting the registry on this Mac');
			sh(
				`docker run -d --name ${REGISTRY_CONTAINER} --restart unless-stopped -p 127.0.0.1:${REGISTRY.split(':')[1]}:5000 -v saha_textile_local_registry:/var/lib/registry registry:3 >/dev/null`,
				{ json },
			);
		} else {
			sh(`docker start ${REGISTRY_CONTAINER} >/dev/null`, { json });
		}
		const lines = [`COMMIT=${commit}`, `TREE=${tree}`, `DIRTY=${dirty}`];
		for (const target of TARGETS) {
			report.step('images', `Building ${target} from the commit`);
			const name = `${REGISTRY}/saha-textile-${target}`;
			sh(
				`git archive --format=tar ${commit} | docker build --quiet -f docker/images/Dockerfile --target ${target} -t ${name}:sha-${commit} -t ${name}:tree-${tree} - >/dev/null`,
				{ json },
			);
			sh(
				`docker push --quiet ${name}:sha-${commit} >/dev/null && docker push --quiet ${name}:tree-${tree} >/dev/null`,
				{
					json,
				},
			);
			const headers = capture('curl', [
				'-fsSI',
				'-H',
				'Accept: application/vnd.oci.image.index.v1+json',
				'-H',
				'Accept: application/vnd.oci.image.manifest.v1+json',
				'-H',
				'Accept: application/vnd.docker.distribution.manifest.v2+json',
				`http://${REGISTRY}/v2/saha-textile-${target}/manifests/tree-${tree}`,
			]);
			const digest = /^docker-content-digest:\s*(\S+)/im.exec(headers)?.[1];
			if (!digest) throw new SecretsError(`The registry gave no digest for ${target}.`);
			lines.push(`${target.toUpperCase()}_IMAGE=${name}@${digest}`);
		}
		mkdirSync(join(ROOT, LOCAL_RELEASE_DIR), { recursive: true, mode: 0o700 });
		writeFileSync(join(ROOT, IMAGES_FILE), `${lines.join('\n')}\n`, { mode: 0o600 });
		report.note('images', `Four images pinned by digest, listed in ${IMAGES_FILE}.`);
	},

	release({ json, report, state }) {
		const images = readImages();
		const inventory = loadInventory();
		const project = inventory.projects.dev;
		const notes = new Set();
		report.step('release', `Reading ${project.name} (${project.environment})`);
		const folders = exportProject(project, { notes });
		for (const note of notes) report.note('release', note);
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
		const id = `${stamp}-${(images.get('COMMIT') ?? 'unknown').slice(0, 8)}`;
		const { dir, notes: renderNotes } = writeLocalRelease({
			root: ROOT,
			folders,
			inventory,
			source: `${project.name} (${project.environment})`,
			port: localPort(),
			images,
			id,
		});
		for (const note of renderNotes) report.note('release', note);
		report.step('release', "The droplet's own check: deploy.sh --check-only");
		sh(`bash "${dir}/bin/deploy.sh" --check-only "${dir}"`, {
			json,
			env: { SAHA_TEXTILE_ROOT: join(ROOT, LOCAL_RELEASE_DIR, 'root') },
		});
		state.release = id;
	},

	deploy({ json, report }) {
		const images = readImages();
		report.note(
			'deploy',
			`Images built from commit ${(images.get('COMMIT') ?? 'unknown').slice(0, 8)} (the images stage).`,
		);
		report.step('deploy', 'The stack files from the dev project (pnpm stack:env)');
		sh('pnpm -s stack:env', { json });
		report.step('deploy', 'The stack runs the pinned images');
		sh('bash scripts/stack.sh up', {
			json,
			env: {
				STACK_API_IMAGE: images.get('API_IMAGE'),
				STACK_STOREFRONT_IMAGE: images.get('STOREFRONT_IMAGE'),
				STACK_ADMIN_IMAGE: images.get('ADMIN_IMAGE'),
			},
		});
	},

	record({ report }) {
		const port = localPort();
		const addresses = stackAddresses(port);
		const fetch = (url) => {
			const { hostname, pathname } = new URL(url);
			const result = spawnSync(
				'curl',
				['-fsSk', '--max-time', '20', '--resolve', `${hostname}:${port}:127.0.0.1`, url],
				{ encoding: 'utf8' },
			);
			if (result.status !== 0) {
				throw new SecretsError(
					`The stack did not answer ${pathname} on its edge (port ${port}). Is it running? pnpm stack:up, or the deploy stage.`,
				);
			}
			return result.stdout;
		};
		report.step('record', 'Readiness through the edge');
		const ready = JSON.parse(fetch(`${addresses.api}/health/ready`));
		for (const dependency of ready.dependencies ?? []) {
			const fine = dependency.name === 'search' ? ['up', 'degraded'] : ['up'];
			if (!fine.includes(dependency.status)) {
				throw new SecretsError(`${dependency.name} is ${dependency.status} on the stack.`);
			}
		}
		report.step('record', 'The shop and admin config.json name this API');
		for (const site of [addresses.shop, addresses.admin]) {
			if (JSON.parse(fetch(`${site}/config.json`)).apiUrl !== addresses.api) {
				throw new SecretsError(
					`${site === addresses.shop ? 'The shop' : 'The admin'} config.json names another API.`,
				);
			}
		}
		report.note('record', `Open the shop at ${addresses.shop} and the admin at ${addresses.admin}.`);
	},
};

export const LOCK_FILE = `${LOCAL_RELEASE_DIR}/pipeline.lock`;

/**
 * One run at a time: two runs would share the registry, the proof's project and the stack. A lock
 * left by a run that no longer exists (its process is gone) is taken over.
 * @param {string} root
 * @param {{ commit: string, isRunning?: (pid: number) => boolean }} options
 * @returns {() => void} releases the lock
 */
export function acquireLock(root, { commit, isRunning = processRuns }) {
	const path = join(root, LOCK_FILE);
	mkdirSync(join(root, LOCAL_RELEASE_DIR), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			writeFileSync(path, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), commit }), {
				mode: 0o600,
				flag: 'wx',
			});
			return () => rmSync(path, { force: true });
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
			let held;
			try {
				held = JSON.parse(readFileSync(path, 'utf8'));
			} catch {
				held = {};
			}
			if (typeof held.pid === 'number' && isRunning(held.pid)) {
				throw new SecretsError(
					`Another pnpm pipeline:local run is in progress (process ${held.pid}, started ${held.started}). Wait for it, or stop it first.`,
				);
			}
			rmSync(path, { force: true });
		}
	}
	throw new SecretsError(`Could not take ${LOCK_FILE}.`);
}

/** @param {number} pid */
function processRuns(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
	}
}

/** Says how many uncommitted changes a commit-built stage leaves out, and returns the count. */
function reportDirty(report, stage, commit) {
	const dirty = capture('git', ['status', '--porcelain']).split('\n').filter(Boolean).length;
	if (dirty > 0) {
		report.note(
			stage,
			`${dirty} uncommitted change(s) in this folder are NOT used: this stage builds from commit ${commit.slice(0, 8)}, as GitHub does.`,
		);
	}
	return dirty;
}

/** The pinned images from stage 3. */
function readImages() {
	const text = readIfPresent(join(ROOT, IMAGES_FILE));
	if (text === null) throw new SecretsError(`${IMAGES_FILE} is missing. Run the images stage first.`);
	const images = parseEnvText(text);
	for (const name of IMAGE_NAMES) {
		if (!images.get(name)?.includes('@sha256:')) throw new SecretsError(`${IMAGES_FILE} has no pinned ${name}.`);
	}
	return images;
}

/** This Mac's HTTPS port for the stack (docker/stack/env/stack.env), 443 by default. */
function localPort() {
	const text = readIfPresent(join(ROOT, STACK_ENV_DIR, 'stack.env'));
	return stackPort(text === null ? new Map() : parseEnvText(text));
}

function record(line) {
	mkdirSync(join(ROOT, LOCAL_RELEASE_DIR), { recursive: true, mode: 0o700 });
	appendFileSync(join(ROOT, LOCAL_RELEASE_DIR, 'runs.log'), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const report = reporter(options);
	// One commit for the whole run, so every stage proves the same code even if another chat commits
	// meanwhile (this folder is shared).
	let pulled;
	try {
		pulled = pullBranch(options.branch, { note: (text) => report.note('run', text) });
	} catch (error) {
		report.stage('run', 'failed', { reason: error instanceof SecretsError ? error.message : String(error) });
		process.exitCode = 1;
		return;
	}
	const state = { release: undefined, ...pulled };
	let release;
	try {
		release = acquireLock(ROOT, { commit: state.commit });
	} catch (error) {
		report.stage('run', 'failed', { reason: error instanceof SecretsError ? error.message : String(error) });
		process.exitCode = 1;
		return;
	}
	process.once('SIGINT', () => {
		release();
		process.exit(130);
	});
	process.once('SIGTERM', () => {
		release();
		process.exit(143);
	});
	try {
		await runStages(options, report, state);
	} finally {
		release();
	}
}

/**
 * @param {ReturnType<typeof parseArgs>} options
 * @param {ReturnType<typeof reporter>} report
 * @param {{ release: string | undefined, commit: string, branch: string, checkedOut: boolean }} state
 */
async function runStages(options, report, state) {
	report.note('run', `Commit ${state.commit.slice(0, 8)} on ${state.branch}.`);
	const started = Date.now();
	const results = {};
	for (const stage of options.stages) {
		const begin = Date.now();
		report.stage(stage, 'started');
		try {
			stages[stage]({ ...options, report, state });
		} catch (error) {
			const reason = error instanceof SecretsError ? error.message : String(error);
			report.stage(stage, 'failed', { seconds: Math.round((Date.now() - begin) / 1000), reason });
			results[stage] = 'failed';
			record({ time: new Date().toISOString(), stages: results, release: state.release, result: 'failed' });
			process.exitCode = 1;
			return;
		}
		report.stage(stage, 'passed', { seconds: Math.round((Date.now() - begin) / 1000) });
		results[stage] = 'passed';
	}
	const images = readIfPresent(join(ROOT, IMAGES_FILE));
	const commit = images === null ? undefined : parseEnvText(images).get('COMMIT');
	record({
		time: new Date().toISOString(),
		commit,
		stages: results,
		release: state.release,
		seconds: Math.round((Date.now() - started) / 1000),
		result: 'passed',
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof SecretsError ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
