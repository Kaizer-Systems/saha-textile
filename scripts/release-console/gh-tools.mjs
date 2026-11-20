/**
 * The GitHub CLI for the Release Console's Connect (owner, 20 Nov, brief QhMFJFyn5Gq1sosZ1AaTQG,
 * Q1 = A): the machine's own gh when it has one, otherwise a pinned gh release the console fetches
 * into its own tools folder, checked against GitHub's published checksums, with no admin rights,
 * on macOS, Linux and Windows alike. An upgrade is a change of GH_VERSION here.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const GH_VERSION = '2.105.0';
const RELEASES = 'https://github.com/cli/cli/releases/download';

/** Where the console keeps tools it fetched itself. */
export function toolsDir(env = process.env) {
	return env.CONSOLE_TOOLS_DIR || join(homedir(), '.release-console', 'tools');
}

/** The release asset for this operating system and CPU, or null when GitHub publishes none. */
export function ghAsset(platform = process.platform, arch = process.arch, version = GH_VERSION) {
	const os = { darwin: 'macOS', linux: 'linux', win32: 'windows' }[platform];
	const cpu = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'armv6' }[arch];
	if (!os || !cpu || (os === 'macOS' && !['amd64', 'arm64'].includes(cpu))) return null;
	const ext = os === 'linux' ? 'tar.gz' : 'zip';
	return { name: `gh_${version}_${os}_${cpu}.${ext}`, binary: platform === 'win32' ? 'gh.exe' : 'gh' };
}

/** `a` is a newer x.y.z than `b`. */
export function newer(a, b) {
	const pa = String(a).split('.').map(Number);
	const pb = String(b).split('.').map(Number);
	for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
}

/** The newest copy in the tools folder, if the console fetched one before (first time, or an update). */
export function toolsGh(env = process.env, platform = process.platform) {
	const root = join(toolsDir(env), 'gh');
	if (!existsSync(root)) return null;
	const versions = readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
	versions.sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
	for (const v of versions) {
		const file = join(root, v, 'bin', platform === 'win32' ? 'gh.exe' : 'gh');
		if (existsSync(file)) return file;
	}
	return null;
}

/**
 * The gh to run: the console's own copy when it fetched one (it does so only when the machine had
 * none, or to update a gh it cannot update in place), else the machine's own on PATH, else null.
 */
export function findGh(run = spawnSync, env = process.env) {
	const fetched = toolsGh(env);
	if (fetched) return fetched;
	const own = run('gh', ['--version'], { encoding: 'utf8', timeout: 10_000 });
	return !own.error && own.status === 0 ? 'gh' : null;
}

/** The newest GitHub CLI release, from GitHub's public releases (no sign-in needed), or null. */
export async function latestGhVersion(get = fetch) {
	try {
		const res = await get('https://api.github.com/repos/cli/cli/releases/latest', {
			headers: { accept: 'application/vnd.github+json', 'user-agent': 'release-console' },
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) return null;
		return versionOf((await res.json())?.tag_name ?? '');
	} catch {
		return null;
	}
}

/** `gh version 2.105.0 (2026-11-17)` → `2.105.0`. */
export function versionOf(text) {
	return /(\d+\.\d+\.\d+)/.exec(String(text))?.[1] ?? null;
}

/** The SHA-256 GitHub lists for one asset in its checksums file. */
export function checksumFor(checksums, asset) {
	for (const line of String(checksums).split('\n')) {
		const [hash, name] = line.trim().split(/\s+/);
		if (name === asset && /^[0-9a-f]{64}$/.test(hash ?? '')) return hash;
	}
	return null;
}

/** The first file named `binary` under `dir`, however the archive nests it. */
function findFile(dir, binary) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			const found = findFile(path, binary);
			if (found) return found;
		} else if (entry === binary) return path;
	}
	return null;
}

export class InstallError extends Error {}

/**
 * Fetches gh GH_VERSION for this machine, checks it against GitHub's checksums file, unpacks it
 * (tar reads both .tar.gz and .zip on macOS, Linux and Windows 10+) and keeps it in the tools
 * folder. Nothing is kept when any step fails.
 * @param {{ version?: string, fetch?: typeof fetch, say?: (t: string) => void, env?: NodeJS.ProcessEnv, platform?: string, arch?: string, unpack?: (file: string, dir: string) => void }} [io]
 */
export async function installGh({
	version = GH_VERSION,
	fetch: get = fetch,
	say = () => undefined,
	env = process.env,
	platform = process.platform,
	arch = process.arch,
	unpack = (file, dir) => {
		const r = spawnSync('tar', ['-xf', file, '-C', dir], { encoding: 'utf8', timeout: 120_000 });
		if (r.status !== 0) throw new InstallError('The archive could not be unpacked (tar failed).');
	},
} = {}) {
	const asset = ghAsset(platform, arch, version);
	if (!asset) throw new InstallError(`GitHub publishes no GitHub CLI for ${platform}/${arch}.`);
	const work = mkdtempSync(join(tmpdir(), 'release-console-gh-'));
	try {
		say(`  downloading ${asset.name}`);
		const download = async (name) => {
			const res = await get(`${RELEASES}/v${version}/${name}`);
			if (!res.ok) throw new InstallError(`GitHub answered ${res.status} for ${name}.`);
			return Buffer.from(await res.arrayBuffer());
		};
		const sums = (await download(`gh_${version}_checksums.txt`)).toString('utf8');
		const expected = checksumFor(sums, asset.name);
		if (!expected) throw new InstallError(`GitHub's checksum list has no line for ${asset.name}.`);
		const archive = await download(asset.name);
		const actual = createHash('sha256').update(archive).digest('hex');
		if (actual !== expected)
			throw new InstallError(`${asset.name} does not match GitHub's checksum; nothing was installed.`);
		say(`  SHA-256 matches GitHub's checksum list`);
		const file = join(work, asset.name);
		writeFileSync(file, archive);
		const out = join(work, 'out');
		mkdirSync(out);
		unpack(file, out);
		const binary = findFile(out, asset.binary);
		if (!binary) throw new InstallError(`${asset.name} has no ${asset.binary} inside.`);
		const target = join(toolsDir(env), 'gh', version, 'bin');
		mkdirSync(target, { recursive: true });
		const dest = join(target, asset.binary);
		// A copy, not a rename: the temporary folder may sit on another disk.
		copyFileSync(binary, dest);
		if (platform !== 'win32') chmodSync(dest, 0o755);
		return dest;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

/** The one command a person can run instead, on this kind of machine. */
export function manualInstall(platform = process.platform) {
	if (platform === 'darwin') return 'brew install gh';
	if (platform === 'win32') return 'winget install --id GitHub.cli -e --source winget';
	return 'see https://github.com/cli/cli/blob/trunk/docs/install_linux.md (sudo apt install gh from GitHub’s own package source)';
}
