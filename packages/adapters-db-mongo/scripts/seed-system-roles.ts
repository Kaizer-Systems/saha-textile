/**
 * Seeds the system roles. Idempotent, and safe to re-run — that is how a registry addition
 * reaches the administrator role.
 *
 * Deliberately a separate runner from `seed`: that one loads demo catalogue data and has no
 * business running against production, whereas this one must.
 *
 * Usage (from repo root, with apps/api/.env loaded or vars exported):
 *   MONGODB_PORT=27018 pnpm --filter @saha-textile/adapters-db-mongo seed:system-roles
 */
import { connectMongo, disconnectMongo } from '../src/connection';
import { ensureSystemRoles } from '../src/seed/system-roles';

async function main(): Promise<void> {
	await connectMongo();
	const result = await ensureSystemRoles();
	console.log('[seed:system-roles] created:', result.created, 'updated:', result.updated);
	await disconnectMongo();
}

main().catch((err: unknown) => {
	console.error('[seed:system-roles] failed:', err);
	process.exitCode = 1;
});
