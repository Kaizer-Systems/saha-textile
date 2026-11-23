import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	Location,
	type LocationChip,
	type LocationWrite,
	AdminUserLocations,
	type AdminUserLocationsWrite,
} from '@saha-textile/contracts';
import {
	type AdminUserRoleAssignmentRepository,
	type CompanyRepository,
	firstLocationFromShop,
	locationProblems,
	locationScope,
	type LocationRepository,
	type LocationScope,
	normaliseKinds,
	type RoleRepository,
	type ShopDetailsRepository,
	SUPER_ADMIN_ROLE_KEY,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	COMPANY_REPOSITORY,
	LOCATION_REPOSITORY,
	ROLE_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
} from '../infra/tokens';

export interface LocationRow extends Location {
	/** How many admin users work there (K1). */
	people: number;
}

/**
 * Locations and who works where (accounts brief K1–K3, L1–L3; owner-approved 2026-11-23). The first read makes
 * the first location from Shop details, and nothing else: the Stores page lists shops of another company
 * (owner, 2026-11-23: K.R. Marketing is one online business; the offline stores are a separate company), so its
 * entries never become locations by themselves.
 */
@Injectable()
export class LocationsService {
	private seeding: Promise<void> | null = null;

	constructor(
		@Inject(LOCATION_REPOSITORY) private readonly repo: LocationRepository,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: ShopDetailsRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: CompanyRepository,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findByKey'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'findActive'>,
	) {}

	/**
	 * A super admin holds the active system Administrator role, as everywhere else in admin. The coarse
	 * `admin` role on a session is not enough: a store manager has it too.
	 */
	private async isSuperAdmin(principal: AuthenticatedPrincipal | undefined): Promise<boolean> {
		if (!principal) return false;
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		return !!role && !!(await this.assignments.findActive(principal.userId, role.id));
	}

	/** First run: the business's own place from Shop details. */
	private ensureSeeded(): Promise<void> {
		this.seeding ??= (async () => {
			if ((await this.repo.list()).length) return;
			const shop = await this.shop.get();
			const now = new Date().toISOString();
			const made: Location[] = [];
			if (shop?.gstin && shop.address) {
				const registration = await this.company.findRegistrationByGstin(shop.gstin);
				made.push(
					Location.parse({
						...firstLocationFromShop({ ...shop, stateCode: shop.gstin.slice(0, 2) }),
						id: `loc_${randomUUID()}`,
						gstRegistrationId: registration?.id ?? null,
						createdAt: now,
						updatedAt: now,
					}),
				);
			}
			for (const location of made) await this.repo.save(location, null);
		})().catch((error: unknown) => {
			this.seeding = null;
			throw error;
		});
		return this.seeding;
	}

	private async activeIds(): Promise<string[]> {
		return (await this.repo.list()).filter((l) => l.active).map((l) => l.id);
	}

	/** What this user may see (L1–L3); a super admin sees everything. */
	async scope(principal: AuthenticatedPrincipal | undefined): Promise<LocationScope> {
		await this.ensureSeeded();
		const user = principal ? await this.repo.adminUserLocations(principal.userId) : null;
		return locationScope(user, {
			superAdmin: await this.isSuperAdmin(principal),
			activeIds: await this.activeIds(),
		});
	}

	async list(principal: AuthenticatedPrincipal | undefined): Promise<LocationRow[]> {
		await this.ensureSeeded();
		const [locations, people, scope] = await Promise.all([
			this.repo.list(),
			this.repo.allAdminUserLocations(),
			this.scope(principal),
		]);
		const count = (id: string) => people.filter((u) => u.worksAt.includes(id)).length;
		return locations
			.filter((l) => scope.all || scope.ids.includes(l.id) || !l.active)
			.map((l) => ({ ...l, people: count(l.id) }));
	}

	private async check(write: LocationWrite, id: string | null): Promise<LocationWrite> {
		const normal = normaliseKinds(write);
		const others = (await this.repo.list()).filter((l) => l.id !== id).map((l) => l.shortCode);
		const registration = normal.gstRegistrationId
			? await this.company.getRegistration(normal.gstRegistrationId)
			: null;
		if (normal.gstRegistrationId && !registration)
			throw new BadRequestException('location_problem:gst_registration_unknown');
		const current = id ? await this.repo.get(id) : null;
		const problems = locationProblems(normal, {
			otherShortCodes: others,
			registrationStateCode: registration?.stateCode ?? null,
			wasWarehouse: current?.warehouse ?? false,
			stockUnits: 0,
		});
		if (problems.length) throw new BadRequestException(`location_problem:${problems[0]}`);
		return normal;
	}

