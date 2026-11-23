import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type AutomaticEDocPath,
	type EDocCall,
	type EDocKeysView,
	type EDocKeysWrite,
	EDocSettings,
	type EDocSettingsWrite,
	EDocument,
	type Order,
	type TaxInvoice,
} from '@saha-textile/contracts';
import {
	EDocRefusedError,
	EDocUnavailableError,
	istDay,
	type EDocKeyStore,
	type EDocListFilter,
	type EDocRepository,
	type EDocSecrets,
	type OrderSettingsRepository,
	type ShopDetailsRepository,
} from '@saha-textile/core-domain';

import { EDOC_KEY_STORE, EDOC_REPOSITORY, ORDER_SETTINGS_REPOSITORY, SHOP_DETAILS_REPOSITORY } from '../infra/tokens';
import { type AnyEDocGateway, EDocGatewayFactory } from './edoc-gateways';

const PATH_KIND: Record<AutomaticEDocPath, 'eInvoice' | 'eWayBill'> = {
	irpDirect: 'eInvoice',
	irpProvider: 'eInvoice',
	ewbDirect: 'eWayBill',
	ewbProvider: 'eWayBill',
};
const NEEDS_PUBLIC_KEY = new Set<AutomaticEDocPath>(['irpDirect', 'ewbDirect']);

export interface EDocSettingsView {
	gstin: string | null;
	settings: EDocSettings | null;
	/** False without EDOC_KEYS_KEY: only the by-hand path can be used. */
	keysAvailable: boolean;
}

/**
 * Settings › E-invoice and e-way bill, the paths' keys and Test, the records and the activity log (accounts brief
 * addendum 2, AE1–AE9). The order page's Raise buttons reach the automatic paths through EDocsOrderBridge.
 */
@Injectable()
export class EDocsService {
	constructor(
		@Inject(EDOC_REPOSITORY) private readonly repo: EDocRepository,
		@Inject(EDOC_KEY_STORE) private readonly keys: EDocKeyStore,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: ShopDetailsRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly orderSettings: OrderSettingsRepository,
		private readonly gateways: EDocGatewayFactory,
	) {}

	/** One business per deployment: its GSTIN is the shop's (Settings › Shop details). */
	async gstin(): Promise<string | null> {
		return (await this.shop.get())?.gstin ?? null;
	}

	async settingsFor(gstin: string): Promise<EDocSettings> {
		const stored = await this.repo.getSettings(gstin);
		if (stored) return stored;
		// First read: the ₹50,000 threshold comes from Order settings, where it lived until now (AE8).
		const order = await this.orderSettings.get();
		return EDocSettings.parse({ gstin, eWayBillThresholdINR: order.eWayBillThresholdINR });
	}

	/** Whether this business's GSTIN is e-invoice enabled today: only then is an IRN needed. */
	async eInvoiceEnabled(day: string = istDay(new Date())): Promise<boolean> {
		const gstin = await this.gstin();
		if (!gstin) return false;
		const from = (await this.settingsFor(gstin)).eInvoiceEnabledFrom;
		return !!from && from <= day;
	}

	async view(): Promise<EDocSettingsView> {
		const gstin = await this.gstin();
		return { gstin, settings: gstin ? await this.settingsFor(gstin) : null, keysAvailable: this.keys.available };
	}

	private async requireGstin(): Promise<string> {
		const gstin = await this.gstin();
		if (!gstin) throw new BadRequestException('edoc_shop_gstin_needed');
		return gstin;
	}

	async saveSettings(
		write: EDocSettingsWrite,
		expectedUpdatedAt: string | null,
		by: string | null,
	): Promise<EDocSettingsView> {
		const gstin = await this.requireGstin();
		const current = await this.settingsFor(gstin);
		// An automatic path switches on only when its keys passed Test (AE1).
		for (const path of [write.eInvoicePath, write.eWayBillPath])
			if (path !== 'manual' && !current.keys.find((k) => k.path === path)?.testOk)
				throw new BadRequestException(`edoc_path_needs_tested_keys:${path}`);
		const next = EDocSettings.parse({
			...current,
			...write,
			revision: current.revision + 1,
			updatedAt: new Date().toISOString(),
			updatedBy: by,
		});
		await this.repo.saveSettings(next, expectedUpdatedAt);
		if (write.eWayBillThresholdINR !== current.eWayBillThresholdINR) {
			// The order page's Shipped gate still reads Order settings: keep the one value in step.
			const order = await this.orderSettings.get();
			await this.orderSettings.save(
				{ ...order, eWayBillThresholdINR: write.eWayBillThresholdINR },
				order.revision,
			);
		}
		return this.view();
	}

