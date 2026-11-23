import { Injectable } from '@nestjs/common';
import {
	EwbDirectGateway,
	IrpDirectEInvoiceGateway,
	MastersIndiaEInvoiceGateway,
	MastersIndiaEWayBillGateway,
} from '@saha-textile/adapters-gst-edocs';
import type { AutomaticEDocPath, EDocKeysView } from '@saha-textile/contracts';
import type { EDocSecrets, EInvoiceGateway, EWayBillGateway } from '@saha-textile/core-domain';

export type AnyEDocGateway =
	{ kind: 'eInvoice'; gateway: EInvoiceGateway } | { kind: 'eWayBill'; gateway: EWayBillGateway };

/**
 * Builds the adapter for an automatic path from its stored keys (accounts brief addendum 2, AE2/AE3). The
 * provider decides the adapter; the path decides which document it serves. Returns null when a secret is missing.
 */
@Injectable()
export class EDocGatewayFactory {
	build(path: AutomaticEDocPath, view: EDocKeysView, secrets: EDocSecrets): AnyEDocGateway | null {
		const { password, clientId, clientSecret, publicKeyPem } = secrets;
		if (!password || !clientId || !clientSecret) return null;
		const common = { baseUrl: view.baseUrl, clientId, clientSecret, userName: view.userName, password };
		switch (path) {
			case 'irpDirect':
				if (!publicKeyPem || (view.provider !== 'irisIrp' && view.provider !== 'nicIrp')) return null;
				return { kind: 'eInvoice', gateway: new IrpDirectEInvoiceGateway({ ...common, publicKeyPem }) };
			case 'ewbDirect':
				if (!publicKeyPem || view.provider !== 'nicEwb') return null;
				return { kind: 'eWayBill', gateway: new EwbDirectGateway({ ...common, publicKeyPem }) };
			case 'irpProvider':
				return view.provider === 'mastersIndia'
					? { kind: 'eInvoice', gateway: new MastersIndiaEInvoiceGateway(common) }
					: null;
			case 'ewbProvider':
				return view.provider === 'mastersIndia'
					? { kind: 'eWayBill', gateway: new MastersIndiaEWayBillGateway(common) }
					: null;
		}
	}
}
