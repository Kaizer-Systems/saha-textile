import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { Injectable } from '@nestjs/common';
import { CONSOLE_KEYS_FOLDER, type KeySource } from '@saha-textile/release-console-contracts';

import { CONSOLE_KEY_NAMES, EITHER_ONE, OPTIONAL_KEY_NAMES } from './console-key-names.js';

/**
 * The console's key file: `CONSOLE_KEYS_FILE`, or `docker/release-console/env/console.env` beside the
 * repository when the console runs on the Mac outside Docker. Inside Docker it is mounted read-only
 * at `/run/secrets/console.env`.
 */
export function keysFile(): string {
	return process.env['CONSOLE_KEYS_FILE'] ?? resolve(process.cwd(), '../../docker/release-console/env/console.env');
}

/**
 * Reads key values from the key file that `pnpm console:env` writes from Infisical with the owner's
 * login. The file is read again whenever it changes, so a refresh needs no restart. Values stay in
 * this process; only names ever leave it.
 */
@Injectable()
export class KeySourceService {
	private cache: { mtimeMs: number; values: Map<string, string>; readAt: string } | null = null;

	private load(): Map<string, string> | null {
		const file = keysFile();
		if (!existsSync(file)) {
			this.cache = null;
			return null;
		}
		const mtimeMs = statSync(file).mtimeMs;
		if (this.cache?.mtimeMs !== mtimeMs) {
			const parsed = parseEnv(readFileSync(file, 'utf8'));
			const values = new Map(
				Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v.length > 0) as [string, string][],
			);
			this.cache = { mtimeMs, values, readAt: new Date(mtimeMs).toISOString() };
		}
		return this.cache?.values ?? null;
	}

	/** One name's value, or `null` when the file lacks it or holds it blank. */
	get(name: string): string | null {
		return this.load()?.get(name) ?? null;
	}

	/** The names with a value, the file's place and when it was written. Never a value. */
	describe(): KeySource {
		const values = this.load();
		const names = values ? [...values.keys()].sort() : [];
		const absent = CONSOLE_KEY_NAMES.filter((n) => !names.includes(n));
		const covered = (n: string) =>
			EITHER_ONE.some((pair) => pair.includes(n) && pair.some((m) => names.includes(m)));
		return {
			file: keysFile(),
			present: values !== null,
			readAt: values ? (this.cache?.readAt ?? null) : null,
			names,
			missing: absent.filter((n) => !OPTIONAL_KEY_NAMES.includes(n) && !covered(n)),
			optionalBlank: absent.filter((n) => OPTIONAL_KEY_NAMES.includes(n) || covered(n)),
			folder: CONSOLE_KEYS_FOLDER,
		};
	}
}
