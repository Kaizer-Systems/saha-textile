import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

import { KEYCHAIN_SERVICE, KeychainPort } from './keychain.port.js';

const run = promisify(execFile);

/** Characters that could end or bend a quoted argument in `security -i`. */
const UNSAFE = /["\\\n\r\0]/;

/**
 * The macOS login Keychain through `/usr/bin/security`. A value is written with `security -i`
 * and the command on standard input, so it never appears in the list of running processes.
 */
@Injectable()
export class MacKeychain extends KeychainPort {
	async set(account: string, value: string): Promise<void> {
		if (UNSAFE.test(account) || UNSAFE.test(value))
			throw new Error('The key or its name has a character the Keychain call cannot take.');
		const command = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -l "${KEYCHAIN_SERVICE} · ${account}" -w "${value}"\n`;
		await new Promise<void>((resolve, reject) => {
			const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
			let err = '';
			child.stderr.on('data', (d: Buffer) => (err += d.toString()));
			child.on('error', reject);
			child.on('close', (code) =>
				code === 0 && !err.trim()
					? resolve()
					: reject(new Error(`Keychain refused the item (${code ?? 'signal'}).`)),
			);
			child.stdin.end(command);
		});
	}

	async get(account: string): Promise<string | null> {
		try {
			const { stdout } = await run(
				'/usr/bin/security',
				['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
				{
					timeout: 10_000,
				},
			);
			return stdout.replace(/\n$/, '');
		} catch {
			return null;
		}
	}

	async remove(account: string): Promise<void> {
		await run('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account], {
			timeout: 10_000,
		}).catch(() => undefined);
	}
}
