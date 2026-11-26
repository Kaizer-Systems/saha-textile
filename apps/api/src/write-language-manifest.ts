import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MANIFEST_FILE, manifestFromRepository, repositoryRoot } from './languages/shipped-languages';

/**
 * Runs at the end of the API's build: records which languages both apps ship in this commit, next
 * to `main.js`, so Settings › Languages offers only those (step 0d, "release first, then add").
 */
const root = repositoryRoot(__dirname);
if (!root) {
	process.stderr.write('write-language-manifest: no repository above the build output\n');
	process.exit(1);
}
const manifest = manifestFromRepository(root);
writeFileSync(join(__dirname, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`);
process.stdout.write(
	`write-language-manifest: admin ${Object.keys(manifest.admin).join(', ')}; shop ${Object.keys(manifest.shop).join(', ')}\n`,
);
