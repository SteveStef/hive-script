import './style.css';
import { api, ApiError, type Mode } from './app/api';
import { closeScreens, lessonList, mainMenu, signIn } from './app/screens';
import { renderWorldGrid, type MapCell, type WorldOverview } from './app/worldMap';
import { lessonById, lessonSet, LESSONS, type Lesson } from './tutorial/lessons';
import { LessonPanel } from './tutorial/panel';
import { Music } from './audio/music';
import { DEFAULT_WASP, roleTemplate } from './defaultScript';
import { insideHive, Renderer, roleColor } from './render/renderer';
import { TILE } from './render/scenery';
import { parseScripts, type ScriptProblem, type ScriptSet } from './sim/scripts';
import { format } from './lang/interpreter';
import { RemoteColony, type BeeView, type ColonyJson, type ColonyView } from './sim/view';
import { COLS, HIVE_SPOT, hiveProblem, locate, MAX_ENERGY, MAX_ROLES, NEST_SPOT, NEW_COLONY, RESERVED_NAMES, ROLE_NAME, ROWS, SEASON_TICKS, tileKey, World, type LogLine, type ScriptFile, type Tile, type WorldOptions } from './sim/world';
import { beeCard, beeStatus, queenCard, queenStatus } from './ui/beeCard';
import { confirmDialog, promptDialog } from './ui/dialog';
import { createEditor } from './ui/editor';

const TICKS_PER_SECOND = 15; // single player at 1x; 4x and 16x multiply this
const CONSOLE_LIMIT = 300;
const SAVE_DELAY = 600; // ms after the last keystroke before a script is saved to the account
const RECONNECT_MS = 2000;
const WORLD_REFRESH_MS = 3000; // how often an open world map asks for fresh numbers
const LEADERS_REFRESH_MS = 5000; // ...and the leaderboard, while it's showing
const CHAT_LIMIT = 200; // chat rows kept on screen
const TAB_NOTES: Record<string, string> = {
  forager: 'every forager runs this; plain lay() lays foragers',
  wasp: 'every wasp runs this; they hatch at the colony\'s wasp nest after lay("wasp")',
  shared: 'functions every worker role can use',
  queen: 'the queen runs this in the hive',
};

type Selection = number | 'queen' | null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const consoleEl = $('console');
const runBtn = $<HTMLButtonElement>('run');
const pauseBtn = $<HTMLButtonElement>('pause');
const stepBtn = $<HTMLButtonElement>('step');
const deployBtn = $<HTMLButtonElement>('deploy');
const liveEl = $('live');
const musicBtn = $<HTMLButtonElement>('music');
const chipsEl = $('bee-chips');
const cardEl = $('bee-card');
const floatEl = $('bee-float');
const screenEl = $('screen');
const raidEl = $('raid-banner');
const raidText = $('raid-text');
const raidGo = $<HTMLButtonElement>('raid-go');
const tabsEl = $('tabs');
const roleCountsEl = $('role-counts');
const mapBar = $('map-bar');
const mapLabel = $('map-label');
const worldPanel = $('world-panel');
const worldGrid = $('world-grid');
const chatList = $('chat-list');
const chatInput = $<HTMLInputElement>('chat-input');
const chatUnread = $('chat-unread');
const leadersEl = $('leaders');
const boardEl = $('hive-board');
const hud = {
  honey: $('s-honey'), bees: $('s-bees'), eggs: $('s-eggs'), comb: $('s-comb'), deaths: $('s-deaths'), tick: $('s-tick'),
  season: $('season-name'), seasonBar: $('season-bar'), seasonLeft: $('season-left'), status: $('status'),
};

// ---- state ----

/** Single player and the tutorial run a world here; multiplayer watches one on the server. */
type PlayMode = Mode | 'tutorial';

let username: string | null = null;
let mode: PlayMode = 'single';
// custom roles, in the order they were made; forager is built in
let roles: string[] = [];
/** Every script file, in tab order; a lesson shows only its own tabs (and roles the player adds). */
const files = (): ScriptFile[] =>
  ['forager', ...roles, 'wasp', 'shared', 'queen'].filter(f => !lesson || lesson.tabs.includes(f) || roles.includes(f));

// single player: a world that runs here, two maps side by side: the colony's, and next door
// (through the hedge's gate) one with a wild wasp nest
const SINGLE: WorldOptions = { maps: [2, 1], hedges: true, home: true, nests: [[COLS + NEST_SPOT.x, NEST_SPOT.y]] };
let seed = newSeed();
let local = new World(null, seed);
// placing a hive: the map it goes on, from single player's new meadow until Run, or from picking
// a free multiplayer map until the colony is founded; null otherwise
let placing: Tile | null = null;
// single player: the new meadow with every flower, to check spots against (local grows none under its hive)
let meadow = local;
const SPOT_KEY = 'hive-script:hive-spot';
let lastSpot = loadSpot();
let running = false;
let speed = 1;
let acc = 0;
// multiplayer: the colony that runs on the server, as last seen
let remote = new RemoteColony();
let socket: WebSocket | null = null;
let colonyExists = false;
let tickMs = 133;
// Live updates play a couple of ticks behind the server, at its pace, so one that arrives late (or
// several that arrive together) doesn't stop the bees and then jump them forward.
const LIVE_BUFFER = 2; // updates held back
const LIVE_SKIP = 12; // more waiting than this (a tab back from the background): skip to the newest
const pending: ColonyJson[] = [];
let shownAt = 0; // when the update on screen started, on the performance.now() clock
let shownFor = 133; // how long it stays on screen
// the player's world as the world map last showed it, and the map being watched
let overview: WorldOverview | null = null;
let worldTimer = 0;
let pane: 'log' | 'board' | 'chat' | 'leaders' = 'log';
let boardShown: string | null = null; // the board as last drawn, so an unchanged one isn't redrawn every frame
let unread = 0;
let leadersTimer = 0;
// the tutorial: the open lesson, which of its goals are met, and the player's code while "Show me" shows the solution
let lesson: Lesson | null = null;
let met: boolean[] = [];
let doneLessons = new Set<string>();
let savedAttempt: ScriptSet | null = null;
const lessonPanelEl = $('lesson-panel');
const lessonSwitch = $('lesson-switch');
const hudEl = $('hud');

/** The colony on screen: the local world's in single player and the tutorial, the server's in multiplayer. */
const view = (): ColonyView => (mode === 'multi' ? remote : local.colony);

const renderer = new Renderer(canvas);
let last = 0;
let selected: Selection = null;
let hover: Tile | null = null;
let lastSeq = -1; // the newest log line on screen
// the scripts the colony runs (as of Run or Deploy), for the cards' line text
let sourceLines: Record<ScriptFile, string[]> = {};
let shownChips = '';
let shownCard = '';
const music = new Music(loadSetting('music') === 'off');
musicBtn.setAttribute('aria-pressed', String(!music.isMuted));

const editor = createEditor($('editor'), { forager: '', wasp: '', shared: '', queen: '' });
let shownFile: ScriptFile = 'forager';
editor.onChange(queueSave);
editor.onRun(() => (mode === 'multi' ? void deploy() : start()));
editor.onShow(file => {
  shownFile = file;
  renderTabs();
});

// ---- signing in, the menu, and moving between modes ----

async function boot(): Promise<void> {
  username = await api.me().catch(() => null);
  await menu();
}

