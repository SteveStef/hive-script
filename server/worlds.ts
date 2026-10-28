import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { parseScripts, type ScriptSet } from '../src/sim/scripts';
import { toJson } from '../src/sim/view';
import { NEW_COLONY, WILD_NESTS, World, type Colony, type ColonySave, type Programs, type Tile, type WorldSave } from '../src/sim/world';
import { currentUser, requireUser } from './auth';
import type { Sql } from './db';
import { loadScripts } from './scripts';

export const MAPS: [number, number] = [5, 5]; // maps across and down in every world
const SAVE_MS = 15_000; // how often every world is saved, besides on shutdown
const MAX_BEHIND = 3; // ticks the clock may run late before it carries on from now instead of rushing to catch up
const AWAY_LIMIT = 200; // events shown under "while you were away"
const CHAT_MAX = 280; // characters in one chat message
const CHAT_HISTORY = 50; // messages a player sees on arriving
const CHAT_GAP_MS = 1000; // a player can send one message a second
export const SHIELD_MS = 24 * 60 * 60 * 1000; // a new colony's protection, in real time

/** A world running on this server. */
interface Live {
  id: number;
  world: World;
}

/** A player's colony, and how far its log has been written to events. */
interface Seat {
  userId: number;
  live: Live;
  colony: Colony;
  loggedSeq: number;
}

/** An open live view: whose it is and which map of their world it shows. */
interface Watcher {
  userId: number;
  map: Tile;
}

/** What the browser sends to found or update a colony: every file, roles in order. */
type FilesBody = { set?: ScriptSet; map?: Tile; hive?: Tile };

function validSet(body: FilesBody | undefined): ScriptSet | null {
  const s = body?.set;
  const text = (v: unknown) => typeof v === 'string';
  if (!s || !text(s.forager) || !text(s.queen) || !text(s.shared) || !Array.isArray(s.roles)) return null;
  if (!s.roles.every(r => Array.isArray(r) && r.length === 2 && text(r[0]) && text(r[1]))) return null;
  if (s.wasp !== undefined && !text(s.wasp)) return null;
  return s;
}

function validMap(m: unknown): Tile | null {
  const t = m as Tile | undefined;
  const ok = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
  return t && ok(t.x, MAPS[0]) && ok(t.y, MAPS[1]) ? { x: t.x, y: t.y } : null;
}

/** A hive tile the browser sent, in world tiles; not checked against the map yet. */
/** A stretch of real time as hours and minutes, like "5h 12m" or "40m". */
function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

function validTile(t: unknown): Tile | null {
  const v = t as Tile | undefined;
  return v && Number.isInteger(v.x) && Number.isInteger(v.y) ? { x: v.x, y: v.y } : null;
}

const CENTER: Tile = { x: Math.floor(MAPS[0] / 2), y: Math.floor(MAPS[1] / 2) };

/**
 * Every multiplayer world, stepped together on one clock. A world is a 5x5 grid of maps;
 * each player founds a colony on a free map of theirs, and it runs while they're away.
 * The worlds only change here: browsers send deploys and watch over a WebSocket.
 */
export class WorldServer {
  private readonly worlds = new Map<number, Live>();
  private readonly seats = new Map<number, Seat>(); // by player
  private readonly homes = new Map<number, number>(); // player -> the world they belong to
  private readonly fallen = new Map<number, string>(); // player -> how their last colony ended, until they found another
  private readonly watchers = new Map<WebSocket, Watcher>();
  private readonly lastChat = new Map<number, number>(); // player -> when they last sent a message
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking: Promise<void> = Promise.resolve();
  // database writes run in order in the background, so a slow write never holds up a tick
  private writes: Promise<void> = Promise.resolve();
  private saving = false;
  private savedAt = Date.now();

  constructor(
    private readonly sql: Sql,
    readonly tickMs = 133,
    /** Wild wasp nests each new world hangs. */
    private readonly nests = WILD_NESTS,
    /** How long a new colony is protected, in real milliseconds. */
    private readonly shieldMs = SHIELD_MS,
  ) {}

