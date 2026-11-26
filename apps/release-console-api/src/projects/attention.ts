import type { AttentionItem, Project, WorkflowRun } from '@saha-textile/release-console-contracts';

const PERMANENT_BRANCHES = ['main', 'staging', 'dev'];

/** Keys that need the owner: expiring, expired or failed, and slots with no key at all. */
export function keyAttention(project: Project): AttentionItem[] {
	const items: AttentionItem[] = [];
	for (const k of project.keys) {
		if (k.state === 'expiring' || k.state === 'expired' || k.state === 'failed')
			items.push({
				projectId: project.id,
				repositoryId: null,
				kind: k.state === 'expiring' ? 'key-expiring' : k.state === 'expired' ? 'key-expired' : 'key-failed',
				title: `${k.label} ${k.state === 'expiring' ? 'expires soon' : k.state === 'expired' ? 'has expired' : 'failed its check'}`,
				detail: k.expiresAt ? `Ends ${k.expiresAt.slice(0, 10)}. ${k.note}`.trim() : k.note,
			});
	}
	const has = (ids: string[], prefix: string) =>
		project.keys.some((k) => ids.includes(k.id) && k.kind.startsWith(prefix));
	for (const r of project.repositories) {
		if (r.sourceCode.vendor === 'github' && !r.sourceCode.keyId)
			items.push({
				projectId: project.id,
				repositoryId: r.id,
				kind: 'key-missing',
				title: `${r.name}: GitHub is not connected`,
				detail: 'Add a key on the Connections screen.',
			});
		for (const c of r.cloud)
			if (c.vendor === 'digitalocean' && !has(c.keyIds, 'do-'))
				items.push({
					projectId: project.id,
					repositoryId: r.id,
					kind: 'key-missing',
					title: `${r.name}: DigitalOcean is not connected`,
					detail: 'Paste a DigitalOcean read token on the Connections screen.',
				});
		for (const e of r.edge)
			if (e.vendor === 'cloudflare' && !has(e.keyIds, 'cf-'))
				items.push({
					projectId: project.id,
					repositoryId: r.id,
					kind: 'key-missing',
					title: `${r.name}: Cloudflare is not connected`,
					detail: 'Paste a Cloudflare read token on the Connections screen.',
				});
	}
	return items;
}

/** The latest run of each workflow on a permanent branch that failed, and runs waiting for approval. */
export function runAttention(projectId: string, repositoryId: string, runs: WorkflowRun[]): AttentionItem[] {
	const latest = new Map<string, WorkflowRun>();
	for (const run of runs) {
		if (!PERMANENT_BRANCHES.includes(run.branch)) continue;
		const key = `${run.name}@${run.branch}`;
		const seen = latest.get(key);
		if (!seen || seen.createdAt < run.createdAt) latest.set(key, run);
	}
	const items: AttentionItem[] = [...latest.values()]
		.filter((r) => r.conclusion === 'failure')
		.map((r) => ({
			projectId,
			repositoryId,
			kind: 'ci-failed',
			title: `${r.name} failed on ${r.branch}`,
			detail: r.url,
		}));
	for (const r of runs)
		if (r.status === 'waiting')
			items.push({
				projectId,
				repositoryId,
				kind: 'approval-waiting',
				title: `${r.name} waits for approval`,
				detail: r.url,
			});
	return items;
}