async function menu(): Promise<void> {
  if (!username) username = await signIn();
  const choice = await mainMenu(username);
  if (choice === 'logout') {
    await api.logout().catch(() => {});
    username = null;
    return menu();
  }
  if (choice === 'tutorial') return tutorialMenu();
  closeScreens();
  try {
    await enter(choice);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) username = null;
    note(`Couldn't open ${choice === 'single' ? 'single player' : 'multiplayer'}: ${e instanceof Error ? e.message : e}`, 'error');
    return menu();
  }
}

/** Shows the controls and panels of a mode. */
function setMode(next: PlayMode): void {
  mode = next;
  if (mode !== 'tutorial') lesson = null;
  $('single-controls').hidden = mode === 'multi';
  $('lessons').hidden = mode !== 'tutorial';
  $('multi-controls').hidden = mode !== 'multi';
  mapBar.hidden = mode === 'tutorial'; // single player has a map next door too; a lesson shows the arrows only if its world has more than one map
  $('world-map').hidden = mode !== 'multi';
  for (const tab of document.querySelectorAll<HTMLElement>('.console-tab[data-pane]:not([data-pane="log"]):not([data-pane="board"])')) tab.hidden = mode !== 'multi';
  lessonSwitch.hidden = mode !== 'tutorial';
  showLessonView(mode === 'tutorial' ? 'lesson' : 'colony');
  showPane('log');
  chatList.replaceChildren();
  unread = 0;
}

/** Loads a mode's scripts into the editor and starts its view. */
async function enter(next: Mode): Promise<void> {
  setMode(next);
  const { set, fresh } = await api.scripts(next);
  clearView(); // first, so a note from bringing scripts over stays in the log
  loadSet(mode === 'single' && fresh ? importBrowserScripts(set) : set);
  if (mode === 'single') {
    preview();
    sourceLines = {};
    setRunning(false);
  } else {
    remote = new RemoteColony();
    dropLive();
    await openColony();
  }
}

/** Saves what's pending and stops the current mode, before the menu. */
async function leave(): Promise<void> {
  await flushSaves();
  running = false;
  placing = null;
  const s = socket;
  socket = null;
  s?.close();
  dropLive();
  closeWorld();
  showPane('log');
  mapBar.hidden = true;
}

$('menu').addEventListener('click', async () => {
  await leave();
  await menu();
});
$('lessons').addEventListener('click', async () => {
  await leave();
  await tutorialMenu();
});

function loadSet(set: ScriptSet): void {
  roles = set.roles.map(([name]) => name);
  editor.replaceFiles({ forager: set.forager, ...Object.fromEntries(set.roles), wasp: set.wasp ?? DEFAULT_WASP, shared: set.shared, queen: set.queen });
  editor.setError(null);
  renderTabs();
}

/** The scripts in the editor, as a set to run or deploy. */
function currentSet(): ScriptSet {
  return {
    forager: editor.getValue('forager'),
    queen: editor.getValue('queen'),
    shared: editor.getValue('shared'),
    wasp: editor.getValue('wasp'),
    roles: roles.map(r => [r, editor.getValue(r)]),
  };
}

function linesOf(set: ScriptSet): Record<ScriptFile, string[]> {
  const split = (code: string) => code.split('\n');
  return {
    forager: split(set.forager), queen: split(set.queen), shared: split(set.shared), wasp: split(set.wasp ?? DEFAULT_WASP),
    ...Object.fromEntries(set.roles.map(([n, c]) => [n, split(c)])),
  };
}

function clearView(): void {
  selected = null;
  lastSeq = -1;
  shownCard = shownChips = '';
  consoleEl.replaceChildren();
}

/** Shows a parse problem on its tab and in the log. */
function showProblem(problem: ScriptProblem): void {
  editor.setError(problem);
  note(`${problem.file}.bee line ${problem.line}: ${problem.message}`, 'error');
}

// ---- single player ----

/** Single player's next meadow, paused, with the hive at the last spot used, or the nearest one it fits; clicking moves it. */
function preview(): void {
  const map = { x: 0, y: 0 };
  meadow = new World(null, seed, SINGLE);
  local = new World(null, seed, { ...SINGLE, hive: meadow.nearestHiveSpot(map, lastSpot ?? HIVE_SPOT) });
  placing = map;
  note('A new meadow. Click where your hive should go (not on flowers), then press Run.', 'note');
}

function loadSpot(): Tile | null {
  try {
    const t = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null') as Tile | null;
    return t && Number.isInteger(t.x) && Number.isInteger(t.y) ? { x: t.x, y: t.y } : null;
  } catch {
    return null;
  }
}

/** Why the hive can't go on a tile while placing, or null when it can. */
function placeProblem(tile: Tile): string | null {
  if (!placing) return null;
  if (mode !== 'multi') return meadow.hiveProblem(placing, tile);
  const w = view();
  const m = watchedMap(w);
  if (m.x !== placing.x || m.y !== placing.y) return `it goes on map [${placing.x}, ${placing.y}]; pick another on the world map.`;
  return hiveProblem(placing, tile, {
    flowerAt: (x, y) => !!w.flowerAt(x, y),
    hedgeAt: (x, y) => w.hedges.includes(tileKey(x, y)),
    nestAt: t => w.nests.some(n => n.x === t.x && n.y === t.y),
  });
}

/** Puts the hive on a tile while placing: single player moves it on the new meadow, multiplayer founds the colony there. */
function placeHive(tile: Tile): void {
  if (!placing || placeProblem(tile)) return; // the status line says why
  if (mode === 'multi') return void found(placing, tile);
  lastSpot = tile;
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(tile));
  } catch {
    // remembering the spot is only a convenience
  }
  local = new World(null, seed, { ...SINGLE, hive: tile });
}

/** Parses every script and starts a fresh colony running them; Restart first shows the next meadow to place the hive on. */
function start(): void {
  if (!lesson && !placing) {
    clearView();
    preview();
    return setRunning(false);
  }
  editor.setError(null);
  const set = currentSet();
  const parsed = parseScripts(set);
  if (!('programs' in parsed)) {
    consoleEl.replaceChildren();
    return showProblem(parsed.problem);
  }
  if (lesson) {
    local = lesson.world(parsed.programs);
    met = lesson.goals.map(() => false);
    panel.goals(met);
  } else {
    local = new World(parsed.programs, seed, { ...SINGLE, hive: local.colony.hive, ...NEW_COLONY, visitors: true }); // no bees yet: the queen lays the first; now and then a wild wasp visits
    placing = null;
    local.colony.say(null, `Meadow #${seed}: flowers bloom in new places every season, and every game is a new meadow.`, 'note');
    seed = newSeed(); // the next Run or Restart grows a different meadow
  }
  sourceLines = linesOf(set);
  clearView();
  select(null); // the card opens when a bee is clicked, so it doesn't cover the meadow at the start
  acc = 0;
  setRunning(true);
  music.play(local.season); // from the Run click, so the browser lets sound start
}

function setRunning(on: boolean): void {
  running = on && local.running;
  runBtn.textContent = local.tick > 0 || running ? 'Restart' : 'Run';
  pauseBtn.disabled = !local.running;
  pauseBtn.textContent = running ? 'Pause' : 'Resume';
}

runBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', () => setRunning(!running));
stepBtn.addEventListener('click', () => {
  if (!local.running) start();
  setRunning(false);
  local.step();
  checkGoals();
});
document.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('button[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  });
});

// ---- the tutorial ----

const panel = new LessonPanel(lessonPanelEl, {
  showMe: () => void showMe(),
  restore: () => {
    if (!savedAttempt) return;
    loadLessonSet(savedAttempt);
    savedAttempt = null;
    panel.canRestore(false);
  },
  reset: () => void startOver(),
  next: () => {
    const i = lesson ? LESSONS.indexOf(lesson) : -1;
    if (i >= 0 && i + 1 < LESSONS.length) openLesson(LESSONS[i + 1]);
    else void leave().then(tutorialMenu);
  },
});

