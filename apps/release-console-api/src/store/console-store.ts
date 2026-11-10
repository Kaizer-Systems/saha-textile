import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { type AuditEntry, auditEntrySchema } from '@saha-textile/release-console-contracts';

import { type ConsoleFile, consoleFileSchema, emptyConsoleFile } from './console-file.js';

/** Where the console keeps its file: `CONSOLE_DATA_DIR`, or the Mac's Application Support folder. */
export function dataDir(): string {
	return process.env['CONSOLE_DATA_DIR'] ?? join(homedir(), 'Library', 'Application Support', 'Release Console');
}

/**
 * Reads and writes the console file. It starts empty: the owner adds every project with
 * Add a project; nothing is imported on its own. Every write goes to a temporary file first and is then
 * renamed, so a crash never leaves half a file. Files are readable by the owner only.
 */
@Injectable()
export class ConsoleStore {
	private readonly dir = dataDir();
	private readonly file = join(this.dir, 'console.json');
	private readonly auditFile = join(this.dir, 'audit.jsonl');
	private cache: ConsoleFile | null = null;

	read(): ConsoleFile {
		if (this.cache) return this.cache;
		let data = emptyConsoleFile();
		if (existsSync(this.file)) data = consoleFileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
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
}
