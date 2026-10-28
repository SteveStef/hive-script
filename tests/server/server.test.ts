// Server tests against a real Postgres: npm run db:up, then npm run test:server.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import type { WorldServer } from '../../server/worlds';
import { connect, migrate, type Sql } from '../../server/db';
import { DEFAULT_FORAGER, DEFAULT_QUEEN, DEFAULT_SHARED } from '../../src/defaultScript';
import type { ScriptSet } from '../../src/sim/scripts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://hive:hive@localhost:5433/hive_test';
let sql: Sql;
let app: FastifyInstance;
let worlds: WorldServer;

beforeAll(async () => {
  sql = connect(url);
  await migrate(sql);
});
afterAll(async () => {
  await app?.close();
  await sql.end();
});
beforeEach(async () => {
  await sql`TRUNCATE users, sessions, scripts, deploys, colonies, events, worlds, tutorial RESTART IDENTITY CASCADE`;
  await app?.close();
  ({ app, worlds } = await buildApp(sql, { nests: 0 })); // no wild nests, so any map can be picked; one test adds them
});

/** Signs up and returns the session cookie for later requests. */
async function signup(username: string, password = 'correct horse'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/signup', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find(c => c.name === 'sid')!;
  return `sid=${cookie.value}`;
}
const as = (cookie: string) => ({ headers: { cookie } });
const set = (over: Partial<ScriptSet> = {}): ScriptSet => ({ forager: DEFAULT_FORAGER, queen: DEFAULT_QUEEN, shared: DEFAULT_SHARED, roles: [], ...over });

describe('accounts', () => {
  it('signs up, knows who you are, and logs out', async () => {
    const cookie = await signup('mossbeard');
    expect((await app.inject({ url: '/api/me', ...as(cookie) })).json()).toEqual({ username: 'mossbeard' });
    await app.inject({ method: 'POST', url: '/api/logout', ...as(cookie) });
    expect((await app.inject({ url: '/api/me', ...as(cookie) })).statusCode).toBe(401);
  });

  it('refuses taken, badly formed and too-short sign-ups', async () => {
    await signup('ada');
    const post = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/signup', payload: { username, password } });
    expect((await post('ADA', 'long enough pw')).statusCode).toBe(409);
    expect((await post('a!', 'long enough pw')).statusCode).toBe(400);
    expect((await post('newbee', 'short')).statusCode).toBe(400);
    expect((await post('wild', 'long enough pw')).statusCode).toBe(400); // owner_at() means wild wasps by it
  });

  it('stores only a hash of the password', async () => {
    await signup('hashme', 'my secret phrase');
    const [row] = await sql`SELECT password_hash FROM users WHERE username = 'hashme'`;
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain('my secret phrase');
  });

  it('logs in with the right password, and slows down guessing', async () => {
    await signup('queenbyte', 'right password');
    const login = (password: string) => app.inject({ method: 'POST', url: '/api/login', payload: { username: 'queenbyte', password } });
    expect((await login('wrong password')).statusCode).toBe(401);
    expect((await login('right password')).statusCode).toBe(200);
    for (let i = 0; i < 10; i++) await login('still wrong');
    expect((await login('right password')).statusCode).toBe(429);
  });
});

