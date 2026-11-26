import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as base } from '@playwright/test';

/**
 * One home page is shared by every worker of a run, and the desktop and phone projects run the same files at the same
 * time. Specs that change Home (stand-in banners, the Page Builder switch, Home's schedule) hold it alone; specs whose
 * checks depend on Home as a fresh test database has it hold it together with other readers. A changing spec waits
 * until no reader holds it, and readers wait while it is held for a change, so a check never sees Home half changed.
 *
 * The lock is a folder beside the system's temporary files, named after the test database, so every process using
 * that database shares it. Entries carry the holder's process id; one whose process has ended is cleared.
 */
const FOLDER = join(tmpdir(), 'saha-textile-e2e-home-lock-saha_textile_e2e');
const WRITER = join(FOLDER, 'writer');
/** A held lock never takes longer than this to come free; past it the hook fails and names the holders. */
export const HOME_LOCK_WAIT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const alive = (pid: number): boolean => {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** The writer's process id, or null when nobody holds Home for a change (a holder that has ended is cleared). */
const writerPid = (): number | null => {
	let pid: number;
	try {
		pid = Number(readFileSync(join(WRITER, 'pid'), 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		try {
			// Made but not yet signed: a holder between its two steps, unless it has sat unsigned for a while.
			if (Date.now() - statSync(WRITER).mtimeMs < 10_000) return -1;
		} catch {
			return null;
		}
		rmSync(WRITER, { recursive: true, force: true });
		return null;
	}
	if (alive(pid)) return pid;
	rmSync(WRITER, { recursive: true, force: true });
	return null;
};

/** Readers other than this process, with the entries of ended processes cleared. */
const otherReaders = (): string[] =>
	readdirSync(FOLDER)
		.filter((name) => name.startsWith('reader-'))
		.filter((name) => {
			const pid = Number(name.split('-')[1]);
			if (pid === process.pid) return false;
			if (alive(pid)) return true;
			rmSync(join(FOLDER, name), { force: true });
			return false;
		});

let writes = 0;
let readerCount = 0;

const waitUntil = async (ready: () => boolean, what: () => string): Promise<void> => {
	const started = Date.now();
	while (!ready()) {
		if (Date.now() - started > HOME_LOCK_WAIT_MS) throw new Error(`Home stayed held: ${what()}`);
		await sleep(200);
	}
};

/** Holds Home alone for a change; the answer lets it go. A process may hold it more than once. */
async function holdForChange(): Promise<() => void> {
	mkdirSync(FOLDER, { recursive: true });
	if (writes === 0) {
		await waitUntil(
			() => {
				try {
					mkdirSync(WRITER);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
					writerPid();
					return false;
				}
				writeFileSync(join(WRITER, 'pid'), String(process.pid));
				return true;
			},
			() => `changed by process ${writerPid()}`,
		);
		try {
			await waitUntil(
				() => otherReaders().length === 0,
				() => `read by ${otherReaders().join(', ')}`,
			);
		} catch (error) {
			rmSync(WRITER, { recursive: true, force: true });
			throw error;
		}
	}
	writes += 1;
	let held = true;
	return () => {
		if (!held) return;
		held = false;
		writes -= 1;
		if (writes === 0) rmSync(WRITER, { recursive: true, force: true });
	};
}

/** Holds Home together with other readers; the answer lets it go. */
async function holdForReading(): Promise<() => void> {
	mkdirSync(FOLDER, { recursive: true });
	readerCount += 1;
	const entry = join(FOLDER, `reader-${process.pid}-${readerCount}`);
	const changedByOther = () => {
		const pid = writerPid();
		return pid !== null && pid !== process.pid;
	};
	await waitUntil(
		() => {
			if (changedByOther()) return false;
			writeFileSync(entry, '');
			// A change that started while this entry was being written goes first.
			if (!changedByOther()) return true;
			rmSync(entry, { force: true });
			return false;
		},
		() => `changed by process ${writerPid()}`,
	);
	return () => rmSync(entry, { force: true });
}

/** Holds the shared home page: `change` alone, `read` beside other readers. */
export function holdHome(mode: 'change' | 'read'): Promise<() => void> {
	return mode === 'change' ? holdForChange() : holdForReading();
}

/**
 * For a group whose checks depend on Home as a fresh test database has it: holds Home for reading around the group's
 * tests in each worker, so no spec changes it meanwhile. Call it first in the group.
 */
export function readsHome(): void {
	let release: (() => void) | null = null;
	base.beforeAll(async () => {
		base.setTimeout(HOME_LOCK_WAIT_MS + 30_000);
		release = await holdHome('read');
	});
	base.afterAll(() => {
		release?.();
		release = null;
	});
}