/** The lesson list; picking a lesson opens it. */
async function tutorialMenu(): Promise<void> {
  doneLessons = await api.tutorial().then(r => new Set(r.done), () => doneLessons);
  const id = await lessonList(doneLessons);
  const picked = id && lessonById(id);
  if (!picked) return menu();
  closeScreens();
  openLesson(picked);
}

/** Opens a lesson: its tabs and code (the player's draft, if they left one), its panel, and its world, ready to Run. */
function openLesson(next: Lesson): void {
  setMode('tutorial');
  lesson = next;
  met = next.goals.map(() => false);
  savedAttempt = null;
  clearView();
  loadLessonSet(loadDraft(next) ?? lessonSet(next), false);
  panel.open(next);
  panel.canRestore(false);
  // the meadow as the lesson starts, before Run
  const parsed = parseScripts(currentSet());
  local = next.world('programs' in parsed ? parsed.programs : { forager: [], queen: [] });
  sourceLines = {};
  setRunning(false);
  const maps = local.maps[0] * local.maps[1];
  mapBar.hidden = maps < 2;
  showLessonView('lesson');
}

/** Puts a script set in the editor, showing the lesson's first tab, and keeps it as the lesson's draft. */
function loadLessonSet(set: ScriptSet, save = true): void {
  loadSet(set);
  editor.show(files()[0]);
  if (save) saveDraft();
}

async function showMe(): Promise<void> {
  if (!lesson) return;
  const sure = await confirmDialog({
    title: 'Show a solution?',
    message: 'This puts a working solution in the editor, ready to Run. Your own code is kept: "Bring back my code" puts it back.',
    confirmLabel: 'Show me',
  });
  if (!sure) return;
  savedAttempt = currentSet();
  loadLessonSet(lessonSet(lesson, 'solution'));
  panel.canRestore(true);
}

async function startOver(): Promise<void> {
  if (!lesson) return;
  const sure = await confirmDialog({
    title: 'Start this lesson over?',
    message: "This puts the lesson's starting code back in the editor, replacing yours.",
    confirmLabel: 'Start over',
    danger: true,
  });
  if (!sure) return;
  savedAttempt = null;
  panel.canRestore(false);
  loadLessonSet(lessonSet(lesson));
}

/** Ticks off goals the running lesson world meets; when they're all met, the lesson is done for good. */
function checkGoals(): void {
  if (!lesson) return;
  let changed = false;
  lesson.goals.forEach((g, i) => {
    if (!met[i] && g.check(local)) changed = met[i] = true;
  });
  if (!changed) return;
  panel.goals(met);
  if (!met.every(Boolean)) return;
  note(`Lesson done: ${lesson.title}!`, 'season');
  showLessonView('lesson');
  if (!doneLessons.has(lesson.id)) {
    doneLessons.add(lesson.id);
    void api.lessonDone(lesson.id).catch(() => {});
  }
}

/** Under the meadow, the lesson panel or the colony's stats and bee card. */
function showLessonView(which: 'lesson' | 'colony'): void {
  lessonPanelEl.hidden = mode !== 'tutorial' || which !== 'lesson';
  hudEl.hidden = mode === 'tutorial' && which === 'lesson';
  for (const tab of lessonSwitch.querySelectorAll<HTMLElement>('[data-show]')) tab.setAttribute('aria-selected', String(tab.dataset.show === which));
}
lessonSwitch.addEventListener('click', e => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-show]');
  if (tab) showLessonView(tab.dataset.show as 'lesson' | 'colony');
});

// a lesson's code is kept in this browser as you type, so leaving and coming back keeps your work
const draftKey = (l: Lesson) => `hive-script:lesson:${l.id}`;
let draftTimer = 0;
function saveDraft(): void {
  if (!lesson) return;
  const key = draftKey(lesson);
  const set = currentSet();
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify(set));
    } catch {
      // storage can be unavailable; the lesson just starts fresh next time
    }
  }, SAVE_DELAY);
}
function loadDraft(l: Lesson): ScriptSet | null {
  try {
    const raw = localStorage.getItem(draftKey(l));
    const set = raw ? (JSON.parse(raw) as ScriptSet) : null;
    return set && typeof set.forager === 'string' && Array.isArray(set.roles) ? set : null;
  } catch {
    return null;
  }
}

// ---- multiplayer: the colony on the server ----

async function openColony(): Promise<void> {
  const status = await api.colony();
  tickMs = status.tickMs;
  colonyExists = status.exists;
  if (status.set) sourceLines = linesOf(status.set);
  openSocket();
  if (!status.exists) await openWorld();
  music.play(remote.season); // entering came from a click, so sound may start
}

function openSocket(): void {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = ws;
  setLive('Connecting…', null);
  ws.addEventListener('message', e => {
    const msg = JSON.parse(String(e.data)) as
      | { type: 'away'; since: string | null; events: { tick: number; tone: LogLine['tone'] | null; text: string; created_at: string }[] }
      | { type: 'over'; reason: string }
      | { type: 'chat-history'; messages: ChatMessage[] }
      | { type: 'chat'; message: ChatMessage }
      | { type: 'chat-problem'; problem: string }
      | { type: 'state'; colony: ColonyJson };
    if (msg.type === 'away') showAway(msg.since, msg.events);
    else if (msg.type === 'chat-history') {
      chatList.replaceChildren(...msg.messages.map(chatRow));
      chatList.scrollTop = chatList.scrollHeight;
    } else if (msg.type === 'chat') addChat(chatRow(msg.message), msg.message.username !== username);
    else if (msg.type === 'chat-problem') addChat(problemRow(msg.problem), false);
    else if (msg.type === 'over') {
      pending.length = 0; // updates from before the colony ended
      colonyExists = false;
      selected = null;
      void openWorld();
    } else pending.push(msg.colony);
  });
  ws.addEventListener('close', e => {
    if (socket !== ws) return; // closed on purpose, by leaving
    if (e.code === 4001) {
      username = null;
      void leave().then(menu);
      return;
    }
    setLive('Reconnecting…', false);
    setTimeout(() => {
      if (socket === ws && mode === 'multi') openSocket();
    }, RECONNECT_MS);
  });
}

/** Puts a live update on screen. */
function showLive(json: ColonyJson): void {
  remote.update(json);
  colonyExists = json.colony !== null;
  setLive(`Live · tick ${remote.tick.toLocaleString('en-US')}`, true);
}

/**
 * Shows the next live update when it's due, and says how far into it the screen is (0 to 1).
 * Updates play at the server's pace, a little faster while more than LIVE_BUFFER are waiting and
 * a little slower while fewer are, so the buffer refills after a stall and drains after a burst.
 */
function playLive(now: number): number {
  if (pending.length > LIVE_SKIP) {
    while (pending.length > LIVE_BUFFER) showLive(pending.shift()!);
    shownAt = now;
  }
  if (!shownAt) {
    if (!pending.length) return 0;
    showLive(pending.shift()!);
    shownAt = now;
    shownFor = tickMs;
  } else if (pending.length && now - shownAt >= shownFor) {
    showLive(pending.shift()!);
    const due = shownAt + shownFor;
    shownAt = now - due < 50 ? due : now; // on the beat, unless it waited on a late update
    shownFor = tickMs * (pending.length > LIVE_BUFFER ? 0.85 : pending.length < LIVE_BUFFER ? 1.15 : 1);
  }
  return Math.min(1, (now - shownAt) / shownFor);
}

