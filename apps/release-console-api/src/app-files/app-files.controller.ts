import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';

import { appFile } from './app-files.js';
import { Open } from '../lock/session.guard.js';

interface FileRequest {
	url: string;
}
interface FileReply {
	header(name: string, value: string): FileReply;
	send(body: Buffer): void;
}

/**
 * When the console runs as one image, this process also serves the built console app
 * (`CONSOLE_APP_DIR`), so the page and its API share one address. The app's files need no session;
 * every `/api/…` route still does.
 */
@Controller()
@Open()
export class AppFilesController {
	@Get('*')
	file(@Req() req: FileRequest, @Res() reply: FileReply): void {
		const found = appFile(process.env['CONSOLE_APP_DIR'], req.url);
		if (!found) throw new NotFoundException();
		reply
			.header('content-type', found.type)
			.header('cache-control', found.cache)
			.header('x-content-type-options', 'nosniff')
			.header('x-frame-options', 'DENY')
			.header('referrer-policy', 'no-referrer')
			.send(found.body);
	}
}