describe('tutorial progress', () => {
  it('remembers finished lessons per player, and ignores repeats and made-up lessons', async () => {
    const a = await signup('learner_a');
    const b = await signup('learner_b');
    const done = (cookie: string, id: string) => app.inject({ method: 'POST', url: `/api/tutorial/${id}/done`, ...as(cookie) });
    expect((await done(a, 'first-bee')).statusCode).toBe(200);
    expect((await done(a, 'first-bee')).statusCode).toBe(200);
    expect((await done(a, 'nectar')).statusCode).toBe(200);
    expect((await done(a, 'not-a-lesson')).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/tutorial', ...as(a) })).json()).toEqual({ done: ['first-bee', 'nectar'] });
    expect((await app.inject({ url: '/api/tutorial', ...as(b) })).json()).toEqual({ done: [] });
    expect((await app.inject({ url: '/api/tutorial' })).statusCode).toBe(401);
  });
});

describe('saved scripts', () => {
  it('seeds the defaults once, then saves, lists and deletes roles per mode', async () => {
    const cookie = await signup('drone42');
    const first = (await app.inject({ url: '/api/scripts/single', ...as(cookie) })).json();
    expect(first.fresh).toBe(true);
    expect(first.set.forager).toBe(DEFAULT_FORAGER);
    expect((await app.inject({ url: '/api/scripts/single', ...as(cookie) })).json().fresh).toBe(false);

    const put = (mode: string, file: string, code: string) => app.inject({ method: 'PUT', url: `/api/scripts/${mode}/${file}`, payload: { code }, ...as(cookie) });
    expect((await put('single', 'builder', 'wait(1)')).statusCode).toBe(200);
    expect((await put('single', 'forager', 'move(East)')).statusCode).toBe(200);
    const after = (await app.inject({ url: '/api/scripts/single', ...as(cookie) })).json();
    expect(after.set.roles).toEqual([['builder', 'wait(1)']]);
    expect(after.set.forager).toBe('move(East)');
    // multiplayer drafts are a separate set
    expect((await app.inject({ url: '/api/scripts/multi', ...as(cookie) })).json().set.roles).toEqual([]);

    for (const r of ['b2', 'b3', 'b4', 'b5']) expect((await put('single', r, '')).statusCode).toBe(200);
    expect((await put('single', 'b6', '')).statusCode).toBe(400); // five roles at most
    expect((await put('single', 'Bad-Name', '')).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/scripts/single/forager', ...as(cookie) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/scripts/single/builder', ...as(cookie) })).statusCode).toBe(200);
  });

  it("can't be read without logging in, or by another player", async () => {
    const a = await signup('alice_b');
    await app.inject({ method: 'PUT', url: '/api/scripts/single/forager', payload: { code: 'print("mine")' }, ...as(a) });
    expect((await app.inject({ url: '/api/scripts/single' })).statusCode).toBe(401);
    const b = await signup('bob_b');
    expect((await app.inject({ url: '/api/scripts/single', ...as(b) })).json().set.forager).toBe(DEFAULT_FORAGER);
  });
});