  /** Loads every saved world, each colony running the code its player last deployed. */
  async loadAll(): Promise<void> {
    const rows = await this.sql<{ id: number; state: WorldSave }[]>`SELECT id, state FROM worlds ORDER BY id`;
    for (const row of rows) {
      const owners = await this.sql<{ user_id: number; colony_id: number }[]>`SELECT user_id, colony_id FROM colonies WHERE world_id = ${row.id}`;
      const byColony = new Map(owners.map(o => [o.colony_id, o.user_id]));
      const programs = new Map<number, Programs>();
      for (const o of owners) {
        const parsed = parseScripts(await this.deployedSet(o.user_id));
        if ('programs' in parsed) programs.set(o.user_id, parsed.programs); // deployed code always parsed once; skip rather than guess
      }
      const world = World.restore((c: ColonySave) => programs.get(byColony.get(c.id) ?? -1) ?? null, row.state, { haltOnError: false });
      const live = { id: row.id, world };
      this.worlds.set(row.id, live);
      for (const colony of world.colonies) {
        const userId = byColony.get(colony.id)!;
        this.seats.set(userId, { userId, live, colony, loggedSeq: colony.logCount - 1 });
      }
      // a player whose colony didn't come back (no code that parses) picks a map again
      const back = new Set(world.colonies.map(c => c.id));
      for (const o of owners) if (!back.has(o.colony_id)) await this.sql`DELETE FROM colonies WHERE user_id = ${o.user_id}`;
    }
  }

  /**
   * Runs the clock: a tick every tickMs, each timed from when the last one was due, so ticks stay
   * evenly spaced. One that runs late is followed by the next straight away, but after a long
   * stall the clock carries on from now, rather than sending a burst of ticks to every player.
   */
  start(tickMs: number): void {
    let due = Date.now() + tickMs;
    const loop = () => {
      this.ticking = this.tick().catch(e => console.error('tick failed', e));
      void this.ticking.then(() => {
        if (this.stopped) return;
        const now = Date.now();
        due += tickMs;
        if (now - due > MAX_BEHIND * tickMs) due = now;
        this.timer = setTimeout(loop, Math.max(0, due - now));
      });
    };
    this.timer = setTimeout(loop, tickMs);
  }

  /** Stops the clock and saves every world, for a clean shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.ticking;
    await this.saveAll();
    await this.flush();
  }

  /** Waits for every database write queued so far. */
  async flush(): Promise<void> {
    await this.writes;
  }

  /** Queues a database write behind the others; the promise settles when it's done. */
  private write(job: () => Promise<unknown>): Promise<void> {
    const done = this.writes.then(job).then(() => undefined);
    this.writes = done.catch(e => console.error('database write failed', e));
    return done;
  }

  /** One tick for every world: step, record each colony's events, retire colonies that died out, save now and then, and show watchers. */
  async tick(): Promise<void> {
    const now = Date.now();
    for (const live of this.worlds.values()) {
      live.world.step();
      for (const seat of this.seats.values()) {
        if (seat.live !== live) continue;
        const c = seat.colony;
        if (c.shielded && c.shieldEnds !== null && now >= c.shieldEnds) {
          c.shielded = false;
          c.shieldEnds = null;
          c.say(null, 'Our protection as a new colony has ended. From now on other players can raid and sting us, and wild wasps hunt our bees on their maps.', 'raid');
        }
        this.recordEvents(seat);
        if (seat.colony.over) await this.retire(seat);
      }
      this.broadcast(live);
    }
    // a world's snapshot is taken now, between ticks; writing it waits in the background
    if (Date.now() - this.savedAt >= SAVE_MS && !this.saving) {
      this.saving = true;
      void this.saveAll()
        .catch(() => undefined) // already logged by write()
        .finally(() => (this.saving = false));
    }
  }

