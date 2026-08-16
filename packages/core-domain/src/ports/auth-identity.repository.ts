/**
 * Login identity links — `authIdentities` (auth plan §7.2).
 *
 * An identity is `provider + stable provider subject`, never an email. Email is a mutable
 * attribute of a person; keying on it is how two accounts silently become one.
 *
 * `subjectType` keeps the two populations apart at the storage layer as well as the policy
 * layer: an identity attached to an operator must never open a customer session, and a lookup
 * that forgot to check would be a cross-population authentication.
 */

export type IdentitySubjectType = 'customer' | 'admin_user';

export interface AuthIdentity {
	id: string;
	subjectType: IdentitySubjectType;
	subjectId: string;
	provider: string;
	/** Google `sub`, Facebook app-scoped id. Unique with `provider`. */
	providerSubject: string;
	/** Bounded snapshot for display only — never used to find or match an account. */
	email: string | null;
	linkedAt: string;
	lastUsedAt: string | null;
}

export interface AuthIdentityRepository {
	/** The identity lookup. Unique on the pair, so this returns at most one. */
	findByProviderSubject(provider: string, providerSubject: string): Promise<AuthIdentity | null>;

	listForSubject(subjectType: IdentitySubjectType, subjectId: string): Promise<AuthIdentity[]>;

	/**
	 * Attaches an identity.
	 *
	 * Rejects when the pair already exists — the unique index enforces it, and callers are
	 * expected to translate that into a refusal rather than surfacing a duplicate-key error.
	 */
	link(identity: AuthIdentity): Promise<AuthIdentity>;

	/** Detaches one provider from one subject. Returns false when there was nothing to remove. */
	unlink(subjectType: IdentitySubjectType, subjectId: string, provider: string): Promise<boolean>;

	touch(id: string, usedAt: string): Promise<void>;
}
