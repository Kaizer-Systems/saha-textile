import { Module } from '@nestjs/common';

import { SecurityController } from './security.controller';

/**
 * Transport-security surface: CSRF token issuance today; Chunk D extends it as sessions,
 * rotation, and audience guards land.
 */
@Module({
	controllers: [SecurityController],
})
export class SecurityModule {}
