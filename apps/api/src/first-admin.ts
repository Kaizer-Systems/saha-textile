import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import type { AuditLog } from '@saha-textile/contracts';
import {
	type AdminUserAuthRepository,
	type AuditLogRepository,
	type AuthPort,
	type RoleRepository,
	type UserRoleAssignmentRepository,
	evaluatePassword,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_AUTH_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	AUTH_PORT,
	ROLE_REPOSITORY,
	USER_ROLE_ASSIGNMENT_REPOSITORY,
} from './infra/tokens';

/**
 * First-administrator bootstrap (auth pass 6a).
 *
 * ## Why this is not a route
 *
 * Every other way into the administration surface requires an administrator to already exist:
 * invites are `admin`-only, and role assignment is deny-by-default. That is correct, and it
 * leaves exactly one hole — the first one. A public route to fill it would be an unauthenticated
 * endpoint that mints total authority, guarded by nothing but the hope that it is disabled in
 * production. Instead this is an OPERATOR action: it needs a shell on the machine and the
 * database credentials, which is a boundary the network cannot cross.
 *
 * ## Impossible to re-run, not merely idempotent
 *
 * It refuses whenever administrative authority ALREADY EXISTS anywhere — a live admin-tier
 * assignment, or any account carrying the `admin` coarse role. So the second invocation is a
 * refusal rather than a no-op, and there is no window in which it quietly mints a second
 * unaccounted administrator. Once the first administrator exists, further ones come through
 * invite and grant, where they are attributable to somebody.
 *
 * ## The password is generated, never supplied
 *
 * Taking a password as an argument would put it in shell history, in the process table, and
 * quite possibly in a CI log. One is generated, printed once by the caller, and never stored
 * in plaintext — the returned value is the only copy that ever exists outside the hash.
 */
export interface FirstAdminResult {
	userId: string;
	email: string;
	/** Shown once by the caller. Never persisted, never logged, never audited. */
	password: string;
	roleKey: string;
}

export class FirstAdminAlreadyExistsError extends Error {
	constructor(readonly detail: string) {
		super(`Administrative authority already exists (${detail}); bootstrap refuses to run again`);
		this.name = 'FirstAdminAlreadyExistsError';
	}
}

/**
 * A password long enough that the policy floor is irrelevant, from a CSPRNG.
 *
 * `base64url` so it survives copy-paste, shell quoting and a password manager without the
 * operator having to think about escaping — a bootstrap credential that gets mangled in
 * transit is a bootstrap credential that gets replaced by something weaker.
 *
 * ## The assertion, and what it is honestly worth
 *
 * Twenty-four CSPRNG bytes cannot fail `evaluatePassword` today: the output is far past the
 * length floor, has no repeating unit, and cannot normalise onto a denylisted word. So this
 * check will not fire, and a check that cannot fire earns its place only as a TRIPWIRE — if
 * somebody later shortens the token, or swaps in a memorable-words generator, the account
 * with the most authority in the system stops being the one account exempt from the policy
 * every other account is held to. It sits inside the generator rather than at the call site
 * so it travels with the thing it guards.
 */
function generatePassword(): string {
	const password = randomBytes(24).toString('base64url');

	const decision = evaluatePassword(password);
	if (!decision.acceptable) {
		// Never echo the password, not even into an operator's terminal on a failure path.
		throw new Error(`The generated bootstrap password does not satisfy the password policy (${decision.refusal})`);
	}

	return password;
}

export interface FirstAdminDependencies {
	/** Mongo models, injected so this file has no direct database dependency. */
	models: {
		AdminUserModel: {
			findOne(filter: Record<string, unknown>): { lean(): { exec(): Promise<unknown> } };
			create(docs: unknown[]): Promise<unknown>;
		};
	};
	ensureSystemRoles: () => Promise<unknown>;
	administratorRoleKey: string;
}

