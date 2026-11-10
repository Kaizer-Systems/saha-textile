import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import {
	type AuditEntry,
	auditEntrySchema,
	repositoryFileSchema,
	type Project,
} from '@saha-textile/release-console-contracts';

import { type ConsoleFile, consoleFileSchema, emptyConsoleFile } from './console-file.js';

/** Where the console keeps its file: `CONSOLE_DATA_DIR`, or the Mac's Application Support folder. */
export function dataDir(): string {
	return process.env['CONSOLE_DATA_DIR'] ?? join(homedir(), 'Library', 'Application Support', 'Release Console');
}

/** Finds `.release-console.json` by walking up from the working folder (the repository root holds it). */
export function findRepositoryFile(from = process.cwd()): string | null {
	let dir = from;
	for (;;) {
		const candidate = join(dir, '.release-console.json');
		if (existsSync(candidate)) return candidate;
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

/**
 * Reads and writes the console file. Every write goes to a temporary file first and is then
 * renamed, so a crash never leaves half a file. Files are readable by the owner only.
 */
@Injectable()
export class ConsoleStore {
	private readonly logger = new Logger('ConsoleStore');
	private readonly dir = dataDir();
	private readonly file = join(this.dir, 'console.json');
	private readonly auditFile = join(this.dir, 'audit.jsonl');
	private cache: ConsoleFile | null = null;

	read(): ConsoleFile {
		if (this.cache) return this.cache;
		let data = emptyConsoleFile();
		if (existsSync(this.file)) data = consoleFileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
		if (!data.projects.length) data = this.seed(data);
		this.cache = data;
		return data;
	}

	write(next: ConsoleFile): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		const tmp = `${this.file}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(consoleFileSchema.parse(next), null, '\t')}\n`, { mode: 0o600 });
		renameSync(tmp, this.file);
		this.cache = next;
	}

	update(change: (file: ConsoleFile) => ConsoleFile): ConsoleFile {
		const next = change(structuredClone(this.read()));
		this.write(next);
		return next;
	}

	audit(projectId: string | null, action: string, detail: string): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		const entry: AuditEntry = { at: new Date().toISOString(), projectId, action, detail };
		appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
	}

	auditEntries(projectId: string | null): AuditEntry[] {
		if (!existsSync(this.auditFile)) return [];
		return readFileSync(this.auditFile, 'utf8')
			.split('\n')
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [auditEntrySchema.parse(JSON.parse(line))];
				} catch {
					return [];
				}
			})
			.filter((e) => projectId === null || e.projectId === projectId)
			.reverse();
	}

	/** First run with no projects: import the project described in `.release-console.json`. */
	private seed(data: ConsoleFile): ConsoleFile {
		const path = process.env['CONSOLE_SEED_FILE'] ?? findRepositoryFile();
		if (!path || !existsSync(path)) return data;
		try {
			const file = repositoryFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
			if (!file.project) return data;
			const usesCli = file.project.repositories.some((r) => r.sourceCode.keyId === 'github-cli');
			const project: Project = {
				...file.project,
				createdAt: new Date().toISOString(),
				keys: usesCli
					? [
							{
								id: 'github-cli',
								kind: 'github-cli',
								label: 'GitHub CLI sign-in on this computer',
								keychainItem: '',
								account: '',
								rights: [],
								expiresAt: null,
								checkedAt: null,
								state: 'unchecked',
								note: 'Uses the sign-in made with gh auth login; nothing is stored by the console.',
							},
						]
					: [],
			};
			const seeded: ConsoleFile = {
				...data,
				workspaces: [...new Set([...data.workspaces, project.workspace])],
				projects: [project],
			};
			this.write(seeded);
			this.audit(project.id, 'project-added', `${project.name} imported from .release-console.json`);
			return seeded;
		} catch (err) {
			this.logger.warn(`.release-console.json was not imported: ${(err as Error).message}`);
			return data;
		}
	}
}
