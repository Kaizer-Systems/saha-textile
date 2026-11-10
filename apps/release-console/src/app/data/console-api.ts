import { Injectable } from '@angular/core';

import {
	type Readiness,
	type ServicesSnapshot,
	readinessSchema,
	servicesSnapshotSchema,
} from '@saha-textile/release-console-contracts';

import type { z } from 'zod';

/** The console's local API on this computer. Every answer is checked against the shared contracts. */
export const CONSOLE_API = 'http://127.0.0.1:4410';

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
	const res = await fetch(`${CONSOLE_API}${path}`, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`${path} answered ${res.status}`);
	return schema.parse(await res.json());
}

@Injectable({ providedIn: 'root' })
export class ConsoleApi {
	localServices(): Promise<ServicesSnapshot> {
		return getJson('/api/local/services', servicesSnapshotSchema);
	}

	localReadiness(): Promise<Readiness> {
		return getJson('/api/local/readiness', readinessSchema);
	}
}