  /** Queues the colony's new log events for the database ("while you were away"). */
  private recordEvents(seat: Seat): void {
    const c = seat.colony;
    const fresh = c.log.filter(l => l.seq > seat.loggedSeq && l.tone);
    seat.loggedSeq = c.logCount - 1;
    if (!fresh.length) return;
    const rows = fresh.map(l => ({ user_id: seat.userId, tick: l.tick, tone: l.tone ?? null, text: l.who === null ? l.text : `${l.who === 'queen' ? 'Queen' : `Bee #${l.who}`}: ${l.text}` }));
    this.write(() => this.sql`INSERT INTO events ${this.sql(rows, 'user_id', 'tick', 'tone', 'text')}`).catch(() => undefined); // logged by write()
  }

  /**
   * Protection for a colony about to be founded. It runs for shieldMs from the player's first
   * colony in a window: a colony founded again inside it only gets what was left, and none if the
   * last one attacked another player, so abandoning a colony can't reset it.
   */
  private async shieldFor(userId: number): Promise<{ ends: number | null; fresh: boolean }> {
    const [row] = await this.sql<{ started: Date | null; broken: boolean }[]>`SELECT shield_started_at AS started, shield_broken AS broken FROM users WHERE id = ${userId}`;
    const now = Date.now();
    if (row?.started && now - row.started.getTime() < this.shieldMs) {
      return { ends: row.broken ? null : row.started.getTime() + this.shieldMs, fresh: false };
    }
    await this.sql`UPDATE users SET shield_started_at = ${new Date(now)}, shield_broken = false WHERE id = ${userId}`;
    return { ends: now + this.shieldMs, fresh: true };
  }

  /** A colony that died out (or was abandoned) leaves the world, and its map is free for anyone. */
  private async retire(seat: Seat): Promise<void> {
    const reason = seat.colony.over!;
    if (!seat.colony.shielded) {
      // it lost its protection by attacking while its window was still open: no more for the rest of it
      await this.sql`UPDATE users SET shield_broken = true WHERE id = ${seat.userId} AND shield_started_at > ${new Date(Date.now() - this.shieldMs)}`;
    }
    seat.live.world.remove(seat.colony);
    this.seats.delete(seat.userId);
    this.fallen.set(seat.userId, reason);
    await this.sql`DELETE FROM colonies WHERE user_id = ${seat.userId}`;
    await this.save(seat.live);
    const message = JSON.stringify({ type: 'over', reason });
    for (const [socket, w] of this.watchers) if (w.userId === seat.userId) socket.send(message);
  }

  private async saveAll(): Promise<void> {
    this.savedAt = Date.now();
    await Promise.all([...this.worlds.values()].map(live => this.save(live)));
  }

  /** Saves a world as it is now; the write itself joins the queue, so saves land in order. */
  private save(live: Live): Promise<void> {
    const state = live.world.save();
    return this.write(() => this.sql`UPDATE worlds SET state = ${this.sql.json(state as never)}, tick = ${state.tick}, updated_at = now() WHERE id = ${live.id}`);
  }

  /** Each watcher of a world gets the map they're watching, and their own colony. */
  private broadcast(live: Live): void {
    for (const [socket, w] of this.watchers) {
      if (this.homes.get(w.userId) !== live.id) continue;
      socket.send(this.stateMessage(live, w));
    }
    live.world.events = [];
  }

  private stateMessage(live: Live, w: Watcher, logTail = 60): string {
    const seat = this.seats.get(w.userId);
    return JSON.stringify({ type: 'state', colony: toJson(live.world, seat?.colony ?? null, w.map, logTail) });
  }

  /** The files a player last deployed, or their drafts if they never have. */
  private async deployedSet(userId: number): Promise<ScriptSet> {
    const [last] = await this.sql<{ files: ScriptSet }[]>`SELECT files FROM deploys WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1`;
    return last?.files ?? (await loadScripts(this.sql, userId, 'multi')).set;
  }

  /**
   * The world a player belongs to. A player without a colony whose world is full moves to the
   * newest world with a free map, and when every world is full, a new one opens.
   */
  private async worldFor(userId: number): Promise<Live> {
    let id = this.homes.get(userId);
    if (id === undefined) {
      const [row] = await this.sql<{ world_id: number | null }[]>`SELECT world_id FROM users WHERE id = ${userId}`;
      id = row?.world_id ?? undefined;
    }
    let live = id === undefined ? undefined : this.worlds.get(id);
    if (!live || (!this.seats.has(userId) && this.isFull(live))) {
      live = [...this.worlds.values()].reverse().find(l => !this.isFull(l)) ?? (await this.openWorld());
      await this.sql`UPDATE users SET world_id = ${live.id} WHERE id = ${userId}`;
    }
    this.homes.set(userId, live.id);
    return live;
  }

  /** Whether no map is left to found a colony on: every one holds a colony or a wild nest. */
  private isFull(live: Live): boolean {
    const w = live.world;
    for (let y = 0; y < MAPS[1]; y++) for (let x = 0; x < MAPS[0]; x++) if (!w.colonyOn({ x, y }) && !w.nestOn({ x, y })) return false;
    return true;
  }

  private async openWorld(): Promise<Live> {
    const seed = 1 + Math.floor(Math.random() * 999_999);
    const world = new World(null, seed, { maps: MAPS, nests: this.nests, hedges: true, haltOnError: false });
    const [row] = await this.sql<{ id: number }[]>`INSERT INTO worlds (seed, state) VALUES (${seed}, ${this.sql.json(world.save() as never)}) RETURNING id`;
    const live = { id: row.id, world };
    this.worlds.set(row.id, live);
    return live;
  }

  /** The world as the world map shows it: every map's owner and how their colony is doing. */
  private async overview(userId: number) {
    const live = await this.worldFor(userId);
    const w = live.world;
    const seat = this.seats.get(userId);
    const maps = [];
    for (let y = 0; y < MAPS[1]; y++) {
      for (let x = 0; x < MAPS[0]; x++) {
        const c = w.colonyOn({ x, y });
        const nest = w.nestOn({ x, y });
        maps.push({
          map: { x, y },
          nest: !!nest,
          owner: c?.owner ?? null,
          mine: !!seat && c === seat.colony,
          shieldEnds: c?.shielded ? c.shieldEnds : null,
          hive: c?.hive ?? null,
          bees: c?.bees.length ?? 0,
          honey: c?.honey ?? 0,
          made: c?.totalHoney ?? 0,
        });
      }
    }
    return { world: live.id, seed: w.seed, tick: w.tick, size: MAPS, hedges: w.hedges.size > 0, tickMs: this.tickMs, home: seat?.colony.map ?? null, fallen: this.fallen.get(userId) ?? null, maps };
  }

  /** The player's world ranked by honey brought home, best first. */
  private async leaderboard(userId: number) {
    const live = await this.worldFor(userId);
    const now = live.world.tick;
    const mine = this.seats.get(userId)?.colony;
    const rows = live.world.colonies
      .filter(c => !c.over)
      .map(c => ({
        owner: c.owner,
        mine: c === mine,
        map: c.map,
        bees: c.bees.filter(b => b.role !== 'wasp').length,
        wasps: c.bees.filter(b => b.role === 'wasp').length,
        honey: c.honey,
        made: c.totalHoney,
        stolen: c.stolen,
        kills: c.kills,
        age: now - c.foundedAt,
      }))
      .sort((a, b) => b.made - a.made || b.bees - a.bees || a.age - b.age);
    return { world: live.id, tick: now, colonies: rows };
  }

  /** Sends a chat message to everyone in the player's world; returns why not, or null. */
  private async chat(userId: number, username: string, raw: unknown): Promise<string | null> {
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!text) return null;
    if (text.length > CHAT_MAX) return `Keep messages to ${CHAT_MAX} characters.`;
    const now = Date.now();
    if (now - (this.lastChat.get(userId) ?? 0) < CHAT_GAP_MS) return 'One message a second, please.';
    this.lastChat.set(userId, now);
    const live = await this.worldFor(userId);
    const [row] = await this.sql<{ created_at: Date }[]>`INSERT INTO chat (world_id, user_id, text) VALUES (${live.id}, ${userId}, ${text}) RETURNING created_at`;
    const message = JSON.stringify({ type: 'chat', message: { username, text, at: row.created_at } });
    for (const [socket, w] of this.watchers) if (this.homes.get(w.userId) === live.id) socket.send(message);
    return null;
  }

  status(userId: number): { exists: boolean; over: string | null; tick: number; map: Tile | null } {
    const seat = this.seats.get(userId);
    const live = this.worlds.get(this.homes.get(userId) ?? -1);
    return { exists: !!seat, over: seat?.colony.over ?? null, tick: live?.world.tick ?? 0, map: seat?.colony.map ?? null };
  }

  routes(app: FastifyInstance): void {
    const sql = this.sql;

    // The world map: who holds each map of the player's world.
    app.get('/api/world', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      return this.overview(user.id);
    });

    // Every living colony in the player's world, ranked.
    app.get('/api/leaderboard', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      return this.leaderboard(user.id);
    });

    // The player's colony, the clock's pace, and the code it runs (for the cards' line text).
    app.get('/api/colony', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      await this.worldFor(user.id);
      const status = this.status(user.id);
      return { ...status, tickMs: this.tickMs, set: status.exists ? await this.deployedSet(user.id) : null };
    });

