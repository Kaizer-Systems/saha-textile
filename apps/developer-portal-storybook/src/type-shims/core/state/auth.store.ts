import { Injectable, computed, signal } from '@angular/core';

/**
 * Compiler-only compatibility surface for the two application-local
 * `@core/state/auth.store` aliases. Webpack resolves the runtime import to the
 * correct Storefront or Admin signal store from the importing component's issuer.
 *
 * Why this exists: Storybook's tsconfig `@core/*` wildcard can resolve only one
 * of the two real stores. Admin UI needs `permissions` / `username` / `role`;
 * storefront UI needs `isAuthenticated` / `logout`. This shim is the union of
 * those presentation reads — never a third session policy.
 */
export type StorybookAuthUser = {
	id: string;
	email: string | null;
	emailVerified: boolean;
	displayName?: string;
	status: string;
	username?: string | null;
	role?: string;
	phone?: string | null;
	pinConfigured?: boolean;
	preferredLoginMethod?: string;
	lastLoginAt?: string | null;
};

export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';
export type AdminSessionStatus = SessionStatus;

@Injectable({ providedIn: 'root' })
export class AuthStore {
	readonly status = signal<SessionStatus>('unknown');
	readonly user = signal<StorybookAuthUser | null>(null);
	readonly permissions = signal<string[]>([]);
	readonly error = signal<string | null>(null);
	readonly pending = signal(false);

	readonly isAuthenticated = computed(() => this.status() === 'authenticated');
	readonly isResolving = computed(() => this.status() === 'unknown');
	readonly email = computed(() => this.user()?.email ?? '');
	readonly preferredLoginMethod = computed(() => this.user()?.preferredLoginMethod ?? 'password');

	async bootstrap(): Promise<void> {}
	async logout(): Promise<void> {}
	clearError(): void {}
}