	async create(write: LocationWrite, by: string | null): Promise<Location> {
		await this.ensureSeeded();
		const { expectedUpdatedAt, ...rest } = await this.check(write, null);
		void expectedUpdatedAt;
		const now = new Date().toISOString();
		const location = Location.parse({
			...rest,
			id: `loc_${randomUUID()}`,
			createdAt: now,
			updatedAt: now,
			updatedBy: by,
		});
		try {
			await this.repo.save(location, null);
		} catch (error) {
			if (error instanceof Error && error.message === 'short_code_taken')
				throw new BadRequestException('location_problem:short_code_taken');
			throw error;
		}
		return location;
	}

	async update(id: string, write: LocationWrite, by: string | null): Promise<Location> {
		const current = await this.repo.get(id);
		if (!current) throw new NotFoundException('location_not_found');
		const { expectedUpdatedAt, ...rest } = await this.check(write, id);
		const next = Location.parse({ ...current, ...rest, id, updatedAt: new Date().toISOString(), updatedBy: by });
		await this.repo.save(next, expectedUpdatedAt ?? current.updatedAt);
		return next;
	}

	/** Never deleted once used: switched off or on (K2 rules). Refusals for stock and open work arrive with F4. */
	async setActive(id: string, active: boolean, by: string | null): Promise<Location> {
		const current = await this.repo.get(id);
		if (!current) throw new NotFoundException('location_not_found');
		const next = { ...current, active, updatedAt: new Date().toISOString(), updatedBy: by };
		await this.repo.save(next, current.updatedAt);
		return next;
	}

	async adminUserLocations(userId: string): Promise<AdminUserLocations> {
		await this.ensureSeeded();
		return (await this.repo.adminUserLocations(userId)) ?? AdminUserLocations.parse({ userId });
	}

	async saveAdminUserLocations(userId: string, write: AdminUserLocationsWrite): Promise<AdminUserLocations> {
		const known = new Set((await this.repo.list()).map((l) => l.id));
		if (write.worksAt.some((id) => !known.has(id))) throw new BadRequestException('location_unknown');
		if (write.homeLocationId && !write.worksAt.includes(write.homeLocationId))
			throw new BadRequestException('home_location_not_worked_at');
		const current = await this.adminUserLocations(userId);
		const next = AdminUserLocations.parse({
			...current,
			...write,
			homeLocationId: write.homeLocationId ?? write.worksAt[0] ?? null,
			currentLocationId: null,
			updatedAt: new Date().toISOString(),
		});
		await this.repo.saveAdminUserLocations(next);
		return next;
	}

	/** The header chip (L2, L3). */
	async chip(principal: AuthenticatedPrincipal | undefined): Promise<LocationChip> {
		const scope = await this.scope(principal);
		const user = principal ? await this.repo.adminUserLocations(principal.userId) : null;
		const superAdmin = await this.isSuperAdmin(principal);
		const all = await this.repo.list();
		const pick = (l: Location) => ({ id: l.id, name: l.name, shortCode: l.shortCode });
		const current = scope.current ? all.find((l) => l.id === scope.current) : null;
		const maySeeAll = superAdmin || !!user?.maySeeAll;
		return {
			current: current ? pick(current) : null,
			allLocations: scope.all && !scope.current,
			choices: all.filter((l) => l.active && scope.ids.includes(l.id)).map(pick),
			maySwitch: maySeeAll || !!user?.maySwitch,
			maySeeAll,
		};
	}

	async setChip(principal: AuthenticatedPrincipal | undefined, locationId: string | null): Promise<LocationChip> {
		if (!principal) throw new ForbiddenException('location_switch_refused');
		const chip = await this.chip(principal);
		if (!chip.maySwitch) throw new ForbiddenException('location_switch_refused');
		if (locationId === null && !chip.maySeeAll) throw new ForbiddenException('location_all_refused');
		if (locationId !== null && !chip.choices.some((c) => c.id === locationId))
			throw new ForbiddenException('location_switch_refused');
		const current = await this.adminUserLocations(principal.userId);
		await this.repo.saveAdminUserLocations({
			...current,
			currentLocationId: locationId,
			updatedAt: new Date().toISOString(),
		});
		return this.chip(principal);
	}
}
