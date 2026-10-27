import type { ScriptProblem, ScriptSet } from '../sim/scripts';
import type { Tile } from '../sim/world';
import type { WorldOverview } from './worldMap';

export type Mode = 'single' | 'multi';

/** A request the server refused, with its explanation (and, for code that doesn't parse, where). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem: ScriptProblem | null = null,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    keepalive,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const problem = (data.problem as ScriptProblem | undefined) ?? null;
    throw new ApiError(data.error ?? (problem ? `${problem.file}.bee line ${problem.line}: ${problem.message}` : `The server answered ${res.status}.`), res.status, problem);
  }
  return data as T;
}

export interface ColonyStatus {
  exists: boolean;
  over: string | null;
  tick: number;
  tickMs: number;
  map: Tile | null; // the map the colony's hive is on
  set: ScriptSet | null; // the code that is running
}

export const api = {
  /** The signed-in username, or null when nobody is signed in. */
  me: () =>
    call<{ username: string }>('GET', '/api/me').then(
      r => r.username,
      e => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e)),
    ),
  signup: (username: string, password: string) => call<{ username: string }>('POST', '/api/signup', { username, password }),
  login: (username: string, password: string) => call<{ username: string }>('POST', '/api/login', { username, password }),
  logout: () => call('POST', '/api/logout'),

  scripts: (mode: Mode) => call<{ set: ScriptSet; fresh: boolean }>('GET', `/api/scripts/${mode}`),
  saveScript: (mode: Mode, file: string, code: string, position: number, keepalive = false) =>
    call('PUT', `/api/scripts/${mode}/${file}`, { code, position }, keepalive),
  deleteScript: (mode: Mode, file: string) => call('DELETE', `/api/scripts/${mode}/${file}`),

  tutorial: () => call<{ done: string[] }>('GET', '/api/tutorial'),
  lessonDone: (id: string) => call('POST', `/api/tutorial/${id}/done`),
  world: () => call<WorldOverview>('GET', '/api/world'),
  leaderboard: () =>
    call<{
      world: number;
      tick: number;
      colonies: { owner: string | null; mine: boolean; map: Tile; bees: number; wasps: number; honey: number; made: number; stolen: number; kills: number; age: number }[];
    }>('GET', '/api/leaderboard'),
  colony: () => call<ColonyStatus>('GET', '/api/colony'),
  startColony: (set: ScriptSet, map: Tile, hive?: Tile) => call<ColonyStatus>('POST', '/api/colony/start', { set, map, hive }),
  deploy: (set: ScriptSet) => call<{ ok: true; tick: number }>('POST', '/api/colony/deploy', { set }),
};