/** Forgets updates still waiting to be shown, as when the colony is founded or the player leaves. */
function dropLive(): void {
  pending.length = 0;
  shownAt = 0;
}

function setLive(text: string, on: boolean | null): void {
  liveEl.textContent = text;
  liveEl.className = on === null ? 'live' : on ? 'live on' : 'live off';
}

/** The log's first rows on arrival: what the colony went through since the player was last here. */
function showAway(since: string | null, events: { tick: number; tone: LogLine['tone'] | null; text: string }[]): void {
  if (!since || !events.length) return;
  note(`While you were away (since ${new Date(since).toLocaleString()}): ${events.length} event${events.length === 1 ? '' : 's'}.`, 'season');
  for (const ev of events) consoleEl.append(logRow({ seq: -1, tick: ev.tick, who: null, text: ev.text, tone: ev.tone ?? undefined }));
  note('Now, live:', 'season');
}

/** Watches another map of the world; the server sends it from the next message on (in single player and the tutorial, the local world shows it). */
function watch(map: Tile): void {
  const size = mode !== 'multi' ? local.maps : (overview?.size ?? [5, 5]);
  if (map.x < 0 || map.y < 0 || map.x >= size[0] || map.y >= size[1]) return;
  if (mode !== 'multi') local.colony.viewMap = map;
  else socket?.send(JSON.stringify({ type: 'watch', map }));
}

const STEPS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] } as const;
const mapArrows = [...mapBar.querySelectorAll<HTMLButtonElement>('[data-go]')];

/** The map on screen, as [column, row]. */
const watchedMap = (w: ColonyView): Tile => ({ x: Math.floor(w.origin.x / COLS), y: Math.floor(w.origin.y / ROWS) });

mapBar.addEventListener('click', e => {
  const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
  if (!go) return;
  const m = watchedMap(view());
  watch(go === 'west' ? { x: m.x - 1, y: m.y } : go === 'east' ? { x: m.x + 1, y: m.y } : go === 'north' ? { x: m.x, y: m.y - 1 } : { x: m.x, y: m.y + 1 });
});
$('map-home').addEventListener('click', () => {
  const hive = view().hive;
  if (hive) watch({ x: Math.floor(hive.x / COLS), y: Math.floor(hive.y / ROWS) });
  else void openWorld();
});
$('world-map').addEventListener('click', () => void openWorld());
$('world-close').addEventListener('click', closeWorld);

/**
 * The world map over the meadow: every map of the player's world, who holds it and how they're
 * doing. Without a colony, picking a free map founds one there; any other map is watched.
 */
async function openWorld(): Promise<void> {
  $('world-problem').textContent = '';
  try {
    overview = await api.world();
  } catch (err) {
    note(`Couldn't load the world map: ${err instanceof Error ? err.message : err}`, 'error');
    return;
  }
  worldPanel.hidden = false;
  renderWorld();
  clearInterval(worldTimer);
  worldTimer = window.setInterval(async () => {
    if (worldPanel.hidden) return clearInterval(worldTimer);
    overview = await api.world().catch(() => overview);
    renderWorld();
  }, WORLD_REFRESH_MS);
}

function closeWorld(): void {
  worldPanel.hidden = true;
  clearInterval(worldTimer);
}

function renderWorld(): void {
  if (!overview) return;
  const w = overview;
  const held = w.maps.filter(m => m.owner).length;
  const abandoned = w.fallen === ABANDONED;
  $('world-title').textContent = colonyExists ? `World #${w.world}` : w.fallen && !abandoned ? 'Your colony died out' : 'Pick a map for your colony';
  $('world-abandon').hidden = !colonyExists;
  const text = $('world-text');
  text.className = w.fallen && !colonyExists ? 'world-text fallen' : 'world-text';
  text.textContent = colonyExists
    ? `${held} of ${w.maps.length} maps are held. Click any map to watch it; yours is outlined in honey. Your bees can fly onto any map.`
    : `${w.fallen ? `${w.fallen} ` : ''}World #${w.world} has ${w.maps.length - held} free maps. Every map grows its own flowers, and bees can forage across the borders, so neighbors share the meadow. Pick a free map to found your colony on the scripts in your tabs, or click a held one to watch it.`;
  const winter = colonyExists ? null : winterWarning(w.tick);
  if (winter) {
    const warn = document.createElement('span');
    warn.className = 'world-warn';
    warn.textContent = winter;
    text.append(warn);
  }
  renderWorldGrid(worldGrid, w, remote.map, cell => void pickMap(cell));
}

/**
 * A warning when a colony founded now would most likely starve: it starts with 10 honey and no
 * bees, and nothing blooms in winter. Founded from late autumn until late winter, colonies
 * usually die before spring; later in winter the first bee hatches fed and lasts until the clover.
 */
function winterWarning(tick: number): string | null {
  const toSpring = SEASON_TICKS * 4 - (tick % (SEASON_TICKS * 4));
  if (toSpring > SEASON_TICKS * 1.4 || toSpring < SEASON_TICKS * 0.25) return null;
  const minutes = (ticks: number) => {
    const m = Math.max(1, Math.round((ticks * tickMs) / 60000));
    return `about ${m} minute${m === 1 ? '' : 's'}`;
  };
  return toSpring > SEASON_TICKS
    ? `Winter starts in ${minutes(toSpring - SEASON_TICKS)}, and nothing blooms then: a colony founded now has little time to store honey and usually starves before spring, which is ${minutes(toSpring)} away.`
    : `It's winter, and nothing blooms until spring, ${minutes(toSpring)} away: a colony founded now usually starves before then.`;
}

/** How the server says a colony ended when its player abandoned it. */
const ABANDONED = 'You abandoned the colony.';

/** Ends your colony on purpose, after asking: everything in it is gone and its map is free. */
$('world-abandon').addEventListener('click', async () => {
  const w = view();
  const bees = w.bees.filter(b => b.role !== 'wasp').length;
  const wasps = w.bees.length - bees;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const home = overview?.home;
  const sure = await confirmDialog({
    title: 'Abandon your colony?',
    message: `Its ${plural(bees, 'bee')}${wasps ? `, ${plural(wasps, 'wasp')}` : ''} and ${w.honey} honey are gone for good${home ? `, and map [${home.x}, ${home.y}] is free for anyone` : ''}. A colony you found next keeps only what's left of your 24-hour protection.`,
    confirmLabel: 'Abandon colony',
    danger: true,
  });
  if (!sure) return;
  try {
    await api.abandonColony(); // the socket's "over" message reopens the world map
  } catch (err) {
    $('world-problem').textContent = err instanceof Error ? err.message : String(err);
  }
});

async function pickMap(cell: MapCell): Promise<void> {
  if (colonyExists || cell.owner || cell.nest) {
    watch(cell.map);
    closeWorld();
    return;
  }
  // a free map: show it, and the next click there places the hive
  placing = cell.map;
  watch(cell.map);
  closeWorld();
  note(`Click where your hive goes on map [${cell.map.x}, ${cell.map.y}]: not on flowers, with room for the hive. World map picks another map.`, 'note');
}