	private async replaceKeysView(
		gstin: string,
		path: AutomaticEDocPath,
		view: EDocKeysView | null,
		switchOff = false,
	): Promise<void> {
		const current = await this.settingsFor(gstin);
		const next = EDocSettings.parse({
			...current,
			keys: [...current.keys.filter((k) => k.path !== path), ...(view ? [view] : [])],
			...(switchOff && current.eInvoicePath === path ? { eInvoicePath: 'manual' } : {}),
			...(switchOff && current.eWayBillPath === path ? { eWayBillPath: 'manual' } : {}),
			revision: current.revision + 1,
			updatedAt: new Date().toISOString(),
		});
		await this.repo.saveSettings(next, current.updatedAt);
	}

	/** Save a path's keys (AE6): a blank secret keeps the stored one; the path must pass Test again. */
	async saveKeys(write: EDocKeysWrite, by: string | null): Promise<EDocSettingsView> {
		if (!this.keys.available) throw new BadRequestException('edoc_keys_key_missing');
		const gstin = await this.requireGstin();
		const stored = await this.keys.get(gstin, write.path);
		const secrets: EDocSecrets = {
			password: write.password || stored?.password || null,
			clientId: write.clientId || stored?.clientId || null,
			clientSecret: write.clientSecret || stored?.clientSecret || null,
			publicKeyPem: write.publicKeyPem || stored?.publicKeyPem || null,
		};
		if (
			!secrets.password ||
			!secrets.clientId ||
			!secrets.clientSecret ||
			(NEEDS_PUBLIC_KEY.has(write.path) && !secrets.publicKeyPem)
		)
			throw new BadRequestException('edoc_keys_incomplete');
		await this.keys.put(gstin, write.path, secrets);
		const previous = (await this.settingsFor(gstin)).keys.find((k) => k.path === write.path);
		await this.replaceKeysView(gstin, write.path, {
			path: write.path,
			provider: write.provider,
			environment: write.environment,
			baseUrl: write.baseUrl,
			userName: write.userName,
			clientIdHint: `…${secrets.clientId.slice(-4)}`,
			hasClientSecret: true,
			hasPassword: true,
			hasPublicKey: !!secrets.publicKeyPem,
			passwordSetOn: write.password ? istDay(new Date()) : (previous?.passwordSetOn ?? null),
			testedAt: null,
			testOk: null,
			testMessage: null,
		});
		void by;
		return this.view();
	}

	async removeKeys(path: AutomaticEDocPath): Promise<EDocSettingsView> {
		const gstin = await this.requireGstin();
		await this.keys.remove(gstin, path);
		await this.replaceKeysView(gstin, path, null, true);
		return this.view();
	}

	/** A path's adapter and the keys' view it was built from; null without both keys and secrets. */
	private async gatewayFor(
		gstin: string,
		path: AutomaticEDocPath,
	): Promise<{ gateway: AnyEDocGateway; view: EDocKeysView } | null> {
		const view = (await this.settingsFor(gstin)).keys.find((k) => k.path === path);
		const secrets = view ? await this.keys.get(gstin, path) : null;
		const gateway = view && secrets ? this.gateways.build(path, view, secrets) : null;
		return view && gateway ? { gateway, view } : null;
	}

