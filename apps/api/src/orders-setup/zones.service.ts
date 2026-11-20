import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	PriceZone,
	RETAIL_ZONE_ID,
	ZonePricingSettings,
	type AdminZoneRow,
	type PriceZoneWrite,
} from '@saha-textile/contracts';
import {
	settingsZoneNeeds,
	type AuditLogRepository,
	type BusinessRepository,
	type PriceZoneRepository,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { AUDIT_LOG_REPOSITORY, BUSINESS_REPOSITORY, PRICE_ZONE_REPOSITORY } from '../infra/tokens';
import { auditOrdersChange, refuseStale } from './orders-audit';

/**
 * Customers › Zones (`DEC-B2B-ZONES`, owner 2026-11-20). RETAIL is a system zone: shop pricing, no
 * rules, never edited or deleted. Other zones hold price lists built like sale events. A zone goes
 * live only when every zone setting it needs is chosen (the open questions are settings, never
 * guessed); zones never change shop prices.
 */
@Injectable()
export class ZonesService {
	constructor(
		@Inject(PRICE_ZONE_REPOSITORY) private readonly zones: PriceZoneRepository,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async list(): Promise<AdminZoneRow[]> {
		const [zones, settings] = await Promise.all([this.zones.list(), this.zones.getSettings()]);
		return Promise.all(
			zones.map(async (zone) => ({
				id: zone.id,
				code: zone.code,
				name: zone.name,
				system: zone.system,
				status: zone.status,
				version: zone.version,
				updatedAt: zone.updatedAt,
				businessCount: await this.businesses.countByZone(zone.id),
				categoryRuleCount: zone.priceList.categories.length,
				productExceptionCount: zone.priceList.products.length,
				settingsNeeded: zone.system ? [] : settingsZoneNeeds(zone.priceList, settings),
			})),
		);
	}

	async get(id: string): Promise<PriceZone> {
		const zone = await this.zones.findById(id);
		if (!zone) throw new NotFoundException('That zone does not exist');
		return zone;
	}

	async create(input: PriceZoneWrite, actor: string | null): Promise<PriceZone> {
		const now = new Date().toISOString();
		const zone = PriceZone.parse({
			id: `zone_${randomUUID()}`,
			code: input.code,
			name: input.name,
			description: input.description,
			system: false,
			status: 'draft',
			priceList: input.priceList,
			version: 1,
			revision: 0,
			createdAt: now,
			updatedAt: now,
			updatedBy: actor,
		});
		const saved = await this.uniqueCode(() => this.zones.save(zone, null), zone.code);
		await auditOrdersChange(this.audit, actor, 'zone.create', 'zone', saved.id, { code: saved.code });
		return saved;
	}

	async update(id: string, input: PriceZoneWrite, actor: string | null): Promise<PriceZone> {
		const current = await this.get(id);
		if (current.system)
			throw new ConflictException(
				codedRefusal('zone_system', 'RETAIL uses shop pricing and has no rules to edit', 'id'),
			);
		if (input.revision === undefined)
			throw new BadRequestException(
				codedRefusal('revision_required', 'Send the revision you edited', 'revision'),
			);
		const listChanged = JSON.stringify(current.priceList) !== JSON.stringify(input.priceList);
		const next = PriceZone.parse({
			...current,
			code: input.code,
			name: input.name,
			description: input.description,
			priceList: input.priceList,
			version: listChanged ? current.version + 1 : current.version,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		});
		const revision = input.revision;
		const saved = await refuseStale(
			() => this.uniqueCode(() => this.zones.save(next, revision), next.code),
			'Someone else saved this zone first',
		);
		await auditOrdersChange(this.audit, actor, 'zone.update', 'zone', id, { version: saved.version, listChanged });
		return saved;
	}

	/** Live: business orders on this zone are priced by it. Refused while a needed setting is unchosen. */
	async setStatus(
		id: string,
		status: 'draft' | 'live' | 'archived',
		revision: number,
		actor: string | null,
	): Promise<PriceZone> {
		const current = await this.get(id);
		if (current.system) throw new ConflictException(codedRefusal('zone_system', 'RETAIL is always live', 'id'));
		if (status === 'live') {
			const needed = settingsZoneNeeds(current.priceList, await this.zones.getSettings());
			if (needed.length) {
				throw new ConflictException(
					codedRefusal('zone_settings_needed', 'Choose the zone settings first', 'status', {
						settings: needed.join(','),
					}),
				);
			}
		}
		const saved = await refuseStale(
			() =>
				this.zones.save(
					{ ...current, status, updatedAt: new Date().toISOString(), updatedBy: actor },
					revision,
				),
			'Someone else saved this zone first',
		);
		await auditOrdersChange(this.audit, actor, `zone.${status}`, 'zone', id, {});
		return saved;
	}

	async remove(id: string, actor: string | null): Promise<void> {
		const current = await this.get(id);
		if (current.system || id === RETAIL_ZONE_ID)
			throw new ConflictException(codedRefusal('zone_system', 'RETAIL can never be deleted', 'id'));
		const inUse = await this.businesses.countByZone(id);
		if (inUse > 0)
			throw new ConflictException(
				codedRefusal('zone_in_use', 'Move its businesses to another zone first', 'id', { businesses: inUse }),
			);
		await this.zones.delete(id);
		await auditOrdersChange(this.audit, actor, 'zone.delete', 'zone', id, { code: current.code });
	}

	getSettings(): Promise<ZonePricingSettings> {
		return this.zones.getSettings();
	}

	async saveSettings(input: ZonePricingSettings, actor: string | null): Promise<ZonePricingSettings> {
		const next = ZonePricingSettings.parse({ ...input, updatedAt: new Date().toISOString(), updatedBy: actor });
		const saved = await refuseStale(
			() => this.zones.saveSettings(next, input.revision),
			'Someone else changed the zone settings first',
		);
		await auditOrdersChange(this.audit, actor, 'zone.settings', 'zone', null, {
			saleMeetsZone: saved.saleMeetsZone,
			gstInZonePrice: saved.gstInZonePrice,
			categoryClash: saved.categoryClash,
			couponsOnZoneLines: saved.couponsOnZoneLines,
		});
		return saved;
	}

	private async uniqueCode<T>(work: () => Promise<T>, code: string): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if ((error as { code?: number }).code === 11000) {
				throw new ConflictException(
					codedRefusal('zone_code_taken', `The code ${code} is already used by another zone`, 'code'),
				);
			}
			throw error;
		}
	}
}