/** Founds the colony on a map with its hive on a tile, after asking. */
async function found(map: Tile, hive: Tile): Promise<void> {
  const winter = winterWarning(view().tick);
  const sure = await confirmDialog({
    title: `Put your hive on [${hive.x}, ${hive.y}]?`,
    message: `Your colony is founded on map [${map.x}, ${map.y}]: the queen and first forager move in, running the scripts in your tabs. The hive stays here, and the colony keeps working while you're away, until it dies out.${winter ? ` ${winter}` : ''}`,
    confirmLabel: winter ? 'Found it anyway' : 'Found it here',
    danger: !!winter,
  });
  if (!sure) return;
  editor.setError(null);
  const set = currentSet();
  try {
    await flushSaves();
    await api.startColony(set, map, hive);
    sourceLines = linesOf(set);
    dropLive(); // updates from before the colony existed
    colonyExists = true;
    placing = null;
    clearView();
  } catch (err) {
    if (err instanceof ApiError && err.problem) showProblem(err.problem);
    else note(`Couldn't found your colony: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

/** Sends every script to the running colony; every bee starts the new code at the next tick. */
async function deploy(): Promise<void> {
  if (!colonyExists) return void openWorld();
  editor.setError(null);
  const set = currentSet();
  deployBtn.disabled = true;
  try {
    await flushSaves();
    await api.deploy(set);
    sourceLines = linesOf(set);
  } catch (err) {
    if (err instanceof ApiError && err.problem) showProblem(err.problem);
    else note(`Couldn't deploy: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    deployBtn.disabled = false;
  }
}
deployBtn.addEventListener('click', () => void deploy());

// ---- multiplayer: chat and the leaderboard, in tabs beside the log ----

interface ChatMessage {
  username: string;
  text: string;
  at: string;
}

document.querySelector('.console-head')!.addEventListener('click', e => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('.console-tab');
  if (!tab) return;
  if (!consoleOpen()) setConsoleOpen(true); // a tab opens the folded panel
  showPane(tab.dataset.pane as typeof pane);
});

// the log, chat and leaderboard fold away to give the editor their room; a tab opens them again
const codeEl = document.querySelector<HTMLElement>('.code')!;
const consoleToggle = $<HTMLButtonElement>('console-toggle');
const logUnread = $('log-unread');
let logMissed = 0;
const consoleOpen = (): boolean => !codeEl.classList.contains('console-closed');

function setConsoleOpen(open: boolean): void {
  codeEl.classList.toggle('console-closed', !open);
  consoleToggle.setAttribute('aria-expanded', String(open));
  consoleToggle.title = open ? 'Hide the log' : 'Show the log';
  saveSetting('console', open ? 'open' : 'closed');
  if (!open) return;
  logMissed = 0;
  logUnread.hidden = true;
  consoleEl.scrollTop = consoleEl.scrollHeight;
  showPane(pane); // clears the chat count if chat is the open tab
}
consoleToggle.addEventListener('click', () => setConsoleOpen(!consoleOpen()));
if (loadSetting('console') === 'closed') setConsoleOpen(false);

function showPane(next: typeof pane): void {
  pane = next;
  for (const el of document.querySelectorAll<HTMLElement>('[data-pane]')) {
    if (el.classList.contains('console-tab')) el.setAttribute('aria-selected', String(el.dataset.pane === next));
    else el.hidden = el.dataset.pane !== next;
  }
  if (next === 'chat' && consoleOpen()) {
    unread = 0;
    chatUnread.hidden = true;
    chatList.scrollTop = chatList.scrollHeight;
  }
  clearInterval(leadersTimer);
  if (next === 'leaders') {
    void showLeaders();
    leadersTimer = window.setInterval(() => void showLeaders(), LEADERS_REFRESH_MS);
  }
}

/** The Board tab: what's on the colony's hive board, name by name. */
function showBoard(w: ColonyView): void {
  const rows = [...w.board].map(([name, value]) => [name, format(value, true)]);
  const key = JSON.stringify(rows);
  if (key === boardShown) return;
  boardShown = key;
  if (!rows.length) {
    boardEl.textContent = 'Nothing on the hive board yet. Bees put news here with tell(name, value).';
    return;
  }
  boardEl.replaceChildren(...rows.map(([name, value]) => {
    const row = document.createElement('div');
    row.className = 'log-row board-row';
    const label = document.createElement('span');
    label.className = 'board-name';
    label.textContent = name;
    row.append(label, document.createTextNode(value));
    return row;
  }));
}

function chatRow(m: ChatMessage): HTMLElement {
  const row = document.createElement('div');
  row.className = m.username === username ? 'log-row chat-row mine' : 'log-row chat-row';
  const time = document.createElement('span');
  time.className = 'log-meta';
  time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const who = document.createElement('span');
  who.className = 'chat-who';
  who.textContent = m.username;
  row.append(time, who, document.createTextNode(m.text));
  return row;
}

function problemRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'log-row chat-row problem';
  row.textContent = text;
  return row;
}

function addChat(row: HTMLElement, fromOthers: boolean): void {
  const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 24;
  chatList.append(row);
  while (chatList.childElementCount > CHAT_LIMIT) chatList.firstElementChild!.remove();
  if (atBottom || !fromOthers) chatList.scrollTop = chatList.scrollHeight;
  if (fromOthers && (pane !== 'chat' || !consoleOpen())) {
    chatUnread.textContent = String(++unread);
    chatUnread.hidden = false;
  }
}

$<HTMLFormElement>('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
});

