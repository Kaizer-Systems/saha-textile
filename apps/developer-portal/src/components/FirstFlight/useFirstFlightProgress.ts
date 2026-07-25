/* ============================================================================
 * NEXT-GEN-UI · First Flight device-local progress boundary
 * ----------------------------------------------------------------------------
 * WHAT: a minimal, versioned browser-storage adapter for optional per-persona
 * resume and completion state.
 * WHY: contributors may resume a governed reading flight without creating an
 * account, telemetry event, application record, or repository mutation.
 * HOW: explicit opt-in creates one record containing only persona id, furthest
 * governed stop id, completion state, and optional completion time. Every read
 * is narrowed against the current compiled persona/stop dataset before use.
 * TUNING: storage key/version/resume semantics live in the governed
 * first-flight.json policy. UI copy and controls live in FirstFlight components.
 *
 * Privacy boundary: never store routes, page content, search/history, source
 * paths, user identifiers, free text, or analytics. Storage failure degrades to
 * a fully usable non-persistent flight.
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FirstFlightPersona, FirstFlightPersonaId, FirstFlightProgressPolicy } from '@site/src/data/first-flight';

const PROGRESS_EVENT = 'saha-textile:portal:first-flight-progress';

export type FirstFlightProgressRecord = {
	personaId: FirstFlightPersonaId;
	stopId: string;
	completed: boolean;
	completedAt?: string;
};

type FirstFlightProgressRecords = Partial<Record<FirstFlightPersonaId, FirstFlightProgressRecord>>;

type StoredFirstFlightProgress = {
	version: 1;
	records: FirstFlightProgressRecords;
};

export type FirstFlightStorageIssue = 'invalid' | 'unavailable' | 'write-failed';

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCompletionTime(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function parseStoredProgress(
	value: string,
	policy: FirstFlightProgressPolicy,
	personas: FirstFlightPersona[],
): FirstFlightProgressRecords | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!isObject(parsed) || parsed.version !== policy.payloadVersion || !isObject(parsed.records)) {
		return null;
	}

	const personasById = new Map(personas.map((persona) => [persona.id, persona]));
	const records: FirstFlightProgressRecords = {};
	for (const [personaId, candidate] of Object.entries(parsed.records)) {
		const persona = personasById.get(personaId as FirstFlightPersonaId);
		if (!persona || !isObject(candidate)) return null;
		if (candidate.personaId !== persona.id || typeof candidate.stopId !== 'string') return null;
		const stopIndex = persona.stops.findIndex((stop) => stop.id === candidate.stopId);
		if (stopIndex < 0 || typeof candidate.completed !== 'boolean') return null;
		if (candidate.completed && stopIndex !== persona.stops.length - 1) return null;
		if (
			candidate.completedAt !== undefined &&
			(!candidate.completed || !isValidCompletionTime(candidate.completedAt))
		) {
			return null;
		}
		records[persona.id] = {
			personaId: persona.id,
			stopId: candidate.stopId,
			completed: candidate.completed,
			...(candidate.completedAt ? { completedAt: candidate.completedAt } : {}),
		};
	}
	return records;
}

function writeStoredProgress(policy: FirstFlightProgressPolicy, records: FirstFlightProgressRecords): void {
	if (Object.keys(records).length === 0) {
		window.localStorage.removeItem(policy.storageKey);
	} else {
		const payload: StoredFirstFlightProgress = {
			version: policy.payloadVersion,
			records,
		};
		window.localStorage.setItem(policy.storageKey, JSON.stringify(payload));
	}
	window.queueMicrotask(() => window.dispatchEvent(new Event(PROGRESS_EVENT)));
}

export function getFirstFlightResumeIndex(
	persona: FirstFlightPersona,
	record: FirstFlightProgressRecord | undefined,
): number {
	if (!record) return 0;
	const index = persona.stops.findIndex((stop) => stop.id === record.stopId);
	return index >= 0 ? index : 0;
}

export function useFirstFlightProgress(policy: FirstFlightProgressPolicy, personas: FirstFlightPersona[]) {
	const [records, setRecords] = useState<FirstFlightProgressRecords>({});
	const recordsRef = useRef<FirstFlightProgressRecords>({});
	const [hydrated, setHydrated] = useState(false);
	const [storageError, setStorageError] = useState<string | null>(null);
	const [storageIssue, setStorageIssue] = useState<FirstFlightStorageIssue | null>(null);
	const [hasStoredPayload, setHasStoredPayload] = useState(false);

	const readCurrent = useCallback(() => {
		try {
			const raw = window.localStorage.getItem(policy.storageKey);
			if (!raw) {
				recordsRef.current = {};
				setRecords({});
				setStorageError(null);
				setStorageIssue(null);
				setHasStoredPayload(false);
				return;
			}
			setHasStoredPayload(true);
			const parsed = parseStoredProgress(raw, policy, personas);
			if (!parsed) {
				recordsRef.current = {};
				setRecords({});
				setStorageError(
					'Saved First Flight progress is invalid and was ignored. Return to Launch Bay and reset it to continue saving.',
				);
				setStorageIssue('invalid');
				return;
			}
			recordsRef.current = parsed;
			setRecords(parsed);
			setStorageError(null);
			setStorageIssue(null);
		} catch {
			recordsRef.current = {};
			setRecords({});
			setStorageError('This browser is not allowing First Flight device-local progress.');
			setStorageIssue('unavailable');
			setHasStoredPayload(false);
		}
	}, [personas, policy]);

	useEffect(() => {
		readCurrent();
		setHydrated(true);
		const onStorage = (event: StorageEvent) => {
			if (event.key === policy.storageKey || event.key === null) readCurrent();
		};
		const onProgress = () => readCurrent();
		window.addEventListener('storage', onStorage);
		window.addEventListener(PROGRESS_EVENT, onProgress);
		return () => {
			window.removeEventListener('storage', onStorage);
			window.removeEventListener(PROGRESS_EVENT, onProgress);
		};
	}, [policy.storageKey, readCurrent]);

	const commit = useCallback(
		(update: (current: FirstFlightProgressRecords) => FirstFlightProgressRecords) => {
			const current = recordsRef.current;
			const next = update(current);
			if (next === current) return;
			try {
				writeStoredProgress(policy, next);
				recordsRef.current = next;
				setRecords(next);
				setStorageError(null);
				setStorageIssue(null);
				setHasStoredPayload(Object.keys(next).length > 0);
			} catch {
				setStorageError('This browser could not save First Flight progress.');
				setStorageIssue('write-failed');
			}
		},
		[policy],
	);

	const remember = useCallback(
		(persona: FirstFlightPersona, stepIndex = 0) => {
			const stop = persona.stops[stepIndex];
			if (!stop) return;
			commit((current) => ({
				...current,
				[persona.id]: {
					personaId: persona.id,
					stopId: stop.id,
					completed: false,
				},
			}));
		},
		[commit],
	);

	const recordReached = useCallback(
		(persona: FirstFlightPersona, stepIndex: number) => {
			const stop = persona.stops[stepIndex];
			if (!stop) return;
			commit((current) => {
				const existing = current[persona.id];
				if (!existing || existing.completed) return current;
				const existingIndex = getFirstFlightResumeIndex(persona, existing);
				if (stepIndex <= existingIndex) return current;
				return {
					...current,
					[persona.id]: {
						personaId: persona.id,
						stopId: stop.id,
						completed: false,
					},
				};
			});
		},
		[commit],
	);

	const complete = useCallback(
		(persona: FirstFlightPersona) => {
			const finalStop = persona.stops.at(-1);
			if (!finalStop) return;
			commit((current) => {
				if (!current[persona.id]) return current;
				return {
					...current,
					[persona.id]: {
						personaId: persona.id,
						stopId: finalStop.id,
						completed: true,
						completedAt: new Date().toISOString(),
					},
				};
			});
		},
		[commit],
	);

	const forget = useCallback(
		(personaId: FirstFlightPersonaId) => {
			commit((current) => {
				const next = { ...current };
				delete next[personaId];
				return next;
			});
		},
		[commit],
	);

	const resetAll = useCallback(() => {
		commit(() => ({}));
	}, [commit]);

	return useMemo(
		() => ({
			records,
			hydrated,
			storageError,
			storageIssue,
			hasAnyRecords: Object.keys(records).length > 0,
			canReset: hasStoredPayload || Object.keys(records).length > 0,
			remember,
			recordReached,
			complete,
			forget,
			resetAll,
		}),
		[
			complete,
			forget,
			hasStoredPayload,
			hydrated,
			recordReached,
			records,
			remember,
			resetAll,
			storageError,
			storageIssue,
		],
	);
}
