import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CcavenueCipher, CcavenueDecryptionError } from '../src/ccavenue/ccavenue-cipher';
import { TEST_WORKING_KEY, encryptBytesForTest } from './support';

/**
 * Known answers made with the OpenSSL command line, not with this code:
 *
 *   KEY=$(printf %s "$WORKING_KEY" | openssl dgst -md5 -r | cut -d' ' -f1)
 *   printf %s "$PLAIN" | openssl enc -aes-128-cbc -K "$KEY" -iv 000102030405060708090a0b0c0d0e0f | xxd -p
 */
const KNOWN_ANSWERS = [
	{
		label: 'a transaction request',
		plain: 'merchant_id=123456&order_id=attempt-1&currency=INR&amount=1499.00&redirect_url=https://api.example.test/payments/return&cancel_url=https://api.example.test/payments/return&language=EN&',
		cipher: 'ab2fad998c7124d054d8a7e8bf9ec09e504c103146aba15381ffc4434861dda102490c0b809c71b9e4898dff60fa1abd6e420a1aee2e8b9d6dc9171dc0cdc7316ceebd936fef1ebbb119b4c27b2f6d59e4f0053b28a0aa3052490488870a4798c21ca9f1c590ae1011da2701d97e7ab5668ecccc18c573b9233b9bb03e86aa0154828dfcf10be6f4900b76e55ba07a7c60b1eb0adee5742c86acda381d1b8266f3e4636bdab38fa96c6227967a656f31e9bc07d2e31c3f36fc27e9d0e74d4f1d',
	},
	{
		label: 'a merchant API request',
		plain: '{"reference_no":"311008298114","order_no":"attempt-1"}',
		cipher: 'f08ebed3bedebc14e405931e69a2ceaefd3f97727abdab4e79038d730f2e78b5a8f8c01cd5f393971155fb3ce4573fb97c80faad2370c13bacfd8e68c930f942',
	},
	{
		label: 'text outside ASCII',
		plain: 'रेशम साड़ी',
		cipher: '382c98c23db594e49b808223f6eec201a433b13b95336b0a8d67e6d392c3e7a0',
	},
];

describe('CcavenueCipher', () => {
	const cipher = new CcavenueCipher(TEST_WORKING_KEY);

	it.each(KNOWN_ANSWERS)('matches OpenSSL for $label', ({ plain, cipher: expected }) => {
		expect(cipher.encrypt(plain)).toBe(expected);
		expect(cipher.decrypt(expected)).toBe(plain);
	});

	it('reads the uppercase hex printed in the API guide', () => {
		const [answer] = KNOWN_ANSWERS;
		expect(cipher.decrypt(answer!.cipher.toUpperCase())).toBe(answer!.plain);
	});

	it('round-trips with any key', () => {
		const other = new CcavenueCipher('00000000000000000000000000000001');
		expect(other.decrypt(other.encrypt('amount=1.00'))).toBe('amount=1.00');
		expect(other.encrypt('amount=1.00')).not.toBe(cipher.encrypt('amount=1.00'));
	});

	const flipLastByte = (hex: string): string => `${hex.slice(0, -2)}${hex.endsWith('00') ? '01' : '00'}`;
	const validBlock = cipher.encrypt('amount=1.00');

	it.each([
		['an empty string', ''],
		['text that is not hex', 'zz'.repeat(16)],
		['a length that is not a whole block', validBlock.slice(0, -2)],
		['broken padding', flipLastByte(validBlock)],
		['the wrong key', new CcavenueCipher('00000000000000000000000000000001').encrypt('amount=1.00')],
	])('raises one error for %s', (_label, value) => {
		expect(() => cipher.decrypt(value)).toThrow(CcavenueDecryptionError);
		expect(() => cipher.decrypt(value)).toThrow('CCAvenue ciphertext could not be decrypted');
	});

	it('refuses bytes that are not valid UTF-8', () => {
		const invalidUtf8 = encryptBytesForTest(Buffer.from([0xff, 0xfe, 0xfd]));
		expect(() => cipher.decrypt(invalidUtf8)).toThrow(CcavenueDecryptionError);
	});

	it('cannot be made to print its key', () => {
		const printed = `${JSON.stringify(cipher)} ${inspect(cipher, { showHidden: true, depth: 8 })}`;
		expect(printed).not.toContain(TEST_WORKING_KEY);
		expect(printed).not.toContain('5555ea9ce32c5293a40514e9484b45c3');
	});
});
