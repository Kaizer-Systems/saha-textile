import type { AdminUser, PageQuery, Paginated } from '@saha-textile/contracts';

/**
 * Public operator persistence (`adminUsers` collection).
 *
 * Credential material and version counters are reachable only through
 * `AdminUserAuthRepository`. This port returns the sanitized `AdminUser` shape
 * (`DEC-ACCOUNT-SEPARATION` D3 — operators only).
 */
export interface AdminUserRepository {
	findById(id: string): Promise<AdminUser | null>;
	findByEmail(email: string): Promise<AdminUser | null>;
	findByUsername(username: string): Promise<AdminUser | null>;
	/** Paginated operator directory for `GET /admin/users`. */
	list(query: PageQuery): Promise<Paginated<AdminUser>>;
	save(adminUser: AdminUser): Promise<AdminUser>;
}
