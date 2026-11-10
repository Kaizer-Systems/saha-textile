/** Where key values live. On the Mac this is the login Keychain; tests use an in-memory version. */
export abstract class KeychainPort {
	abstract set(account: string, value: string): Promise<void>;
	abstract get(account: string): Promise<string | null>;
	abstract remove(account: string): Promise<void>;
}

/** Every Release Console item uses this Keychain service name. */
export const KEYCHAIN_SERVICE = 'Release Console';