/** The leaderboard: every living colony in the player's world, by honey brought home. */
async function showLeaders(): Promise<void> {
  let board: Awaited<ReturnType<typeof api.leaderboard>>;
  try {
    board = await api.leaderboard();
  } catch (err) {
    leadersEl.textContent = `Couldn't load the leaderboard: ${err instanceof Error ? err.message : err}`;
    return;
  }
  if (!board.colonies.length) {
    leadersEl.textContent = 'No colonies in this world yet. Found one from the world map!';
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const h of ['#', 'Player', 'Map', 'Bees', 'Wasps', 'Honey made', 'Stolen', 'Kills', 'Age']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  const body = table.createTBody();
  board.colonies.forEach((c, i) => {
    const row = body.insertRow();
    if (c.mine) row.className = 'mine';
    for (const v of [i + 1, c.mine ? `${c.owner} (you)` : c.owner ?? '?', `[${c.map.x}, ${c.map.y}]`, c.bees, c.wasps, c.made, c.stolen, c.kills, clock(c.age, tickMs)]) {
      row.insertCell().textContent = String(v);
    }
  });
  leadersEl.replaceChildren(table);
}

/** What the map bar says about the map on screen. */
function mapText(w: ColonyView): string {
  const m = watchedMap(w);
  const here = (t: Tile) => Math.floor(t.x / COLS) === m.x && Math.floor(t.y / ROWS) === m.y;
  const bees = (n: number) => `${n} bee${n === 1 ? '' : 's'}`;
  const holder = w.otherHives[0]?.owner ?? null;
  const strangers = w.visitors.filter(b => b.owner !== holder).length; // bees from neither this map's colony nor yours
  const shield = w.shielded && w.shieldEnds ? ` · protected for ${hoursLeft(w.shieldEnds)}` : '';
  if (w.hive && here(w.hive)) return `Map [${m.x}, ${m.y}] · your colony${shield}${w.visitors.length ? ` · ${bees(w.visitors.length)} from other colonies` : ''}`;
  const yours = w.hive ? ` · ${w.bees.filter(here).length} of your bees here` : '';
  const others = strangers ? ` · ${bees(strangers)} from other colonies` : '';
  const theirs = w.otherHives[0]?.shielded ? ' (protected new colony)' : '';
  const wild = w.nests.some(n => n.wild && here(n));
  return `Map [${m.x}, ${m.y}] · ${w.otherHives.length ? `${holder ?? 'someone'}'s colony${theirs}` : wild ? 'a wild wasp nest' : 'a free meadow'}${others}${yours}`;
}

/** Real time until a moment, as "23h 41m" (or "12m"). */
function hoursLeft(until: number): string {
  const min = Math.max(0, Math.round((until - Date.now()) / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

// ---- saving scripts to the account ----

const pendingSaves = new Map<ScriptFile, number>();

function queueSave(file: ScriptFile): void {
  if (mode === 'tutorial') return saveDraft();
  clearTimeout(pendingSaves.get(file));
  pendingSaves.set(file, window.setTimeout(() => {
    pendingSaves.delete(file);
    void persist(mode, file, editor.getValue(file));
  }, SAVE_DELAY));
}

async function persist(m: PlayMode, file: ScriptFile, code: string, keepalive = false): Promise<void> {
  if (m === 'tutorial') return saveDraft();
  try {
    await api.saveScript(m, file, code, roles.indexOf(file) + 1, keepalive);
  } catch (e) {
    note(`Couldn't save ${file}.bee: ${e instanceof Error ? e.message : e}`, 'error');
  }
}

/** Saves every script with a save still waiting, now. */
async function flushSaves(keepalive = false): Promise<void> {
  const waiting = [...pendingSaves.keys()];
  for (const file of waiting) clearTimeout(pendingSaves.get(file));
  pendingSaves.clear();
  await Promise.all(waiting.map(file => persist(mode, file, editor.getValue(file), keepalive)));
}
window.addEventListener('pagehide', () => void flushSaves(true));

/**
 * The first time an account opens single player, scripts this browser saved before accounts
 * existed come along (once per browser), so nobody loses their work.
 */
function importBrowserScripts(set: ScriptSet): ScriptSet {
  try {
    if (localStorage.getItem('hive-script:imported')) return set;
    localStorage.setItem('hive-script:imported', '1');
    const get = (key: string) => localStorage.getItem(`hive-script:${key}`);
    const names = (JSON.parse(get('roles') ?? '[]') as unknown[])
      .filter((r): r is string => typeof r === 'string' && ROLE_NAME.test(r) && !RESERVED_NAMES.includes(r))
      .slice(0, MAX_ROLES);
    if (!get('forager') && !get('queen') && !get('shared') && !names.length) return set;
    const found: ScriptSet = {
      forager: get('forager') ?? set.forager,
      queen: get('queen') ?? set.queen,
      shared: get('shared') ?? set.shared,
      wasp: set.wasp,
      roles: names.map(r => [r, get(`role:${r}`) ?? roleTemplate(r)]),
    };
    void Promise.all([
      persist('single', 'forager', found.forager),
      persist('single', 'queen', found.queen),
      persist('single', 'shared', found.shared),
      ...found.roles.map(([r, code], i) => api.saveScript('single', r, code, i + 1).catch(() => {})),
    ]);
    note('Brought over the scripts this browser saved before accounts.', 'note');
    return found;
  } catch {
    return set; // storage blocked: nothing to bring over
  }
}

// ---- tabs and roles ----

tabsEl.addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const close = target.closest<HTMLElement>('[data-close]');
  if (close) return void deleteRole(close.dataset.close!);
  if (target.closest('.add-role')) return void addRole();
  const tab = target.closest<HTMLElement>('[data-file]');
  if (tab) editor.show(tab.dataset.file!);
});

function renderTabs(): void {
  const tabs = files().map(file => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'file-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(file === shownFile));
    tab.dataset.file = file;
    tab.textContent = `${file}.bee`;
    if (roles.includes(file)) {
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.dataset.close = file;
      close.title = `Delete the ${file} role`;
      close.textContent = '×';
      tab.append(close);
    }
    return tab;
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add-role';
  add.textContent = '+ Role';
  add.disabled = roles.length >= MAX_ROLES;
  add.title = add.disabled ? `A colony can have up to ${MAX_ROLES} roles besides forager` : 'Make a new role with its own script';
  const note = document.createElement('span');
  note.className = 'tab-note';
  note.textContent = TAB_NOTES[shownFile] ?? `every bee laid with lay("${shownFile}") runs this`;
  tabsEl.replaceChildren(...tabs, add, note);
}

async function addRole(): Promise<void> {
  const name = await promptDialog({
    title: 'New role',
    message: 'Every bee the queen lays with lay("name") will run this role\'s own script, for life.',
    placeholder: 'builder',
    suffix: '.bee',
    confirmLabel: 'Create role',
    validate: roleNameProblem,
  });
  if (name === null) return;
  roles = [...roles, name];
  const code = roleTemplate(name);
  editor.addFile(name, code);
  void persist(mode, name, code);
  editor.show(name);
}

/** Why a name can't be a new role's, or null when it can. */
function roleNameProblem(name: string): string | null {
  if (!name) return 'Type a name for the role.';
  if (/[A-Z]/.test(name)) return 'Use lowercase letters, like builder.';
  if (!/^[a-z]/.test(name)) return 'Start the name with a letter.';
  if (!ROLE_NAME.test(name)) return name.length > 12 ? 'Keep it to 12 characters or fewer.' : 'Use only lowercase letters, numbers and _.';
  if (RESERVED_NAMES.includes(name) || roles.includes(name)) return `There's already a script called ${name}.bee.`;
  return null;
}

async function deleteRole(name: string): Promise<void> {
  const until = mode === 'multi' ? 'until you deploy' : 'until you press Restart';
  const sure = await confirmDialog({
    title: `Delete ${name}.bee?`,
    message: `This deletes the ${name} role and its script. Bees that already hatched as ${name} keep working ${until}, and a queen that still lays "${name}" will stop with an error.`,
    confirmLabel: 'Delete role',
    danger: true,
  });
  if (!sure) return;
  roles = roles.filter(r => r !== name);
  clearTimeout(pendingSaves.get(name));
  pendingSaves.delete(name);
  editor.removeFile(name);
  renderTabs();
  if (mode === 'tutorial') return saveDraft();
  await api.deleteScript(mode, name).catch(e => note(`Couldn't delete ${name}.bee: ${e instanceof Error ? e.message : e}`, 'error'));
}

// ---- the meadow ----

/** Follows a bee or the queen, and shows the script it runs. */
function select(target: Selection): void {
  selected = target;
  const file = target === 'queen' ? 'queen' : target === null ? null : (view().findBee(target)?.role ?? 'forager');
  if (file && files().includes(file)) editor.show(file); // a lesson may hide the file
}

musicBtn.addEventListener('click', () => {
  music.setMuted(!music.isMuted);
  musicBtn.setAttribute('aria-pressed', String(!music.isMuted));
  saveSetting('music', music.isMuted ? 'off' : 'on');
});
chipsEl.addEventListener('click', e => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
  if (chip) select(chip.dataset.select === 'queen' ? 'queen' : Number(chip.dataset.select));
});

function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * renderer.width, y: ((e.clientY - r.top) / r.height) * renderer.height };
}