/**
 * Creates the first administrator, or refuses because one already exists.
 *
 * Exported as a function rather than hidden inside the CLI so the end-to-end suite can drive
 * the REAL thing. A bootstrap proven only by a script nobody runs in anger is a bootstrap
 * whose refusal path has never executed.
 */
export async function bootstrapFirstAdmin(
	app: INestApplicationContext,
	input: { email: string },
	deps: FirstAdminDependencies,
): Promise<FirstAdminResult> {
	const roles = app.get<RoleRepository>(ROLE_REPOSITORY);
	const assignments = app.get<UserRoleAssignmentRepository>(USER_ROLE_ASSIGNMENT_REPOSITORY);
	const audit = app.get<AuditLogRepository>(AUDIT_LOG_REPOSITORY);
	const auth = app.get<AuthPort>(AUTH_PORT);

	// Roles first: the assignment below needs the administrator role to exist, and seeding is
	// idempotent, so a half-finished earlier attempt does not block a retry.
	await deps.ensureSystemRoles();

	const administrator = await roles.findByKey(deps.administratorRoleKey);
	if (!administrator) throw new Error(`System role "${deps.administratorRoleKey}" is missing after seeding`);

	// Refusal check one: does anybody already hold administrative authority through an
	// assignment? This is the model that actually confers permissions.
	const holders = await assignments.listActiveForRole(administrator.id);
	if (holders.length > 0) {
		throw new FirstAdminAlreadyExistsError(`${holders.length} live administrator assignment(s)`);
	}

	// Refusal check two: an account carrying the coarse `admin` role but no assignment yet.
	// It cannot reach the deny-by-default surfaces, but it CAN sign in to the admin audience,
	// so treating it as "no administrator exists" would mint a second privileged account
	// beside one somebody already created.
	const existingAdmin = await deps.models.AdminUserModel.findOne({ role: 'admin' }).lean().exec();
	if (existingAdmin) throw new FirstAdminAlreadyExistsError('an account already holds the admin role');

	const emailNormalized = input.email.trim().toLowerCase();
	const password = generatePassword();
	const userId = `adm_${randomUUID()}`;
	const now = new Date();

	const passwordHash = await auth.hashPassword(password);
	await deps.models.AdminUserModel.create([
		{
			_id: userId,
			email: emailNormalized,
			emailVerified: true,
			role: 'admin',
			status: 'active',
			permissions: [],
			tokenVersion: 0,
			permissionsVersion: 0,
			createdAt: now,
			updatedAt: now,
		},
	]);
	const adminAuth = app.get<AdminUserAuthRepository>(ADMIN_USER_AUTH_REPOSITORY);
	await adminAuth.setPasswordHash(userId, passwordHash);

	await assignments.assign({
		id: `ura_${randomUUID()}`,
		userId,
		roleId: administrator.id,
		// Null, not the new user: nobody granted this, the operator bootstrapped it. Recording
		// the account as its own grantor would fabricate a delegation that never happened.
		assignedByUserId: null,
		assignedAt: now.toISOString(),
		revokedAt: null,
		revokedByUserId: null,
		revokeReason: null,
	});

	const entry: AuditLog = {
		id: `audit_${randomUUID()}`,
		actorUserId: null,
		targetUserId: userId,
		audience: 'admin',
		action: 'admin.bootstrap.first_administrator',
		entityType: 'user',
		entityId: userId,
		// The single most privileged event this system can record.
		severity: 'critical',
		retentionTier: 'financial_security',
		diffs: [
			{ field: 'role', after: 'admin' },
			{ field: 'roleKey', after: administrator.key },
			{ field: 'emailNormalized', after: emailNormalized },
		],
		metadata: { via: 'operator-cli' },
		requestId: null,
		ipHash: null,
		userAgentHash: null,
		createdAt: now.toISOString(),
	};
	await audit.append(entry);

	return { userId, email: emailNormalized, password, roleKey: administrator.key };
}
