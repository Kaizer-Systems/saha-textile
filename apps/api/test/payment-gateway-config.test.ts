import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { CcavenuePaymentGateway } from '@saha-textile/adapters-payments';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/app-config';
import { deploymentHardeningProblems } from '../src/config/deployment-hardening';
import { buildInrPaymentGateway } from '../src/infra/payment-gateway-factory';
import { UnavailablePaymentGateway } from '../src/infra/unavailable-payment-gateway.adapter';

const baseEnv = {
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
};

/** Generated per run. It has never been a CCAvenue key. */
const workingKey = randomBytes(16).toString('hex');

const ccavenueEnv = {
	CCAVENUE_MERCHANT_ID: '123456',
	CCAVENUE_ACCESS_CODE: 'TESTACCESSCODE',
	CCAVENUE_WORKING_KEY: workingKey,
	CCAVENUE_RETURN_URL: 'https://api.example.test/payments/return',
};

const load = (overrides: Record<string, string | undefined> = {}) =>
	loadConfig({ ...baseEnv, ...ccavenueEnv, ...overrides } as NodeJS.ProcessEnv);

describe('CCAvenue configuration', () => {
	it('is unconfigured, and still boots, when no CCAvenue variable is set', () => {
		expect(loadConfig(baseEnv as NodeJS.ProcessEnv).payments.ccavenue).toEqual({
			configured: false,
			baseUrl: 'https://test.ccavenue.com',
			apiUrl: 'https://apitest.ccavenue.com',
		});
	});

	it('treats blank variables as unset', () => {
		const blanks = Object.fromEntries(Object.keys(ccavenueEnv).map((name) => [name, '']));
		expect(load(blanks).payments.ccavenue.configured).toBe(false);
	});

	it('defaults to the test hosts when configured', () => {
		expect(load().payments.ccavenue).toMatchObject({
			configured: true,
			baseUrl: 'https://test.ccavenue.com',
			apiUrl: 'https://apitest.ccavenue.com',
		});
	});

	it('reads host overrides', () => {
		const hosts = {
			CCAVENUE_BASE_URL: 'https://secure.ccavenue.com',
			CCAVENUE_API_URL: 'https://api.ccavenue.com',
		};
		expect(load(hosts).payments.ccavenue).toMatchObject({
			baseUrl: 'https://secure.ccavenue.com',
			apiUrl: 'https://api.ccavenue.com',
		});
	});

	it.each(Object.keys(ccavenueEnv))('refuses to boot when %s alone is missing, and names it', (missing) => {
		expect(() => load({ [missing]: undefined })).toThrow(new RegExp(missing));
	});

	it('never repeats the working key in a boot failure', () => {
		let printed = '';
		try {
			load({ CCAVENUE_MERCHANT_ID: undefined });
		} catch (error) {
			printed = inspect(error, { depth: 8 });
		}
		expect(printed).toContain('CCAVENUE_MERCHANT_ID');
		expect(printed).not.toContain(workingKey);
	});
});

describe('CCAvenue hosts in a strict deployment', () => {
	const strictEnv = {
		...baseEnv,
		...ccavenueEnv,
		NODE_ENV: 'production',
	};

	const problems = (deployEnv: string, overrides: Record<string, string> = {}): string[] => {
		const env = { ...strictEnv, DEPLOY_ENV: deployEnv, ...overrides } as NodeJS.ProcessEnv;
		const config = parseWithoutHardening(env);
		return deploymentHardeningProblems(config, env).filter((problem) => problem.includes('CCAVENUE'));
	};

	const live = { CCAVENUE_BASE_URL: 'https://secure.ccavenue.com', CCAVENUE_API_URL: 'https://api.ccavenue.com' };

	it('refuses test hosts in production', () => {
		expect(problems('production')).toEqual([
			'CCAVENUE_BASE_URL must not be a CCAvenue test host in production.',
			'CCAVENUE_API_URL must not be a CCAvenue test host in production.',
		]);
	});

	it('accepts live hosts in production', () => {
		expect(problems('production', live)).toEqual([]);
	});

	it('refuses live hosts on staging', () => {
		expect(problems('staging', live)).toEqual([
			'CCAVENUE_BASE_URL must be a CCAvenue test host on staging.',
			'CCAVENUE_API_URL must be a CCAvenue test host on staging.',
		]);
	});

	it('accepts test hosts on staging', () => {
		expect(problems('staging')).toEqual([]);
	});

	it('has nothing to say while CCAvenue is unconfigured', () => {
		const env = { ...baseEnv, NODE_ENV: 'production', DEPLOY_ENV: 'production' } as NodeJS.ProcessEnv;
		const unconfigured = deploymentHardeningProblems(parseWithoutHardening(env), env);
		expect(unconfigured.filter((problem) => problem.includes('CCAVENUE'))).toEqual([]);
	});
});

/** `loadConfig` throws on hardening problems, and these tests want to read them instead. */
function parseWithoutHardening(env: NodeJS.ProcessEnv) {
	return {
		...loadConfig({ ...env, NODE_ENV: 'test', DEPLOY_ENV: 'local' }),
		nodeEnv: 'production' as const,
		deployEnv: env.DEPLOY_ENV as 'production' | 'staging',
	};
}

describe('the INR gateway binding', () => {
	it('builds the CCAvenue adapter once configured', () => {
		const gateway = buildInrPaymentGateway(load());
		expect(gateway).toBeInstanceOf(CcavenuePaymentGateway);
		expect(gateway.gateway).toBe('ccavenue');
	});

	it('binds a clear refusal while unconfigured', async () => {
		const gateway = buildInrPaymentGateway(loadConfig(baseEnv as NodeJS.ProcessEnv));
		expect(gateway).toBeInstanceOf(UnavailablePaymentGateway);
		expect(gateway.gateway).toBe('ccavenue');
		const calls = [
			() =>
				gateway.createPayment({
					attemptId: 'a',
					amountMinor: 100,
					currency: 'INR',
					returnUrl: 'https://x.test',
				}),
			() => gateway.verifyCallback({}),
			() => gateway.fetchPaymentStatus({ attemptId: 'a' }),
			() =>
				gateway.refundPayment({ gatewayReference: '1', refundReference: 'r', amountMinor: 1, currency: 'INR' }),
			() => gateway.fetchRefunds('1'),
		];
		for (const call of calls) {
			await expect(call()).rejects.toThrow('Online payment is not configured');
		}
	});

	it('stops the boot on a value the adapter refuses, naming only the setting', () => {
		const config = load({ CCAVENUE_WORKING_KEY: 'too-short-to-be-real' });
		expect(() => buildInrPaymentGateway(config)).toThrow('CCAvenue configuration is invalid: workingKey');
		expect(() => buildInrPaymentGateway(config)).not.toThrow('too-short-to-be-real');
	});
});