canvas.addEventListener('mousemove', e => {
  const p = canvasPoint(e);
  const w = view();
  hover = { x: w.origin.x + Math.floor(p.x / TILE), y: w.origin.y + Math.floor(p.y / TILE) };
  if (placing) {
    const problem = placeProblem(hover);
    setStatus(`Tile [${hover.x}, ${hover.y}] · ${problem ? `your hive can't go here: ${problem}` : 'click to put your hive here'}`);
    return;
  }
  const flower = w.flowerAt(hover.x, hover.y);
  const other = w.otherHives.find(h => h.x === hover!.x && h.y === hover!.y);
  const nest = w.nests.find(n => n.x === hover!.x && n.y === hover!.y);
  const visitor = w.visitors.find(b => b.x === hover!.x && b.y === hover!.y);
  const hurt = (u: { health: number; maxHealth: number }) => (u.health < u.maxHealth ? `, health ${u.health} of ${u.maxHealth}` : '');
  const home = w.bees.filter(b => insideHive(w, b, true)).length;
  const inside = home ? `, ${home} ${home === 1 ? 'bee' : 'bees'} inside` : '';
  const what = w.hedges.includes(tileKey(hover.x, hover.y))
    ? ' · hedgerow: nothing flies through it; use a gate'
    : w.atHive(hover)
    ? mode !== 'multi' || w.queen ? ` · the hive${inside} (click to follow the queen)` : ` · your hive${inside}`
    : other ? ` · ${other.owner ?? 'another player'}'s hive${other.shielded ? ', a protected new colony: it can\'t be raided or stung yet' : ''}`
    : nest ? ` · ${nest.wild ? 'a wild wasp nest' : w.nest?.x === nest.x && w.nest?.y === nest.y ? 'your wasp nest' : `${nest.owner ?? 'another colony'}'s wasp nest`}${hurt(nest)}`
    : visitor ? ` · ${visitor.owner === null ? 'a wild wasp' : `${visitor.owner}'s ${visitor.role === 'wasp' ? 'wasp' : 'bee'} #${visitor.id}`}${hurt(visitor)}`
    : flower ? ` · ${flower.kind} with ${flower.nectar} of ${flower.max} nectar` : '';
  const scents = w.scentsAt(hover.x, hover.y).map(([name, strength]) => `"${name}" ${strength}`).join(', ');
  setStatus(`Tile [${hover.x}, ${hover.y}]${what}${scents ? ` · scent ${scents}` : ''}`);
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
  setStatus('');
});

/** The caption along the bottom of the meadow: what's under the pointer; hidden when there's nothing to say. */
function setStatus(text: string): void {
  if (hud.status.textContent !== text) hud.status.textContent = text;
  hud.status.hidden = !text;
}

$('card-close').addEventListener('click', () => select(null));

// ---- fullscreen: the editor or the game fills the screen, with the top bar still there ----

type Focus = 'code' | 'game' | null;
let focus: Focus = null;
const fsButtons = [...document.querySelectorAll<HTMLButtonElement>('.fs-btn')];

function setFocus(next: Focus): void {
  focus = next;
  document.body.classList.toggle('focus-code', next === 'code');
  document.body.classList.toggle('focus-game', next === 'game');
  for (const b of fsButtons) {
    const on = b.dataset.focus === next;
    const what = b.dataset.focus === 'code' ? 'editor' : 'game';
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Leave fullscreen (Esc)' : `Fullscreen ${what} (Esc to leave)`;
    b.setAttribute('aria-label', on ? 'Leave fullscreen' : `Fullscreen ${what}`);
  }
}

async function toggleFocus(which: 'code' | 'game'): Promise<void> {
  if (focus === which) {
    setFocus(null);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  setFocus(which);
  // where the browser has no fullscreen for pages (iPhone), the side still fills the window
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {});
}

for (const b of fsButtons) b.addEventListener('click', () => void toggleFocus(b.dataset.focus as 'code' | 'game'));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && focus) setFocus(null); // left with Esc
});

/**
 * Sizes the meadow to the space its column has left after the map bar and the strip, keeping
 * its shape, so nothing under it is pushed out of the window. A lesson's text gets at least
 * LESSON_MIN_PX and whatever the meadow leaves, and scrolls inside that. Everything in the column
 * takes the meadow's width (--game-w). Narrow screens stack and scroll instead.
 */