describe('the shared world', () => {
  const start = (cookie: string, map: { x: number; y: number }, files = set()) =>
    app.inject({ method: 'POST', url: '/api/colony/start', payload: { set: files, map }, ...as(cookie) });
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) await worlds.tick();
    await worlds.flush(); // events and saves are written in the background
  };

  it('founds a colony with its hive where the player put it, and refuses a spot the skep does not fit', async () => {
    const cookie = await signup('placer');
    const go = (hive: { x: number; y: number }) =>
      app.inject({ method: 'POST', url: '/api/colony/start', payload: { set: set(), map: { x: 3, y: 0 }, hive }, ...as(cookie) });
    const elsewhere = await go({ x: 2, y: 6 }); // on map [0, 0], not [3, 0]
    expect(elsewhere.statusCode).toBe(409);
    expect(elsewhere.json().error).toMatch(/isn't on map \[3, 0\]/);
    expect((await go({ x: 3 * 20 + 5, y: 1 })).json().error).toMatch(/doesn't fit/);
    expect((await go({ x: 3 * 20 + 2, y: 6 })).statusCode).toBe(200); // the usual spot, which always fits
    const world = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(world.maps.find((m: { mine: boolean }) => m.mine)).toMatchObject({ map: { x: 3, y: 0 }, hive: { x: 62, y: 6 } });
  });

  it('shows a 5x5 world of free maps, founds a colony on one, and refuses a second', async () => {
    const cookie = await signup('pollenpal');
    const before = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(before.maps).toHaveLength(25);
    expect(before.home).toBeNull();
    expect(before.maps.every((m: { owner: string | null }) => m.owner === null)).toBe(true);

    expect((await start(cookie, { x: 1, y: 2 })).json()).toMatchObject({ exists: true, map: { x: 1, y: 2 } });
    await ticks(400);
    expect((await app.inject({ url: '/api/colony', ...as(cookie) })).json()).toMatchObject({ exists: true, tick: 400, over: null });
    const after = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(after.home).toEqual({ x: 1, y: 2 });
    expect(after.maps.find((m: { owner: string | null }) => m.owner === 'pollenpal')).toMatchObject({ map: { x: 1, y: 2 }, mine: true });
    const events = await sql`SELECT text FROM events`;
    expect(events.some(e => String(e.text).includes('founded on map [1, 2]'))).toBe(true);
    expect((await start(cookie, { x: 3, y: 3 })).statusCode).toBe(409);
  });

  it('puts two players in one world, on different maps, and refuses a taken or made-up map', async () => {
    const a = await signup('ada_n');
    const b = await signup('bo_n');
    await start(a, { x: 2, y: 2 });
    const taken = await start(b, { x: 2, y: 2 });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatch(/ada_n already holds map \[2, 2\]/);
    expect((await start(b, { x: 5, y: 0 })).statusCode).toBe(400);
    expect((await start(b, { x: 3, y: 2 })).statusCode).toBe(200);
    const view = (await app.inject({ url: '/api/world', ...as(b) })).json();
    expect(view.maps.filter((m: { owner: string | null }) => m.owner).map((m: { owner: string }) => m.owner).sort()).toEqual(['ada_n', 'bo_n']);
    expect((await sql`SELECT count(*)::int AS n FROM worlds`)[0].n).toBe(1);
  });

  it('rejects code that does not parse, naming the file and line, and changes nothing', async () => {
    const cookie = await signup('wax_on');
    const bad = await start(cookie, { x: 0, y: 0 }, set({ queen: 'while True\n    lay()' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().problem).toMatchObject({ file: 'queen', line: 1 });
    expect((await app.inject({ url: '/api/colony', ...as(cookie) })).json().exists).toBe(false);

    await start(cookie, { x: 0, y: 0 });
    const badShared = await app.inject({ method: 'POST', url: '/api/colony/deploy', payload: { set: set({ shared: 'x = 1\ny = (' }) }, ...as(cookie) });
    expect(badShared.json().problem).toMatchObject({ file: 'shared', line: 2 });
    expect((await sql`SELECT count(*)::int AS n FROM deploys`)[0].n).toBe(1);
  });

  it('deploys new code that every bee runs from the next tick', async () => {
    const cookie = await signup('beebop');
    await start(cookie, { x: 4, y: 4 });
    await ticks(20);
    const res = await app.inject({ method: 'POST', url: '/api/colony/deploy', payload: { set: set({ forager: 'print("v2")\nwhile True:\n    wait(100)' }) }, ...as(cookie) });
    expect(res.json()).toMatchObject({ ok: true, tick: 20 });
    expect((await sql`SELECT count(*)::int AS n FROM deploys`)[0].n).toBe(2);
  });

  it('frees the map of a colony that died out, so its player can pick again', async () => {
    const cookie = await signup('shortlived');
    // a new colony has no bees and 10 honey: the queen's one egg hatches at once into a bee that quits
    await start(cookie, { x: 1, y: 1 }, set({ forager: 'die()', queen: 'lay()\nwhile True:\n    wait(100)' }));
    await ticks(40);
    expect((await app.inject({ url: '/api/colony', ...as(cookie) })).json().exists).toBe(false);
    const view = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(view.fallen).toMatch(/died out/);
    expect(view.maps.every((m: { owner: string | null }) => m.owner === null)).toBe(true);
    expect((await start(cookie, { x: 1, y: 1 })).statusCode).toBe(200);
  });

  it('a new colony starts with no bees and 10 honey, and its first bee hatches at once', async () => {
    const cookie = await signup('freshhive');
    await start(cookie, { x: 2, y: 2 }, set({ queen: 'lay()\nwhile True:\n    wait(100)' }));
    const before = (await app.inject({ url: '/api/world', ...as(cookie) })).json().maps.find((m: { mine: boolean }) => m.mine);
    expect([before.bees, before.honey]).toEqual([0, 10]);
    await ticks(40);
    const after = (await app.inject({ url: '/api/world', ...as(cookie) })).json().maps.find((m: { mine: boolean }) => m.mine);
    expect([after.bees, after.honey]).toEqual([1, 0]);
  });

  it('a restarted server picks every world up where it was saved', async () => {
    const a = await signup('honeyhex');
    const b = await signup('combcat');
    await start(a, { x: 0, y: 0 });
    await start(b, { x: 1, y: 0 });
    await ticks(130);
    await worlds.stop(); // saves, as on SIGTERM
    await app.close();
    ({ app, worlds } = await buildApp(sql, { nests: 0 }));
    await worlds.loadAll();
    expect((await app.inject({ url: '/api/colony', ...as(a) })).json()).toMatchObject({ exists: true, tick: 130, map: { x: 0, y: 0 } });
    expect((await app.inject({ url: '/api/colony', ...as(b) })).json()).toMatchObject({ exists: true, map: { x: 1, y: 0 } });
    await ticks(1);
    expect((await app.inject({ url: '/api/colony', ...as(a) })).json().tick).toBe(131);
  });

  it('hangs wild nests on maps no one can found a colony on', async () => {
    await app.close();
    ({ app, worlds } = await buildApp(sql)); // the real number of nests
    const cookie = await signup('nestwatch');
    const view = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    const nests = view.maps.filter((m: { nest: boolean }) => m.nest);
    expect(nests).toHaveLength(3);
    const refused = await start(cookie, nests[0].map);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/wild wasp nest/);
    const free = view.maps.find((m: { nest: boolean }) => !m.nest).map;
    expect((await start(cookie, free)).statusCode).toBe(200);
  });

  it('streams the watched map after what happened while away, and can watch a neighbor', async () => {
    const a = await signup('ada_ws');
    const b = await signup('bo_ws');
    await start(a, { x: 2, y: 2 });
    await start(b, { x: 3, y: 2 });
    await app.ready();
    const ws = await app.injectWS('/ws', { headers: { cookie: a } });
    const messages: { type: string; colony?: { tick: number; map: { x: number; y: number }; otherHives: { owner: string }[]; colony: { hive: { x: number } } | null } }[] = [];
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(String(data))));
    await new Promise(r => setTimeout(r, 50));
    await worlds.tick();
    ws.send(JSON.stringify({ type: 'watch', map: { x: 3, y: 2 } }));
    await new Promise(r => setTimeout(r, 50));
    ws.terminate();
    expect(messages.map(m => m.type)).toEqual(['away', 'chat-history', 'state', 'state', 'state']);
    expect(messages[3].colony).toMatchObject({ tick: 1, map: { x: 2, y: 2 }, otherHives: [] });
    const neighbor = messages[4].colony!;
    expect(neighbor.map).toEqual({ x: 3, y: 2 });
    expect(neighbor.otherHives).toEqual([{ x: 62, y: 30, owner: 'bo_ws', shielded: true, honey: expect.any(Number) }]); // a new colony, still protected
    expect(neighbor.colony!.hive.x).toBe(42); // still ada's own colony, for the HUD
  });

  it('ranks the colonies of a world by honey brought home', async () => {
    const a = await signup('ranker_a');
    const b = await signup('ranker_b');
    await start(a, { x: 0, y: 0 });
    await start(b, { x: 4, y: 4 });
    await ticks(1500);
    const board = (await app.inject({ url: '/api/leaderboard', ...as(a) })).json();
    expect(board.colonies.map((c: { owner: string }) => c.owner).sort()).toEqual(['ranker_a', 'ranker_b']);
    const made = board.colonies.map((c: { made: number }) => c.made);
    expect(made).toEqual([...made].sort((x: number, y: number) => y - x));
    expect(board.colonies.find((c: { mine: boolean }) => c.mine).owner).toBe('ranker_a');
    expect(board.colonies[0]).toMatchObject({ age: 1500, wasps: 0, stolen: 0, kills: 0 });
  });

  it('sends chat to everyone in the world, keeps it for newcomers, and slows down spam', async () => {
    const a = await signup('chatty_a');
    const b = await signup('chatty_b');
    await start(a, { x: 1, y: 1 });
    await app.ready();
    const listen = async (cookie: string) => {
      const ws = await app.injectWS('/ws', { headers: { cookie } });
      const got: { type: string; message?: { username: string; text: string }; messages?: { username: string; text: string }[]; problem?: string }[] = [];
      ws.on('message', (data: Buffer) => got.push(JSON.parse(String(data))));
      await new Promise(r => setTimeout(r, 50));
      return { ws, got };
    };
    const one = await listen(a);
    const two = await listen(b);
    one.ws.send(JSON.stringify({ type: 'chat', text: '  hello   neighbors  ' }));
    one.ws.send(JSON.stringify({ type: 'chat', text: 'and again' })); // too soon
    two.ws.send(JSON.stringify({ type: 'chat', text: 'x'.repeat(281) }));
    await new Promise(r => setTimeout(r, 100));
    expect(two.got.filter(m => m.type === 'chat').map(m => m.message)).toMatchObject([{ username: 'chatty_a', text: 'hello neighbors' }]);
    expect(one.got.filter(m => m.type === 'chat-problem').map(m => m.problem)).toEqual(['One message a second, please.']);
    expect(two.got.filter(m => m.type === 'chat-problem').map(m => m.problem)).toEqual(['Keep messages to 280 characters.']);
    one.ws.terminate();
    two.ws.terminate();
    const later = await listen(b);
    expect(later.got.find(m => m.type === 'chat-history')!.messages).toMatchObject([{ username: 'chatty_a', text: 'hello neighbors' }]);
    later.ws.terminate();
  });

  it('protects a new colony for a while, then lets the protection lapse', async () => {
    await app.close();
    ({ app, worlds } = await buildApp(sql, { nests: 0, shieldMs: 300 }));
    const cookie = await signup('newcomer');
    await start(cookie, { x: 2, y: 3 });
    const before = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(before.maps.find((m: { mine: boolean }) => m.mine).shieldEnds).toBeGreaterThan(Date.now());
    const events = await sql`SELECT text FROM events`;
    expect(events.some(e => String(e.text).includes('protected for'))).toBe(true);
    await new Promise(r => setTimeout(r, 350));
    await ticks(1);
    const after = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(after.maps.find((m: { mine: boolean }) => m.mine).shieldEnds).toBeNull();
    const ended = await sql`SELECT text FROM events WHERE tone = 'raid'`;
    expect(ended.some(e => String(e.text).includes('protection as a new colony has ended'))).toBe(true);
  });

  const abandon = (cookie: string) => app.inject({ method: 'POST', url: '/api/colony/abandon', ...as(cookie) });
  const myShield = async (cookie: string) => (await app.inject({ url: '/api/world', ...as(cookie) })).json().maps.find((m: { mine: boolean }) => m.mine)?.shieldEnds ?? null;

  it('abandons a colony: its map is free, and a colony founded again keeps only what was left of the protection', async () => {
    const cookie = await signup('quitter');
    expect((await abandon(cookie)).statusCode).toBe(404); // nothing to abandon yet
    await start(cookie, { x: 1, y: 1 });
    const firstShield = await myShield(cookie);
    expect(firstShield).toBeGreaterThan(Date.now());
    await ticks(5);

    expect((await abandon(cookie)).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/colony', ...as(cookie) })).json().exists).toBe(false);
    const world = (await app.inject({ url: '/api/world', ...as(cookie) })).json();
    expect(world.home).toBeNull();
    expect(world.fallen).toBe('You abandoned the colony.');
    expect(world.maps.find((m: { map: { x: number; y: number } }) => m.map.x === 1 && m.map.y === 1).owner).toBeNull();
    expect((await sql`SELECT text FROM events`).some(e => String(e.text).includes('Abandoned the colony on map [1, 1]'))).toBe(true);

    await start(cookie, { x: 3, y: 2 });
    expect(Math.abs((await myShield(cookie)) - firstShield)).toBeLessThan(1000); // the same window, not a fresh 24 hours
    expect((await sql`SELECT text FROM events`).some(e => String(e.text).includes('what was left of the protection'))).toBe(true);
  });

  it('a colony that attacked and was abandoned is followed by one with no protection; after the window, protection is fresh', async () => {
    await app.close();
    ({ app, worlds } = await buildApp(sql, { nests: 0, shieldMs: 400 }));
    const cookie = await signup('raider_q');
    await start(cookie, { x: 1, y: 1 });
    // as if its bees had attacked another player: the protection ended early
    const seats = (worlds as unknown as { seats: Map<number, { colony: { shielded: boolean; shieldEnds: number | null } }> }).seats;
    const colony = [...seats.values()][0].colony;
    colony.shielded = false;
    colony.shieldEnds = null;
    await abandon(cookie);
    await start(cookie, { x: 2, y: 1 });
    expect(await myShield(cookie)).toBeNull();
    expect((await sql`SELECT text FROM events`).some(e => String(e.text).includes("This colony isn't protected"))).toBe(true);

    await abandon(cookie);
    await new Promise(r => setTimeout(r, 450)); // the window closes
    await start(cookie, { x: 3, y: 1 });
    expect(await myShield(cookie)).toBeGreaterThan(Date.now() + 200);
  });
});