    // Founds a colony on a free map of the player's world, on the code sent.
    app.post<{ Body: FilesBody }>('/api/colony/start', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      if (this.seats.has(user.id)) return reply.code(409).send({ error: 'Your colony is already running.' });
      const set = validSet(req.body);
      if (!set) return reply.code(400).send({ error: 'Send every script file to start a colony.' });
      const map = validMap(req.body?.map);
      if (!map) return reply.code(400).send({ error: `Pick a map: [column, row] from [0, 0] to [${MAPS[0] - 1}, ${MAPS[1] - 1}].` });
      const parsed = parseScripts(set);
      if (!('programs' in parsed)) return reply.code(400).send({ problem: parsed.problem });
      await this.ticking;
      const live = await this.worldFor(user.id);
      const holder = live.world.colonyOn(map);
      if (holder) return reply.code(409).send({ error: `${holder.owner ?? 'Someone'} already holds map [${map.x}, ${map.y}]. Pick a free one.` });
      if (live.world.nestOn(map)) return reply.code(409).send({ error: `A wild wasp nest holds map [${map.x}, ${map.y}]. Pick another, or destroy the nest with your wasps first.` });
      let hive: Tile | undefined;
      if (req.body?.hive !== undefined) {
        const t = validTile(req.body.hive);
        if (!t) return reply.code(400).send({ error: 'Send the hive as a tile: {x, y}.' });
        const problem = live.world.hiveProblem(map, t);
        if (problem) return reply.code(409).send({ error: `Your hive can't go on [${t.x}, ${t.y}]: ${problem}` });
        hive = t;
      }
      const colony = live.world.found(parsed.programs, map, user.username, hive, NEW_COLONY); // no bees yet: the queen lays the first
      const shield = await this.shieldFor(user.id);
      colony.shieldEnds = shield.ends;
      colony.shielded = shield.ends !== null;
      colony.say(null, `Your colony was founded on map [${map.x}, ${map.y}] of world #${live.id}. It keeps running while you're away.`, 'note');
      const what = "other players can't raid or sting it, and wild wasps leave its bees alone. Attacking another player ends the protection early.";
      if (shield.fresh) {
        const hours = Math.round(this.shieldMs / 3_600_000);
        colony.say(null, `As a new colony it's protected for ${hours} hour${hours === 1 ? '' : 's'}: ${what}`, 'note');
      } else if (shield.ends !== null) {
        colony.say(null, `It's protected for ${duration(shield.ends - Date.now())} more, what was left of the protection your last colony started: ${what}`, 'note');
      } else {
        colony.say(null, `This colony isn't protected: your last colony attacked another player less than ${Math.round(this.shieldMs / 3_600_000)} hours ago, which ended your protection.`, 'note');
      }
      await sql`INSERT INTO deploys (user_id, files) VALUES (${user.id}, ${sql.json(set as never)})`;
      await sql`INSERT INTO colonies (user_id, world_id, colony_id, map_x, map_y) VALUES (${user.id}, ${live.id}, ${colony.id}, ${map.x}, ${map.y})`;
      const seat: Seat = { userId: user.id, live, colony, loggedSeq: -1 };
      this.seats.set(user.id, seat);
      this.fallen.delete(user.id);
      await this.recordEvents(seat);
      await this.save(live);
      for (const [socket, w] of this.watchers) {
        if (w.userId !== user.id) continue;
        w.map = map;
        socket.send(this.stateMessage(live, w));
      }
      return this.status(user.id);
    });

    // Ends the player's colony by choice: its bees, wasps, nest and honey are gone and its map is free.
    app.post('/api/colony/abandon', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      await this.ticking;
      const seat = this.seats.get(user.id);
      if (!seat) return reply.code(404).send({ error: 'You have no colony to abandon.' });
      const { map } = seat.colony;
      seat.colony.over = 'You abandoned the colony.';
      seat.colony.say(null, `Abandoned the colony on map [${map.x}, ${map.y}]: its bees, wasps and honey are gone, and the map is free.`, 'death');
      await this.recordEvents(seat);
      await this.retire(seat);
      return { ok: true };
    });

    // Every bee and the queen switch to the new code at the next tick.
    app.post<{ Body: FilesBody }>('/api/colony/deploy', async (req, reply) => {
      const user = await requireUser(sql, req, reply);
      if (!user) return;
      const seat = this.seats.get(user.id);
      if (!seat) return reply.code(404).send({ error: 'Found a colony first: pick a free map.' });
      const set = validSet(req.body);
      if (!set) return reply.code(400).send({ error: 'Send every script file to deploy.' });
      const parsed = parseScripts(set);
      if (!('programs' in parsed)) return reply.code(400).send({ problem: parsed.problem });
      await this.ticking; // between ticks, never in the middle of one
      seat.colony.deploy(parsed.programs);
      seat.colony.say(null, 'New code deployed: every bee starts it from the top.', 'note');
      await sql`INSERT INTO deploys (user_id, files) VALUES (${user.id}, ${sql.json(set as never)})`;
      await this.recordEvents(seat);
      return { ok: true, tick: seat.live.world.tick };
    });

    // Live view: first what happened while the player was away, then the map they watch after every tick.
    // The browser sends {type: "watch", map} to watch another map of the world.
    app.get('/ws', { websocket: true }, async (socket, req) => {
      const user = await currentUser(sql, req);
      if (!user) return socket.close(4001, 'Please log in again.');
      const [seen] = await sql<{ last_seen_at: Date | null }[]>`SELECT last_seen_at FROM users WHERE id = ${user.id}`;
      const away = seen?.last_seen_at
        ? await sql`SELECT tick, tone, text, created_at FROM events WHERE user_id = ${user.id} AND created_at > ${seen.last_seen_at} ORDER BY id DESC LIMIT ${AWAY_LIMIT}`
        : [];
      socket.send(JSON.stringify({ type: 'away', since: seen?.last_seen_at ?? null, events: [...away].reverse() }));
      const live = await this.worldFor(user.id);
      const history = await sql`
        SELECT u.username, c.text, c.created_at AS at FROM chat c JOIN users u ON u.id = c.user_id
        WHERE c.world_id = ${live.id} ORDER BY c.id DESC LIMIT ${CHAT_HISTORY}`;
      socket.send(JSON.stringify({ type: 'chat-history', messages: [...history].reverse() }));
      const watcher: Watcher = { userId: user.id, map: this.seats.get(user.id)?.colony.map ?? CENTER };
      this.watchers.set(socket, watcher);
      socket.send(this.stateMessage(live, watcher, 200));
      socket.on('message', async (data: Buffer) => {
        let msg: { type?: string; map?: unknown; text?: unknown };
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        if (msg.type === 'chat') {
          const problem = await this.chat(user.id, user.username, msg.text);
          if (problem) socket.send(JSON.stringify({ type: 'chat-problem', problem }));
          return;
        }
        const map = msg.type === 'watch' ? validMap(msg.map) : null;
        const home = this.worlds.get(this.homes.get(user.id) ?? -1);
        if (!map || !home) return;
        watcher.map = map;
        socket.send(this.stateMessage(home, watcher));
      });
      socket.on('close', () => {
        this.watchers.delete(socket);
        sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`.catch(() => {});
      });
    });
  }
}
