import type { AdminUserRepository } from '@saha-textile/core-domain';

/**
 * The names admins know each other by ("19 Nov · Moulik", "Manager saved this first"): display
 * name, else username, else the part of the email before the @. Unknown or deleted ids are left out.
 */
export async function adminNames(
	admins: Pick<AdminUserRepository, 'findById'> | null | undefined,
	ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (!admins) return out;
	const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	await Promise.all(
		wanted.map(async (id) => {
			const admin = await admins.findById(id).catch(() => null);
			const name = admin?.displayName?.trim() || admin?.username || admin?.email?.split('@')[0];
			if (name) out.set(id, name);
		}),
	);
	return out;
}
