export declare const TEST_DATABASE_USER: string;
export declare const TEST_PASSWORD_FILE: string;
export declare const TEST_ROLES: ReadonlyArray<{ role: string; db: string }>;
export declare function mainCheckout(root?: string): string;
export declare function testDatabaseUri(
	target: { host?: string; port?: string | number; replicaSet?: string; database: string },
	options?: { root?: string },
): string;
export declare function localMongoTarget(
	database: string,
	env?: NodeJS.ProcessEnv,
	root?: string,
): { host?: string; port?: string; replicaSet?: string; database: string };
export declare const TEST_DATABASE_NAME: RegExp;
export declare function testRunEnv(database: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
