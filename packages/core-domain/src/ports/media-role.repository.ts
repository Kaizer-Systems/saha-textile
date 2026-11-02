import type { MediaRoleDefinition } from '@saha-textile/contracts';

/** The editable size ladder (`mediaRoles`). Seeded roles are undeletable and unrenamable. */
export interface MediaRoleRepository {
	list(): Promise<MediaRoleDefinition[]>;
	findByKey(key: string): Promise<MediaRoleDefinition | null>;
	save(role: MediaRoleDefinition): Promise<MediaRoleDefinition>;
	/** Inserts any seed that is missing; never overwrites an operator's edits. */
	insertMissing(roles: readonly MediaRoleDefinition[]): Promise<number>;
}