function fitGame(): void {
  const play = screenEl.parentElement!;
  if (matchMedia('(max-width: 900px)').matches) {
    play.style.removeProperty('--game-w');
    lessonPanelEl.style.maxHeight = '';
    return;
  }
  const gap = parseFloat(getComputedStyle(play).rowGap) || 0;
  let rest = 0;
  for (const el of play.children) {
    if (el === screenEl || el === lessonPanelEl) continue;
    const h = el.getBoundingClientRect().height;
    if (h > 0) rest += h + gap;
  }
  const lessonShown = !lessonPanelEl.hidden;
  if (lessonShown) rest += Math.min(lessonPanelEl.scrollHeight, LESSON_MIN_PX) + gap;
  const frame = 20; // the wooden frame's padding, both sides
  const tall = ((play.clientHeight - rest - frame) * renderer.width) / renderer.height;
  const w = Math.floor(Math.max(240, Math.min(play.clientWidth - frame, tall)) + frame);
  play.style.setProperty('--game-w', `${w}px`);
  if (lessonShown) {
    const meadow = ((w - frame) * renderer.height) / renderer.width + frame + gap;
    const left = rest - Math.min(lessonPanelEl.scrollHeight, LESSON_MIN_PX) - gap;
    lessonPanelEl.style.maxHeight = `${Math.max(LESSON_MIN_PX, Math.floor(play.clientHeight - left - meadow))}px`;
  }
}
const LESSON_MIN_PX = 170; // the least a lesson's text gets under the meadow
const fitter = new ResizeObserver(fitGame);
for (const el of [screenEl.parentElement!, hudEl, lessonPanelEl, lessonSwitch, mapBar]) fitter.observe(el);
canvas.addEventListener('click', e => {
  const w = view();
  const c = canvasPoint(e);
  const p = { x: c.x + w.origin.x * TILE, y: c.y + w.origin.y * TILE }; // in world pixels, as place() gives them
  if (placing) return placeHive({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
  let best: BeeView | null = null;
  let bestDist = 14;
  for (const bee of w.bees) {
    if (insideHive(w, bee, true)) continue; // out of sight in the hive: clicking the hive follows the queen
    const at = renderer.place(w, bee, 0);
    const d = Math.hypot(at.x - p.x, at.y - at.z - p.y);
    if (d < bestDist) {
      best = bee;
      bestDist = d;
    }
  }
  if (best && mode === 'tutorial') showLessonView('colony'); // the bee's card is on the Colony side
  if (best) select(best.id);
  else if (w.queen && w.atHive({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) })) select('queen');
});

// ---- main loop ----

function frame(now: number): void {
  const dt = last ? Math.min(100, now - last) : 0;
  last = now;
  let frac = 0; // how far between ticks, for smooth flight
  if (mode !== 'multi') {
    if (running) {
      acc += (dt * TICKS_PER_SECOND * speed) / 1000;
      let ticks = Math.floor(acc);
      acc -= ticks;
      while (ticks-- > 0 && local.running) {
        local.step();
        checkGoals();
      }
      if (local.error) editor.setError(local.error);
      if (!local.running) setRunning(false);
      frac = running ? acc : 0;
    }
  } else {
    frac = playLive(now);
  }
  const w = view();
  if (w.tick > 0) music.play(w.season);
  const ghost = placing && hover ? { tile: hover, ok: !placeProblem(hover) } : null;
  renderer.setPace(mode === 'multi' ? 1000 / tickMs : TICKS_PER_SECOND * speed);
  renderer.draw(w, frac, typeof selected === 'number' ? selected : null, hover, ghost);
  w.events = [];
  updateHud(w);
  if (pane === 'board') showBoard(w);
  requestAnimationFrame(frame);
}

function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

/** Game time as a clock: m:ss, or h:mm:ss for an hour or more. */
function clock(ticks: number, msPerTick: number): string {
  const s = Math.round((ticks * msPerTick) / 1000);
  const mm = String(Math.floor(s / 60) % 60);
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function updateHud(w: ColonyView): void {
  hud.honey.textContent = String(w.honey);
  hud.bees.textContent = String(w.bees.length);
  hud.eggs.textContent = String(w.eggs.length);
  hud.comb.textContent = `${w.space}/${w.comb}`;
  hud.deaths.textContent = String(w.deaths);
  hud.tick.textContent = w.tick.toLocaleString('en-US');
  const season = w.season;
  hud.season.textContent = `Year ${w.year} · ${season[0].toUpperCase()}${season.slice(1)}`;
  hud.season.dataset.season = season;
  hud.seasonBar.style.width = `${(1 - w.seasonLeft / SEASON_TICKS) * 100}%`;
  if (!mapBar.hidden) {
    const text = mapText(w);
    if (mapLabel.textContent !== text) mapLabel.textContent = text;
    // only the arrows that lead to a map: single player's home shows just east, and its neighbor just west
    const m = watchedMap(w);
    const size = mode !== 'multi' ? local.maps : (overview?.size ?? [5, 5]);
    for (const arrow of mapArrows) {
      const [dx, dy] = STEPS[arrow.dataset.go as keyof typeof STEPS];
      const off = m.x + dx < 0 || m.y + dy < 0 || m.x + dx >= size[0] || m.y + dy >= size[1];
      if (arrow.hidden !== off) arrow.hidden = off;
    }
  }
  hud.seasonLeft.textContent = mode !== 'multi' ? `${clock(w.seasonLeft, 1000 / TICKS_PER_SECOND)} left at 1×` : `${clock(w.seasonLeft, tickMs)} left`;

  // how many bees of each role, once there are custom roles or wasps
  const names = w.roleNames;
  const shown = names.length > 2 || w.bees.some(b => b.role === 'wasp');
  roleCountsEl.hidden = !shown;
  if (shown) {
    const counts = names
      .map(r => {
        const color = r === 'wasp' ? '#3b3326' : roleColor(names, r);
        const dot = color ? `<i class="role-dot" style="background:${color}"></i>` : '';
        return `<span>${dot}${r} <b>${w.bees.filter(b => b.role === r).length}</b></span>`;
      })
      .join('');
    if (roleCountsEl.innerHTML !== counts) roleCountsEl.innerHTML = counts;
  }

  // the queen, then one chip per living bee with a small energy bar; rebuilt only when something visible changes
  const queenChip = w.queen
    ? `<button type="button" class="bee-chip queen ${queenStatus(w.queen).tone}${selected === 'queen' ? ' on' : ''}" data-select="queen">Queen</button>`
    : '';
  const chips = queenChip + w.bees
    .map(b => {
      const s = beeStatus(b);
      const pct = Math.round((b.energy / MAX_ENERGY) * 20) * 5;
      const wasp = b.role === 'wasp';
      return `<button type="button" class="bee-chip ${s.tone}${wasp ? ' wasp' : ''}${b.id === selected ? ' on' : ''}" data-select="${b.id}" title="${wasp ? 'Wasp' : 'Bee'}: ${s.label}">#${b.id}<i style="width:${pct}%"></i></button>`;
    })
    .join('');
  // with nobody to follow yet, the row says how to start
  const idle = mode !== 'multi'
    ? local.running ? 'Click a bee or the hive to follow it.' : 'Press Run to start the colony, then click a bee to follow it.'
    : colonyExists ? 'Click one of your bees or your hive to follow it.' : 'Pick a free map on the world map to found your colony.';
  const row = chips || `<p class="muted">${idle}</p>`;
  if (row !== shownChips) chipsEl.innerHTML = shownChips = row;

  let card: string;
  if (selected === 'queen' && w.queen) {
    const at = locate('queen', w.queen.runner.line);
    editor.setActiveLine(w.queen.runner.finished ? null : at.file, w.queen.runner.line ? at.line : null);
    card = queenCard(w, sourceLines);
  } else {
    const bee = w.findBee(typeof selected === 'number' ? selected : null);
    const at = bee && !bee.death && !bee.runner.finished && bee.runner.line ? locate(bee.role, bee.runner.line) : null;
    editor.setActiveLine(at?.file ?? null, at?.line ?? null);
    card = bee ? beeCard(bee, sourceLines, mode !== 'multi' ? TICKS_PER_SECOND : 1000 / tickMs) : '';
  }
  if (card !== shownCard) cardEl.innerHTML = shownCard = card;
  // the card floats over the top corner away from what it follows
  floatEl.hidden = !card;
  const followed = selected === 'queen' ? w.hive : w.findBee(typeof selected === 'number' ? selected : null);
  if (followed) floatEl.classList.toggle('left', followed.x - w.origin.x >= COLS / 2);
  updateRaid(w);

  // new log lines: everything after the newest one already shown
  let from = w.log.length;
  while (from > 0 && w.log[from - 1].seq > lastSeq) from--;
  for (let i = from; i < w.log.length; i++) consoleEl.append(logRow(w.log[i]));
  if (from < w.log.length) {
    if (!consoleOpen()) {
      logMissed += w.log.length - from;
      logUnread.textContent = String(logMissed);
      logUnread.hidden = false;
    }
    lastSeq = w.log[w.log.length - 1].seq;
    while (consoleEl.childElementCount > CONSOLE_LIMIT) consoleEl.firstElementChild!.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

/** The banner over the meadow while other players' units are on your hive, wherever you're looking. */
function updateRaid(w: ColonyView): void {
  const raiders = w.raiders;
  const raided = raiders.length > 0 && !!w.hive;
  raidEl.hidden = !raided;
  screenEl.classList.toggle('raided', raided);
  if (!raided) return;
  const first = raiders[0];
  const who = `${first.owner ?? 'another colony'}'s ${first.role === 'wasp' ? 'wasp' : 'bee'}`;
  const text = `Raid! ${who}${raiders.length > 1 ? ` and ${raiders.length - 1} more` : ''} ${raiders.length > 1 ? 'are' : 'is'} at your hive`;
  if (raidText.textContent !== text) raidText.textContent = text;
  const home = watchedMap(w).x === Math.floor(w.hive!.x / COLS) && watchedMap(w).y === Math.floor(w.hive!.y / ROWS);
  const label = home ? 'Show me' : 'Go home';
  if (raidGo.textContent !== label) raidGo.textContent = label;
}
raidGo.addEventListener('click', () => {
  const hive = view().hive;
  if (!hive) return;
  if (raidGo.textContent === 'Go home') watch({ x: Math.floor(hive.x / COLS), y: Math.floor(hive.y / ROWS) });
  else renderer.flash(hive);
});

function logRow(line: LogLine): HTMLElement {
  const row = document.createElement('div');
  row.className = line.tone ? `log-row ${line.tone}` : 'log-row';
  const meta = document.createElement('span');
  meta.className = 'log-meta';
  meta.textContent = `t=${line.tick}${line.who === 'queen' ? ' queen' : line.who !== null ? ` #${line.who}` : ''}`;
  row.append(meta, document.createTextNode(line.text));
  return row;
}

/** A line in the log from the game itself rather than the colony (saving, deploying). */
function note(text: string, tone: LogLine['tone']): void {
  consoleEl.append(logRow({ seq: -1, tick: view().tick, who: null, text, tone }));
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ---- settings kept in this browser ----

function loadSetting(name: string): string | null {
  try {
    return localStorage.getItem(`hive-script:${name}`);
  } catch {
    return null;
  }
}

function saveSetting(name: string, value: string): void {
  try {
    localStorage.setItem(`hive-script:${name}`, value);
  } catch {
    // storage can be unavailable (private windows); the setting just won't persist
  }
}

setRunning(false);
requestAnimationFrame(frame);
void boot();