	/** Settings › Test: signs in (and, for e-invoice, reads our own GSTIN back). */
	async test(path: AutomaticEDocPath, by: string | null): Promise<EDocSettingsView> {
		const gstin = await this.requireGstin();
		const found = await this.gatewayFor(gstin, path);
		if (!found) throw new NotFoundException('edoc_keys_needed');
		const built = found.gateway;
		const started = Date.now();
		let ok = true;
		let code: string | null = null;
		let message: string | null = null;
		try {
			await built.gateway.test(gstin);
		} catch (error) {
			ok = false;
			code =
				error instanceof EDocRefusedError
					? error.code
					: error instanceof EDocUnavailableError
						? 'unavailable'
						: 'error';
			message = error instanceof Error ? error.message.slice(0, 300) : 'error';
		}
		await this.replaceKeysView(gstin, path, {
			...found.view,
			testedAt: new Date().toISOString(),
			testOk: ok,
			testMessage: message,
		});
		await this.log({
			gstin,
			path,
			action: 'test',
			documentNumber: null,
			ok,
			code,
			message,
			durationMs: Date.now() - started,
			by: by ?? 'system',
		});
		return this.view();
	}

	/** The adapter of the chosen automatic path, or null for the by-hand path or untested keys. */
	async automatic(
		kind: 'eInvoice' | 'eWayBill',
	): Promise<{ gstin: string; path: AutomaticEDocPath; gateway: AnyEDocGateway } | null> {
		const gstin = await this.gstin();
		if (!gstin) return null;
		const settings = await this.settingsFor(gstin);
		const path = kind === 'eInvoice' ? settings.eInvoicePath : settings.eWayBillPath;
		if (path === 'manual' || PATH_KIND[path] !== kind) return null;
		if (!settings.keys.find((k) => k.path === path)?.testOk) return null;
		const found = await this.gatewayFor(gstin, path);
		return found ? { gstin, path, gateway: found.gateway } : null;
	}

	async log(call: Omit<EDocCall, 'id' | 'at'>): Promise<void> {
		await this.repo.logCall({ ...call, id: randomUUID(), at: new Date().toISOString() });
	}

	/**
	 * Keeps the record of an IRN or e-way bill made for an order, by hand or automatically, against the order's
	 * tax invoice (accounts brief D1). Without one (the switch off, or an order Generated before it was packed) the
	 * order stands in for its invoice, as before D1.
	 */
	async recordForOrder(
		order: Order,
		kind: 'eInvoice' | 'eWayBill',
		path: EDocument['path'],
		by: string,
		invoice: Pick<TaxInvoice, 'id' | 'number' | 'date' | 'totalINR'> | null = null,
	): Promise<void> {
		const gstin = await this.gstin();
		if (!gstin) return;
		for (const documentId of new Set([invoice?.id ?? order.id, order.id])) {
			const active = await this.repo.findActive(kind, documentId);
			if (active)
				await this.repo.replace({
					...active,
					status: 'cancelled',
					cancellation: { reason: 'replaced', remark: 'Entered again', at: new Date().toISOString(), by },
				});
		}
		const now = new Date().toISOString();
		const irn = kind === 'eInvoice' ? order.eInvoice : null;
		const ewb = kind === 'eWayBill' ? order.eWayBill : null;
		await this.repo.insert(
			EDocument.parse({
				id: randomUUID(),
				kind,
				gstin,
				documentType: 'taxInvoice',
				documentId: invoice?.id ?? order.id,
				documentNumber: invoice?.number ?? order.orderNumber,
				documentDate: invoice?.date ?? istDay(order.createdAt ?? now),
				orderId: order.id,
				partyName: order.buyer?.name ?? null,
				partyGstin: order.buyer?.gstin ?? null,
				valueINR: invoice?.totalINR ?? order.totalINR ?? null,
				path,
				status: 'active',
				irn: irn?.irn ?? null,
				ackNo: irn?.ackNo ?? null,
				ackDate: irn?.ackDate ?? null,
				signedQr: irn?.signedQr ?? null,
				ewbNumber: ewb?.number ?? null,
				generatedAt: ewb?.generatedOn ?? irn?.ackDate ?? null,
				validUntil: ewb?.validUntil ?? null,
				createdAt: now,
				createdBy: by,
			}),
		);
		await this.log({
			gstin,
			path,
			action: path === 'manual' ? 'manualEntry' : 'generate',
			documentNumber: invoice?.number ?? order.orderNumber,
			ok: true,
			code: null,
			message: null,
			durationMs: null,
			by,
		});
	}

	list(filter: EDocListFilter) {
		return this.repo.list(filter);
	}

	activity(page: number) {
		return this.repo.listCalls(null, page, 50);
	}
}
