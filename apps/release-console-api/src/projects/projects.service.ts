import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
	type ConsoleView,
	KEY_KINDS,
	type KeyRef,
	type NewProject,
	type Project,
	type Repository,
	type SlotKeys,
	type StoreKey,
} from '@saha-textile/release-console-contracts';

import { KeychainPort } from '../keychain/keychain.port.js';
import { ConsoleStore } from '../store/console-store.js';
import { checkKey, stateWithExpiry } from '../vendors/key-checks.js';

const run = promisify(execFile);

/** The GitHub CLI's own sign-in on this computer (made in the browser with `gh auth login`). */
export async function githubCliToken(): Promise<string | null> {
	const { stdout } = await run('gh', ['auth', 'token'], { timeout: 10_000 }).catch(() => ({ stdout: '' }));
	return stdout.trim() || null;
}

/** The Keychain account name of a key: project name and key id, so keys never cross projects. */
export const keychainItemOf = (project: Pick<Project, 'name'>, keyId: string): string => `${project.name} · ${keyId}`;

/** Projects, their repositories and key references. Key values go straight to the Keychain. */
@Injectable()
export class ProjectsService {
	constructor(
		private readonly store: ConsoleStore,
		private readonly keychain: KeychainPort,
	) {}

	view(): ConsoleView {
		const file = this.store.read();
		return {
			workspaces: file.workspaces,
			projects: file.projects.map((p) => ({
				...p,
				keys: p.keys.map((k) => ({ ...k, state: stateWithExpiry(k.state, k.expiresAt) })),
			})),
		};
	}

	project(id: string): Project {
		const p = this.view().projects.find((x) => x.id === id);
		if (!p) throw new NotFoundException(`No project ${id}.`);
		return p;
	}

	repository(projectId: string, repoId: string): { project: Project; repo: Repository } {
		const project = this.project(projectId);
		const repo = project.repositories.find((r) => r.id === repoId);
		if (!repo) throw new NotFoundException(`No repository ${repoId} in ${project.name}.`);
		return { project, repo };
	}

	add(input: NewProject): Project {
		const file = this.store.read();
		if (file.projects.some((p) => p.id === input.id || p.name.toLowerCase() === input.name.toLowerCase()))
			throw new ConflictException('A project with that name exists.');
		const ids = input.repositories.map((r) => r.id);
		if (new Set(ids).size !== ids.length) throw new ConflictException('Two repositories share an id.');
		const project: Project = { ...input, keys: [], createdAt: new Date().toISOString() };
		this.store.update((f) => ({
			...f,
			workspaces: [...new Set([...f.workspaces, project.workspace])],
			projects: [...f.projects, project],
		}));
		this.store.audit(
			project.id,
			'project-added',
			`${project.name} added with ${project.repositories.length} repositories`,
		);
		return project;
	}

	async remove(id: string): Promise<void> {
		const project = this.project(id);
		for (const k of project.keys) if (k.keychainItem) await this.keychain.remove(k.keychainItem);
		this.store.update((f) => ({ ...f, projects: f.projects.filter((p) => p.id !== id) }));
		this.store.audit(id, 'project-removed', `${project.name} removed with its ${project.keys.length} keys`);
	}

	async storeKey(projectId: string, input: StoreKey): Promise<KeyRef> {
		const project = this.project(projectId);
		const kind = KEY_KINDS[input.kind];
		if (kind.stored && !input.value) throw new ConflictException('Paste the key value.');
		const keychainItem = kind.stored ? keychainItemOf(project, input.id) : '';
		if (kind.stored) await this.keychain.set(keychainItem, input.value);
		const ref: KeyRef = {
			id: input.id,
			kind: input.kind,
			label: input.label,
			keychainItem,
			account: '',
			rights: [],
			expiresAt: input.expiresAt,
			checkedAt: null,
			state: 'unchecked',
			note: input.note,
			target: input.target,
		};
		this.saveKey(projectId, ref);
		this.store.audit(
			projectId,
			'key-stored',
			`${input.label} (${input.id}) ${kind.stored ? 'stored in the Keychain' : 'linked'}`,
		);
		return this.checkKeyNow(projectId, input.id);
	}

	async checkKeyNow(projectId: string, keyId: string): Promise<KeyRef> {
		const project = this.project(projectId);
		const ref = project.keys.find((k) => k.id === keyId);
		if (!ref) throw new NotFoundException(`No key ${keyId}.`);
		const value = await this.valueOf(ref);
		const repos = project.repositories
			.filter((r) => r.sourceCode.keyId === keyId)
			.map((r) => r.sourceCode.repository);
		const check = value
			? await checkKey(ref.kind, value, repos, ref.target)
			: { state: 'failed' as const, account: '', rights: [], note: 'The Keychain has no value for this key.' };
		const next: KeyRef = {
			...ref,
			account: check.account || ref.account,
			rights: check.rights,
			expiresAt: check.expiresAt === undefined ? ref.expiresAt : (check.expiresAt ?? ref.expiresAt),
			checkedAt: new Date().toISOString(),
			state: check.state,
			note: check.note,
		};
		next.state = stateWithExpiry(next.state, next.expiresAt);
		this.saveKey(projectId, next);
		this.store.audit(projectId, 'key-checked', `${ref.label}: ${next.state}`);
		return next;
	}

