import { Body, Controller, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationWrite, UserLocationsWrite } from '@saha-textile/contracts';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { LocationsService } from './locations.service';

const ActiveSave = z.object({ active: z.boolean() });
const ChipSave = z.object({ locationId: z.string().min(1).nullable() });
const by = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;

/** Settings › Locations and who works where (accounts brief K1–K3, L1). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/locations')
export class LocationsController {
	constructor(private readonly locations: LocationsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'listLocations',
		summary: 'Locations with their kinds, GSTIN and people (staff see only theirs)',
	})
	list(@Principal() principal?: AuthenticatedPrincipal) {
		return this.locations.list(principal);
	}

	@Post()
	@RequirePermissions('location.edit')
	@ApiOperation({ operationId: 'createLocation', summary: 'Add a warehouse, store or office' })
	create(
		@Body(new ZodValidationPipe(LocationWrite)) body: LocationWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.locations.create(body, by(principal));
	}

	@Put(':id')
	@RequirePermissions('location.edit')
	@ApiOperation({ operationId: 'saveLocation', summary: 'Save a location over the copy read' })
	save(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(LocationWrite)) body: LocationWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.locations.update(id, body, by(principal));
	}

	@Post(':id/active')
	@HttpCode(200)
	@RequirePermissions('location.edit')
	@ApiOperation({
		operationId: 'setLocationActive',
		summary: 'Switch a location off or on (never deleted once used)',
	})
	setActive(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ActiveSave)) body: z.infer<typeof ActiveSave>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.locations.setActive(id, body.active, by(principal));
	}

	@Get('users/:userId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'userLocations', summary: 'Where an admin user works (L1)' })
	userLocations(@Param('userId') userId: string) {
		return this.locations.userLocations(userId);
	}

	@Put('users/:userId')
	@RequirePermissions('location.edit')
	@ApiOperation({
		operationId: 'saveUserLocations',
		summary: 'Set where an admin user works, their home, may switch, may see all',
	})
	saveUserLocations(
		@Param('userId') userId: string,
		@Body(new ZodValidationPipe(UserLocationsWrite)) body: UserLocationsWrite,
	) {
		return this.locations.saveUserLocations(userId, body);
	}
}

/** The header's location chip for the signed-in user (L2, L3): open to every admin user. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/me/location')
export class MyLocationController {
	constructor(private readonly locations: LocationsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		operationId: 'myLocation',
		summary: 'The location chip: current location, choices, may switch, may see all',
	})
	chip(@Principal() principal?: AuthenticatedPrincipal) {
		return this.locations.chip(principal);
	}

	@Put()
	@ApiOperation({
		operationId: 'switchMyLocation',
		summary: 'Move the chip to one location, or all (null) when allowed',
	})
	switch(
		@Body(new ZodValidationPipe(ChipSave)) body: z.infer<typeof ChipSave>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.locations.setChip(principal, body.locationId);
	}
}
