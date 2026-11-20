import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * The Release Console's browser tests (`pnpm e2e:console` from the repository root). They start
 * the console's API and app on their own ports (4412 and 4402) with a fresh, empty data folder,
 * stats collection off and no Mac helper, so they never touch the owner's console, keys or Docker.
 * Uses the installed Chrome, as the shop's tests do.
 */
const data = mkdtempSync(join(tmpdir(), 'release-console-e2e-'));
const api = 4412;
const app = 4402;

export default defineConfig({
	testDir: './e2e',
	testMatch: /.*\.e2e\.ts/,
	outputDir: 'node_modules/.cache/playwright',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${app}`,
		channel: 'chrome',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
		{ name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
	],
	webServer: [
		{
			command:
				'pnpm --filter @saha-textile/release-console-api exec sh -c "nest build -p tsconfig.build.json && node dist/main.js"',
			cwd: '../..',
			url: `http://127.0.0.1:${api}/api/health`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				CONSOLE_API_PORT: String(api),
				CONSOLE_ORIGIN: `http://localhost:${app}`,
				CONSOLE_DATA_DIR: data,
				CONSOLE_KEYS_FILE: join(data, 'console.env'),
				CONSOLE_COLLECT: 'off',
				CONSOLE_RUNNER_URL: 'http://127.0.0.1:4439',
				CONSOLE_RUNNER_TOKEN_FILE: join(data, 'runner-token'),
			},
		},
		{
			command: `pnpm exec vite --port ${app} --strictPort`,
			url: `http://localhost:${app}`,
			reuseExistingServer: false,
			timeout: 120_000,
		},
	],
});
