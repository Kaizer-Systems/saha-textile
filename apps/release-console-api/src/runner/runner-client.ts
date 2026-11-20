import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';

/** The Mac helper could not be reached or refused; the message is safe to show. */
export class HelperError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/**
 * Talks to the Mac helper (`pnpm console:runner`). In Docker it is `host.docker.internal:4419`;
 * outside Docker, `127.0.0.1:4419`. The token is the file the helper writes, mounted read-only.
 */
@Injectable()
export class RunnerClient {
	private readonly url = process.env['CONSOLE_RUNNER_URL'] ?? 'http://127.0.0.1:4419';

	private token(): string | null {
		const file =
			process.env['CONSOLE_RUNNER_TOKEN_FILE'] ??
			resolve(process.cwd(), '../../docker/release-console/env/runner-token');
		return existsSync(file) ? readFileSync(file, 'utf8').trim() || null : null;
	}

	async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeout = 30_000): Promise<T> {
		const token = this.token();
		if (!token)
			throw new HelperError('The Mac helper has not run yet. Start the console with pnpm console:up.', 503);
		let res: Response;
		try {
			res = await fetch(`${this.url}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(body === undefined ? {} : { 'content-type': 'application/json' }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(timeout),
			});
		} catch {
			throw new HelperError(
				'The Mac helper is not answering. Start it with pnpm console:up (or pnpm console:runner).',
				503,
			);
		}
		const data: unknown = await res.json().catch(() => null);
		if (!res.ok) {
			const message = data && typeof data === 'object' ? (data as Record<string, unknown>)['message'] : null;
			throw new HelperError(
				typeof message === 'string' ? message : `The Mac helper answered ${res.status}.`,
				res.status,
			);
		}
		return data as T;
	}
}
