import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type AuditEntry, auditEntrySchema } from '@saha-textile/release-console-contracts';

import { type ConsoleFile, consoleFileSchema, emptyConsoleFile } from './console-file.js';

/** Where the console keeps its database: `CONSOLE_DATA_DIR`, or the Mac's Application Support folder. */
export function dataDir(): string {
	return process.env['CONSOLE_DATA_DIR'] ?? join(homedir(), 'Library', 'Application Support', 'Release Console');
}

/** Each step brings the database one version forward; the version is kept in `user_version`. */
const MIGRATIONS = [
	`CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
	 CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, project_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
	 CREATE INDEX audit_project ON audit (project_id, id);`,
	`CREATE TABLE samples (ts INTEGER NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL);
	 CREATE INDEX samples_lookup ON samples (source, name, ts);
	 CREATE TABLE runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, json TEXT NOT NULL);`,
	`CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, rule TEXT NOT NULL, subject TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, fired_at TEXT NOT NULL, resolved_at TEXT);
	 CREATE INDEX alerts_open ON alerts (resolved_at, rule, subject);`,
	`CREATE TABLE requests (minute INTEGER NOT NULL, service TEXT NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, count INTEGER NOT NULL, e5 INTEGER NOT NULL, e4 INTEGER NOT NULL, buckets TEXT NOT NULL);
	 CREATE INDEX requests_minute ON requests (minute);`,
	`CREATE TABLE not_found (minute INTEGER NOT NULL, route TEXT NOT NULL, referrer TEXT NOT NULL, count INTEGER NOT NULL);
	 CREATE INDEX not_found_minute ON not_found (minute);`,
	`CREATE TABLE client_builds (minute INTEGER NOT NULL, service TEXT NOT NULL, build TEXT NOT NULL, installed INTEGER NOT NULL, count INTEGER NOT NULL);
	 CREATE INDEX client_builds_minute ON client_builds (minute);`,
];

/**
 * The console's own database: one SQLite file (`console.db`) in the data folder, readable by the
 * owner only. It holds projects, key links (never key values), the PIN hash, the lock state, the
 * audit trail, stats history and run history. A first start imports an older `console.json` and
 * `audit.jsonl`, then renames them.
 */
@Injectable()
export class ConsoleStore implements OnModuleDestroy {
	private readonly dir = dataDir();
	private handle: DatabaseSync | null = null;
	private cache: ConsoleFile | null = null;

	/** The open database, created and brought up to date on first use. */
	db(): DatabaseSync {
		if (this.handle) return this.handle;
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		const file = join(this.dir, 'console.db');
		const db = new DatabaseSync(file);
		chmodSync(file, 0o600);
		db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
		const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
		for (let v = version; v < MIGRATIONS.length; v++) {
			db.exec('BEGIN');
			db.exec(MIGRATIONS[v] ?? '');
			db.exec(`PRAGMA user_version = ${v + 1}`);
			db.exec('COMMIT');
		}
		this.handle = db;
		this.importLegacy(db);
		return db;
	}

	onModuleDestroy(): void {
		this.handle?.close();
		this.handle = null;
	}

	read(): ConsoleFile {
		if (this.cache) return this.cache;
		const row = this.db().prepare('SELECT json FROM state WHERE id = 1').get() as { json: string } | undefined;
		this.cache = row ? consoleFileSchema.parse(JSON.parse(row.json)) : emptyConsoleFile();
		return this.cache;
	}

	write(next: ConsoleFile): void {
		const parsed = consoleFileSchema.parse(next);
		this.db()
			.prepare('INSERT INTO state (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json')
			.run(JSON.stringify(parsed));
		this.cache = parsed;
	}

	update(change: (file: ConsoleFile) => ConsoleFile): ConsoleFile {
		const next = change(structuredClone(this.read()));
		this.write(next);
		return this.read();
	}

	audit(projectId: string | null, action: string, detail: string): void {
		this.db()
			.prepare('INSERT INTO audit (at, project_id, action, detail) VALUES (?, ?, ?, ?)')
			.run(new Date().toISOString(), projectId, action, detail);
	}

	/** Newest first; one project's entries, or every entry when `projectId` is null. */
	auditEntries(projectId: string | null, limit = 500): AuditEntry[] {
		const rows = (
			projectId === null
				? this.db()
						.prepare('SELECT at, project_id, action, detail FROM audit ORDER BY id DESC LIMIT ?')
						.all(limit)
				: this.db()
						.prepare(
							'SELECT at, project_id, action, detail FROM audit WHERE project_id = ? ORDER BY id DESC LIMIT ?',
						)
						.all(projectId, limit)
		) as { at: string; project_id: string | null; action: string; detail: string }[];
		return rows.flatMap((r) => {
			const parsed = auditEntrySchema.safeParse({
				at: r.at,
				projectId: r.project_id,
				action: r.action,
				detail: r.detail,
			});
			return parsed.success ? [parsed.data] : [];
		});
	}

	/** Moves an older file-based console into the database once, keeping the old files renamed. */
	private importLegacy(db: DatabaseSync): void {
		const jsonFile = join(this.dir, 'console.json');
		const auditFile = join(this.dir, 'audit.jsonl');
		const hasState = db.prepare('SELECT 1 FROM state WHERE id = 1').get() !== undefined;
		if (!hasState && existsSync(jsonFile)) {
			const parsed = consoleFileSchema.safeParse(JSON.parse(readFileSync(jsonFile, 'utf8')));
			if (parsed.success) {
				db.prepare('INSERT INTO state (id, json) VALUES (1, ?)').run(JSON.stringify(parsed.data));
				renameSync(jsonFile, `${jsonFile}.imported`);
			}
		}
		if (existsSync(auditFile)) {
			const insert = db.prepare('INSERT INTO audit (at, project_id, action, detail) VALUES (?, ?, ?, ?)');
			for (const line of readFileSync(auditFile, 'utf8').split('\n').filter(Boolean)) {
				try {
					const e = auditEntrySchema.parse(JSON.parse(line));
					insert.run(e.at, e.projectId, e.action, e.detail);
				} catch {
					/* a damaged line is skipped */
				}
			}
			renameSync(auditFile, `${auditFile}.imported`);
		}
	}
}
