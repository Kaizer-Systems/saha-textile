import { DeploymentConfigError } from './deployment-hardening';

/**
 * Boot-time catch for the API and the worker.
 *
 * A hardening refusal is an operator's configuration problem, not a crash: it is printed as the
 * plain list of what to fix — no stack trace burying it — and the process exits non-zero so the
 * orchestrator marks the deploy failed instead of restarting into the same refusal silently.
 * Anything else is rethrown untouched and keeps Node's normal unhandled-rejection behaviour.
 */
export function exitOnDeploymentConfigError(error: unknown): never {
	if (error instanceof DeploymentConfigError) {
		console.error(error.message);
		return process.exit(1);
	}
	throw error;
}
