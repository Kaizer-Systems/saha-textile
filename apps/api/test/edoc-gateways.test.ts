import { describe, expect, it } from 'vitest';

import { EDocGatewayFactory } from '../src/edocs/edoc-gateways';

const factory = new EDocGatewayFactory();
const secrets = { password: 'pw', clientId: 'cid', clientSecret: 'sec', publicKeyPem: '-----BEGIN PUBLIC KEY-----' };
const view = (provider: string) => ({ provider, baseUrl: 'https://gsp.example', userName: 'user' }) as never;

describe('building an e-document gateway from its stored keys', () => {
	it('needs every secret', () => {
		expect(factory.build('irpDirect', view('nicIrp'), { ...secrets, password: '' } as never)).toBeNull();
		expect(factory.build('irpDirect', view('nicIrp'), { ...secrets, clientId: '' } as never)).toBeNull();
		expect(factory.build('irpDirect', view('nicIrp'), { ...secrets, clientSecret: '' } as never)).toBeNull();
	});

	it('builds the IRP directly for IRIS or NIC with a public key, and nothing else', () => {
		expect(factory.build('irpDirect', view('irisIrp'), secrets as never)?.kind).toBe('eInvoice');
		expect(factory.build('irpDirect', view('nicIrp'), secrets as never)?.kind).toBe('eInvoice');
		expect(factory.build('irpDirect', view('mastersIndia'), secrets as never)).toBeNull();
		expect(factory.build('irpDirect', view('nicIrp'), { ...secrets, publicKeyPem: null } as never)).toBeNull();
	});

	it('builds the e-way bill system directly for NIC with a public key', () => {
		expect(factory.build('ewbDirect', view('nicEwb'), secrets as never)?.kind).toBe('eWayBill');
		expect(factory.build('ewbDirect', view('nicIrp'), secrets as never)).toBeNull();
		expect(factory.build('ewbDirect', view('nicEwb'), { ...secrets, publicKeyPem: null } as never)).toBeNull();
	});

	it('builds Masters India for either document, and no other provider', () => {
		expect(factory.build('irpProvider', view('mastersIndia'), secrets as never)?.kind).toBe('eInvoice');
		expect(factory.build('irpProvider', view('other'), secrets as never)).toBeNull();
		expect(factory.build('ewbProvider', view('mastersIndia'), secrets as never)?.kind).toBe('eWayBill');
		expect(factory.build('ewbProvider', view('other'), secrets as never)).toBeNull();
	});
});
