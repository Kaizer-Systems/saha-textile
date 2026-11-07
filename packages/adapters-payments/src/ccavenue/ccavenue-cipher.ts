import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const ALGORITHM = 'aes-128-cbc';

/** Fixed by CCAvenue: every integration kit uses these bytes for every message. */
const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

const AES_BLOCK_HEX_LENGTH = 32;

/** Thrown for every decryption failure alike, so no caller can learn which step failed. */
export class CcavenueDecryptionError extends Error {
	constructor() {
		super('CCAvenue ciphertext could not be decrypted');
		this.name = 'CcavenueDecryptionError';
	}
}

/**
 * The encryption every CCAvenue kit implements: AES-128-CBC with PKCS#7 padding, the key being
 * the 16 raw bytes of MD5(working key), ciphertext in hex.
 *
 * The derived key sits in an ES private field, which `JSON.stringify` and `util.inspect` cannot
 * reach, so logging an object that holds this cipher cannot print it. The working key itself
 * is not kept.
 *
 * This scheme has no authentication tag and a fixed IV. Decrypting proves little on its own,
 * which is why a callback only counts next to a direct status enquiry.
 */
export class CcavenueCipher {
	readonly #key: Buffer;

	constructor(workingKey: string) {
		this.#key = createHash('md5').update(workingKey, 'utf8').digest();
	}

	encrypt(plainText: string): string {
		const cipher = createCipheriv(ALGORITHM, this.#key, IV);
		return Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]).toString('hex');
	}

	decrypt(cipherHex: string): string {
		if (!/^[0-9a-fA-F]+$/.test(cipherHex) || cipherHex.length % AES_BLOCK_HEX_LENGTH !== 0) {
			throw new CcavenueDecryptionError();
		}
		try {
			const decipher = createDecipheriv(ALGORITHM, this.#key, IV);
			const bytes = Buffer.concat([decipher.update(cipherHex, 'hex'), decipher.final()]);
			return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new CcavenueDecryptionError();
		}
	}
}
