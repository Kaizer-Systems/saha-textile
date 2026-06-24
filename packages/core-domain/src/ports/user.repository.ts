import type { User } from '@saha/contracts';

/** Credential bundle kept inside the infra boundary (hash never leaves it lightly). */
export interface UserCredential {
	user: User;
	passwordHash: string | null;
}

export interface UserRepository {
	findById(id: string): Promise<User | null>;
	findByEmail(email: string): Promise<User | null>;
	findCredentialByEmail(email: string): Promise<UserCredential | null>;
	save(user: User): Promise<User>;
	setPasswordHash(userId: string, passwordHash: string): Promise<void>;
}
