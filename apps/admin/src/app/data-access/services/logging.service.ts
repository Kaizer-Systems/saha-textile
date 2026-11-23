import { Injectable } from '@angular/core';

@Injectable({
	providedIn: 'root',
})
export class LoggingService {
	constructor() {}

	/** An error goes to the browser's error output, where errors are looked for. */
	logError(message: string) {
		console.error('LoggingService: ' + message);
	}
}