	async removeKey(projectId: string, keyId: string): Promise<void> {
		const ref = this.project(projectId).keys.find((k) => k.id === keyId);
		if (!ref) throw new NotFoundException(`No key ${keyId}.`);
		if (ref.keychainItem) await this.keychain.remove(ref.keychainItem);
		this.store.update((f) => ({
			...f,
			projects: f.projects.map((p) =>
				p.id !== projectId
					? p
					: {
							...p,
							keys: p.keys.filter((k) => k.id !== keyId),
							repositories: p.repositories.map((r) => ({
								...r,
								sourceCode: {
									...r.sourceCode,
									keyId: r.sourceCode.keyId === keyId ? null : r.sourceCode.keyId,
								},
								cloud: r.cloud.map((c) => ({ ...c, keyIds: c.keyIds.filter((k) => k !== keyId) })),
								edge: r.edge.map((e) => ({ ...e, keyIds: e.keyIds.filter((k) => k !== keyId) })),
							})),
						},
			),
		}));
		this.store.audit(projectId, 'key-removed', `${ref.label} (${keyId}) removed from the Keychain`);
	}

	setSlotKeys(projectId: string, input: SlotKeys): Project {
		const project = this.project(projectId);
		const known = new Set(project.keys.map((k) => k.id));
		const unknown = input.keyIds.filter((k) => !known.has(k));
		if (unknown.length) throw new NotFoundException(`No key ${unknown.join(', ')} in ${project.name}.`);
		const { repo } = this.repository(projectId, input.repositoryId);
		if (input.slot === 'cloud' && !repo.cloud.some((c) => c.id === input.slotId))
			throw new NotFoundException('No such cloud slot.');
		if (input.slot === 'edge' && !repo.edge.some((e) => e.id === input.slotId))
			throw new NotFoundException('No such edge slot.');
		this.store.update((f) => ({
			...f,
			projects: f.projects.map((p) =>
				p.id !== projectId
					? p
					: {
							...p,
							repositories: p.repositories.map((r) =>
								r.id !== input.repositoryId
									? r
									: input.slot === 'source-code'
										? { ...r, sourceCode: { ...r.sourceCode, keyId: input.keyIds[0] ?? null } }
										: input.slot === 'cloud'
											? {
													...r,
													cloud: r.cloud.map((c) =>
														c.id === input.slotId ? { ...c, keyIds: input.keyIds } : c,
													),
												}
											: {
													...r,
													edge: r.edge.map((e) =>
														e.id === input.slotId ? { ...e, keyIds: input.keyIds } : e,
													),
												},
							),
						},
			),
		}));
		this.store.audit(
			projectId,
			'slot-keys-changed',
			`${input.repositoryId} ${input.slot}${input.slotId ? ` ${input.slotId}` : ''}: ${input.keyIds.join(', ') || 'none'}`,
		);
		return this.project(projectId);
	}

	addRepository(projectId: string, repo: Repository): Project {
		const project = this.project(projectId);
		if (project.repositories.some((r) => r.id === repo.id))
			throw new ConflictException(`${project.name} has a repository ${repo.id}.`);
		this.replaceRepositories(projectId, [...project.repositories, this.keepKnownKeys(project, repo)]);
		this.store.audit(projectId, 'repository-added', `${repo.name} (${repo.sourceCode.repository}) added`);
		return this.project(projectId);
	}

	/** Replaces a repository's settings; key ids the project does not hold are dropped. */
	updateRepository(projectId: string, repoId: string, repo: Repository): Project {
		const { project } = this.repository(projectId, repoId);
		if (repo.id !== repoId) throw new ConflictException('A repository keeps its id.');
		this.replaceRepositories(
			projectId,
			project.repositories.map((r) => (r.id === repoId ? this.keepKnownKeys(project, repo) : r)),
		);
		this.store.audit(projectId, 'repository-changed', `${repo.name}: settings saved`);
		return this.project(projectId);
	}

	removeRepository(projectId: string, repoId: string): Project {
		const { project, repo } = this.repository(projectId, repoId);
		if (project.repositories.length === 1)
			throw new ConflictException('A project keeps at least one repository; remove the project instead.');
		this.replaceRepositories(
			projectId,
			project.repositories.filter((r) => r.id !== repoId),
		);
		this.store.audit(projectId, 'repository-removed', `${repo.name} removed; the project's keys stay`);
		return this.project(projectId);
	}

	private keepKnownKeys(project: Project, repo: Repository): Repository {
		const known = new Set(project.keys.map((k) => k.id));
		const ids = (list: string[]) => list.filter((k) => known.has(k));
		return {
			...repo,
			sourceCode: {
				...repo.sourceCode,
				keyId: repo.sourceCode.keyId && known.has(repo.sourceCode.keyId) ? repo.sourceCode.keyId : null,
			},
			cloud: repo.cloud.map((c) => ({ ...c, keyIds: ids(c.keyIds) })),
			edge: repo.edge.map((e) => ({ ...e, keyIds: ids(e.keyIds) })),
		};
	}

	private replaceRepositories(projectId: string, repositories: Repository[]): void {
		const ids = repositories.map((r) => r.id);
		if (new Set(ids).size !== ids.length) throw new ConflictException('Two repositories share an id.');
		this.store.update((f) => ({
			...f,
			projects: f.projects.map((p) => (p.id === projectId ? { ...p, repositories } : p)),
		}));
	}

	/** The key's value for a vendor call, held in memory for that call only. */
	async valueOf(ref: KeyRef): Promise<string | null> {
		if (ref.kind === 'github-cli') return githubCliToken();
		return ref.keychainItem ? this.keychain.get(ref.keychainItem) : null;
	}

	private saveKey(projectId: string, ref: KeyRef): void {
		this.store.update((f) => ({
			...f,
			projects: f.projects.map((p) =>
				p.id !== projectId ? p : { ...p, keys: [...p.keys.filter((k) => k.id !== ref.id), ref] },
			),
		}));
	}
}
