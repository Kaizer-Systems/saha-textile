import { constants, createCipheriv, createDecipheriv, publicEncrypt, randomBytes } from 'node:crypto';

/**
 * NIC's session encryption, shared by the e-invoice IRPs (API v1.03/v1.04) and the e-way bill system (v1.03):
 * the sign-in JSON is base64-encoded, then RSA-encrypted (PKCS#1 v1.5) with the government's public key; the
 * session key (SEK) comes back AES-256-ECB-encrypted with our random app key; every later payload is
 * AES-256-ECB-encrypted with the SEK. (ECB is NIC's choice, not ours; the channel is TLS as well.)
 */

/** A fresh 32-byte app key for one session. */
export const newAppKey = (): Buffer => randomBytes(32);

/** RSA-encrypt (PKCS#1 v1.5) a text with the government public key; returns base64. */
export function rsaEncryptBase64(publicKeyPem: string, text: string): string {
	return publicEncrypt(
		{ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
		Buffer.from(text, 'utf8'),
	).toString('base64');
}

const cipherName = (key: Buffer): string => {
	if (key.length === 32) return 'aes-256-ecb';
	if (key.length === 16) return 'aes-128-ecb';
	throw new Error('edoc_key_length');
};

export function aesEcbEncrypt(key: Buffer, data: Buffer): string {
	const cipher = createCipheriv(cipherName(key), key, null);
	return Buffer.concat([cipher.update(data), cipher.final()]).toString('base64');
}

export function aesEcbDecrypt(key: Buffer, base64: string): Buffer {
	const decipher = createDecipheriv(cipherName(key), key, null);
	return Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]);
}

/** The SEK as sent by NIC (base64, encrypted with the app key) → the raw key bytes. */
export const decryptSek = (encryptedSek: string, appKey: Buffer): Buffer => aesEcbDecrypt(appKey, encryptedSek);

/** E-invoice: the JSON bytes are encrypted with the SEK. */
export const encryptEInvoicePayload = (sek: Buffer, json: unknown): string =>
	aesEcbEncrypt(sek, Buffer.from(JSON.stringify(json), 'utf8'));
export const decryptEInvoicePayload = (sek: Buffer, data: string): unknown =>
	JSON.parse(aesEcbDecrypt(sek, data).toString('utf8'));

/** E-way bill: the JSON is base64-encoded first, then encrypted with the SEK (Encrypt(Base64(JSON), sek)). */
export const encryptEWayBillPayload = (sek: Buffer, json: unknown): string =>
	aesEcbEncrypt(sek, Buffer.from(Buffer.from(JSON.stringify(json), 'utf8').toString('base64'), 'utf8'));
export function decryptEWayBillPayload(sek: Buffer, data: string): unknown {
	const inner = aesEcbDecrypt(sek, data).toString('utf8').trim();
	// The response is Base64(JSON) inside the encryption; tolerate a plain JSON body as well.
	return JSON.parse(
		inner.startsWith('{') || inner.startsWith('[') ? inner : Buffer.from(inner, 'base64').toString('utf8'),
	);
}
