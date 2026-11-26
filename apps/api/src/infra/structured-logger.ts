import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';

import { currentRequestId } from '../common/request-context';
import type { AppConfig } from '../config/app-config';
import { maskPersonalData } from './log-masking';

/** What a log line is about, for colour and filters in the Release Console. */
export type LogKind = 'request' | 'security' | 'payment' | 'search' | 'database' | 'job' | 'deploy' | 'system';

const KINDS: ReadonlyArray<[RegExp, LogKind]> = [
	[/auth|session|otp|csrf|guard|pin|password|credential|oauth|identity/i, 'security'],
	[/payment|ccavenue|paypal|checkout|order|refund|invoice/i, 'payment'],
	[/search|listing|meili|vocabulary|trending/i, 'search'],
	[/mongo|database|persistence|transaction|migration|index/i, 'database'],
	[/worker|queue|job|notification|msg91|mail|stock|youtube|insight|cdn/i, 'job'],
	[/release|deploy/i, 'deploy'],
	[/http|request|router|controller/i, 'request'],
];

/** The kind of a log line, from the name of the class that wrote it. */
export function logKind(context: string | undefined): LogKind {
	if (!context) return 'system';
	return KINDS.find(([pattern]) => pattern.test(context))?.[1] ?? 'system';
}

const NEST_LEVELS: Record<AppConfig['logLevel'], LogLevel[]> = {
	silent: [],
	fatal: ['fatal'],
	error: ['fatal', 'error'],
	warn: ['fatal', 'error', 'warn'],
	info: ['fatal', 'error', 'warn', 'log'],
	debug: ['fatal', 'error', 'warn', 'log', 'debug'],
	trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Nest's names, written the way the request log (pino) writes its levels. */
const LEVEL_NAME: Record<LogLevel, string> = {
	fatal: 'fatal',
	error: 'error',
	warn: 'warn',
	log: 'info',
	debug: 'debug',
	verbose: 'trace',
};

const text = (value: unknown): string =>
	typeof value === 'string' ? value : value instanceof Error ? value.message : JSON.stringify(value);

/**
 * One JSON line per event: time, level, kind, context, request id when there is one, the
 * message and, for errors, the stack. Personal data is masked in every field. The same
 * shape as the request log, so the console's agent reads both alike.
 */
export class JsonLogger implements LoggerService {
	private readonly enabled: Set<LogLevel>;

	constructor(
		levels: readonly LogLevel[],
		private readonly write: (line: string) => void = (line) => process.stdout.write(line),
		private readonly now: () => Date = () => new Date(),
	) {
		this.enabled = new Set(levels);
	}

	log(message: unknown, ...rest: unknown[]): void {
		this.emit('log', message, rest);
	}
	error(message: unknown, ...rest: unknown[]): void {
		this.emit('error', message, rest);
	}
	warn(message: unknown, ...rest: unknown[]): void {
		this.emit('warn', message, rest);
	}
	debug(message: unknown, ...rest: unknown[]): void {
		this.emit('debug', message, rest);
	}
	verbose(message: unknown, ...rest: unknown[]): void {
		this.emit('verbose', message, rest);
	}
	fatal(message: unknown, ...rest: unknown[]): void {
		this.emit('fatal', message, rest);
	}
	setLogLevels(levels: LogLevel[]): void {
		this.enabled.clear();
		for (const level of levels) this.enabled.add(level);
	}

	private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
		if (!this.enabled.has(level)) return;
		// Nest passes the context last; an error may carry a stack before it.
		const context =
			rest.length && typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : undefined;
		const extras = context === undefined ? rest : rest.slice(0, -1);
		const stack =
			message instanceof Error
				? message.stack
				: extras.find((value): value is string => typeof value === 'string' && value.includes('\n    at '));
		const reqId = currentRequestId();
		const line = {
			time: this.now().toISOString(),
			level: LEVEL_NAME[level],
			kind: logKind(context),
			...(context ? { context } : {}),
			...(reqId ? { reqId } : {}),
			msg: maskPersonalData(text(message)),
			...(stack ? { stack: maskPersonalData(stack) } : {}),
		};
		this.write(`${JSON.stringify(line)}\n`);
	}
}

/** Nest's coloured terminal lines, with the same masking and the request id appended. */
export class MaskingConsoleLogger extends ConsoleLogger {
	protected override formatMessage(...args: Parameters<ConsoleLogger['formatMessage']>): string {
		const [logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff] = args;
		const reqId = currentRequestId();
		const masked = maskPersonalData(text(message)) + (reqId ? ` [req ${reqId}]` : '');
		return super.formatMessage(logLevel, masked, pidMessage, formattedLogLevel, contextMessage, timestampDiff);
	}
}

/** The application logger the config asks for: JSON in production unless told otherwise. */
export function createAppLogger(config: Pick<AppConfig, 'logLevel' | 'logFormat' | 'nodeEnv'>): LoggerService {
	const levels = config.nodeEnv === 'test' ? [] : NEST_LEVELS[config.logLevel];
	const format = config.logFormat ?? (config.nodeEnv === 'production' ? 'json' : 'pretty');
	if (format === 'json') return new JsonLogger(levels);
	const logger = new MaskingConsoleLogger();
	logger.setLogLevels(levels);
	return logger;
}
