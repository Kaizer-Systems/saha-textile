import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';

import { HelperError } from './runner-client.js';

interface Reply {
	status(code: number): Reply;
	send(body: unknown): void;
}

/** The Mac helper's refusals reach the console as their own status and plain message. */
@Catch(HelperError)
export class HelperErrorFilter implements ExceptionFilter {
	catch(error: HelperError, host: ArgumentsHost): void {
		host.switchToHttp()
			.getResponse<Reply>()
			.status(error.status >= 400 && error.status < 600 ? error.status : 503)
			.send({ statusCode: error.status, message: error.message });
	}
}
