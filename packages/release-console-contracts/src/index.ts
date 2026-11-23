/**
 * Shapes shared by the Release Console (Angular), its local API (NestJS) and the server agent.
 * Every response the console reads is parsed with these schemas, so a changed field fails loudly.
 */
import { z } from 'zod';

/** The three places the console looks at. */
export const consoleEnvironmentSchema = z.enum(['local', 'staging', 'production']);
export type ConsoleEnvironment = z.infer<typeof consoleEnvironmentSchema>;

/** One container as the console shows it on the Services screen. */
export const serviceStatusSchema = z.object({
	name: z.string().min(1),
	image: z.string(),
	state: z.enum(['running', 'restarting', 'paused', 'exited', 'created', 'dead', 'removing']),
	health: z.enum(['healthy', 'unhealthy', 'starting', 'none']),
	uptime: z.string(),
	cpuPercent: z.number().nonnegative().nullable(),
	memoryBytes: z.number().int().nonnegative().nullable(),
	memoryLimitBytes: z.number().int().nonnegative().nullable(),
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/** Every container in one environment, read at one moment. */
export const servicesSnapshotSchema = z.object({
	environment: consoleEnvironmentSchema,
	readAt: z.string().datetime(),
	services: z.array(serviceStatusSchema),
});
export type ServicesSnapshot = z.infer<typeof servicesSnapshotSchema>;

/** The shop API's readiness, as `/health/ready` reports it. */
export const readinessSchema = z.object({
	environment: consoleEnvironmentSchema,
	reachable: z.boolean(),
	status: z.enum(['ok', 'degraded', 'down', 'unknown']),
	checkedAt: z.string().datetime(),
	detail: z.record(z.string(), z.unknown()).optional(),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** The console API's own liveness answer. */
export const consoleApiHealthSchema = z.object({ status: z.literal('ok'), version: z.string() });
export type ConsoleApiHealth = z.infer<typeof consoleApiHealthSchema>;

export * from './projects.js';
export * from './local.js';
export * from './secrets-place.js';
export * from './release-manifest.js';
export * from './server-deploy.js';
export * from './seo.js';
export * from './clients.js';
export * from './ops.js';
export * from './do-catalog.js';
export * from './droplet-job.js';
export * from './env-labels.js';
export * from './rotation.js';
export * from './traces.js';
export * from './products.js';
