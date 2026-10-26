import './style.css';
import { Music } from './audio/music';
import { DEFAULT_FORAGER, DEFAULT_QUEEN, DEFAULT_SHARED, roleTemplate } from './defaultScript';
import { ScriptError } from './lang/errors';
import { parse } from './lang/parser';
import { Renderer, roleColor } from './render/renderer';
import { TILE } from './render/scenery';
import {
  locate, MAX_ENERGY, MAX_ROLES, RESERVED_NAMES, ROLE_NAME, SEASON_TICKS, SHARED_LINE_BASE, World,
  type Bee, type LogLine, type Programs, type ScriptFile, type Tile,
} from './sim/world';
import { beeCard, beeStatus, queenCard, queenStatus } from './ui/beeCard';
import { confirmDialog, promptDialog } from './ui/dialog';
import { createEditor } from './ui/editor';

const TICKS_PER_SECOND = 15; // at 1x; 4x and 16x multiply this
const CONSOLE_LIMIT = 300;
const DEFAULTS: Record<string, string> = { forager: DEFAULT_FORAGER, queen: DEFAULT_QUEEN, shared: DEFAULT_SHARED };
const TAB_NOTES: Record<string, string> = {
  forager: 'every forager runs this; plain lay() lays foragers',
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
const musicBtn = $<HTMLButtonElement>('music');
const chipsEl = $('bee-chips');
const cardEl = $('bee-card');
const hud = {
  honey: $('s-honey'), bees: $('s-bees'), eggs: $('s-eggs'), comb: $('s-comb'), deaths: $('s-deaths'), tick: $('s-tick'),
  season: $('season-name'), seasonBar: $('season-bar'), seasonLeft: $('season-left'), status: $('status'),
};

const tabsEl = $('tabs');
const roleCountsEl = $('role-counts');

// custom roles, in the order they were made; forager is built in
let roles = loadRoles();
/** Every script file, in tab order. */
const files = (): ScriptFile[] => ['forager', ...roles, 'shared', 'queen'];

const editor = createEditor($('editor'), Object.fromEntries(files().map(f => [f, loadCode(f)])));
let shownFile: ScriptFile = 'forager';
editor.onChange(saveCode);
editor.onRun(start);
editor.onShow(file => {
  shownFile = file;
  renderTabs();
});
tabsEl.addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const close = target.closest<HTMLElement>('[data-close]');
  if (close) return void deleteRole(close.dataset.close!);
  if (target.closest('.add-role')) return void addRole();
  const tab = target.closest<HTMLElement>('[data-file]');
  if (tab) editor.show(tab.dataset.file!);
});
renderTabs();

let seed = newSeed();
let world = new World(null, seed);
const renderer = new Renderer(canvas);
let running = false;
let speed = 1;
let acc = 0;
let last = 0;
let selected: Selection = null;
let hover: Tile | null = null;
let logShown = 0;
// the scripts as they were when Run was pressed, for the cards' line text
let sourceLines: Record<ScriptFile, string[]> = {};
let shownChips = '';
let shownCard = '';
const music = new Music(loadSetting('music') === 'off');
musicBtn.setAttribute('aria-pressed', String(!music.isMuted));

// ---- controls ----

/** Parses every script and starts a fresh colony running them. */
function start(): void {
  editor.setError(null);
  const parsed: Record<ScriptFile, Programs['forager']> = {};
  for (const file of files()) {
    // shared.bee runs ahead of each role's script, so its lines are numbered apart (see locate())
    const base = file === 'shared' ? SHARED_LINE_BASE : 0;
    try {
      parsed[file] = parse(editor.getValue(file), base + 1);
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      const line = e.line - base;
      editor.setError({ file, line, message: e.message });
      consoleEl.replaceChildren(logRow({ tick: 0, who: null, text: `${file}.bee line ${line}: ${e.message}`, tone: 'error' }));
      return;
    }
  }
  const programs: Programs = {
    forager: parsed.forager,
    queen: parsed.queen,
    shared: parsed.shared,
    roles: Object.fromEntries(roles.map(r => [r, parsed[r]])),
  };
  world = new World(programs, seed);
  world.say(null, `Meadow #${seed}: flowers bloom in new places every season, and every game is a new meadow.`, 'note');
  seed = newSeed(); // the next Run or Restart grows a different meadow
  sourceLines = Object.fromEntries(files().map(f => [f, editor.getValue(f).split('\n')]));
  logShown = 0;
  consoleEl.replaceChildren();
  select(world.bees[0]?.id ?? null);
  acc = 0;
  setRunning(true);
  music.play(world.season); // from the Run click, so the browser lets sound start
}

function setRunning(on: boolean): void {
  running = on && world.running;
  runBtn.textContent = world.tick > 0 || running ? 'Restart' : 'Run';
  pauseBtn.disabled = !world.running;
  pauseBtn.textContent = running ? 'Pause' : 'Resume';
}

/** Follows a bee or the queen, and shows the script it runs. */
function select(target: Selection): void {
  selected = target;
  if (target !== null) editor.show(target === 'queen' ? 'queen' : (world.findBee(target)?.role ?? 'forager'));
}

// ---- tabs and roles ----

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
  saveRoles();
  const code = roleTemplate(name);
  editor.addFile(name, code);
  saveCode(name, code);
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
  const sure = await confirmDialog({
    title: `Delete ${name}.bee?`,
    message: `This deletes the ${name} role and its script. Bees that already hatched as ${name} keep working until you press Restart, and a queen that still lays "${name}" will stop with an error.`,
    confirmLabel: 'Delete role',
    danger: true,
  });
  if (!sure) return;
  roles = roles.filter(r => r !== name);
  saveRoles();
  removeCode(name);
  editor.removeFile(name);
  renderTabs();
}

runBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', () => setRunning(!running));
stepBtn.addEventListener('click', () => {
  if (!world.running) start();
  setRunning(false);
  world.step();
});
document.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('button[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  });
});
musicBtn.addEventListener('click', () => {
  music.setMuted(!music.isMuted);
  musicBtn.setAttribute('aria-pressed', String(!music.isMuted));
  saveSetting('music', music.isMuted ? 'off' : 'on');
});
chipsEl.addEventListener('click', e => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
  if (chip) select(chip.dataset.select === 'queen' ? 'queen' : Number(chip.dataset.select));
});

// ---- meadow interaction ----

function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * renderer.width, y: ((e.clientY - r.top) / r.height) * renderer.height };
}

canvas.addEventListener('mousemove', e => {
  const p = canvasPoint(e);
  hover = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
  const flower = world.flowerAt(hover.x, hover.y);
  const what = world.atHive(hover) ? ' · the hive (click to follow the queen)' : flower ? ` · ${flower.kind} with ${flower.nectar} of ${flower.max} nectar` : '';
  const scents = world.scentsAt(hover.x, hover.y).map(([name, strength]) => `"${name}" ${strength}`).join(', ');
  hud.status.textContent = `Tile [${hover.x}, ${hover.y}]${what}${scents ? ` · scent ${scents}` : ''}`;
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
  hud.status.textContent = 'Hover the meadow to see tile positions.';
});
canvas.addEventListener('click', e => {
  const p = canvasPoint(e);
  let best: Bee | null = null;
  let bestDist = 14;
  for (const bee of world.bees) {
    const at = renderer.place(world, bee, 0);
    const d = Math.hypot(at.x - p.x, at.y - at.z - p.y);
    if (d < bestDist) {
      best = bee;
      bestDist = d;
    }
  }
  if (best) select(best.id);
  else if (world.queen && world.atHive({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) })) select('queen');
});

// ---- main loop ----

function frame(now: number): void {
  const dt = last ? Math.min(100, now - last) : 0;
  last = now;
  if (running) {
    acc += (dt * TICKS_PER_SECOND * speed) / 1000;
    let ticks = Math.floor(acc);
    acc -= ticks;
    while (ticks-- > 0 && world.running) world.step();
    if (world.error) editor.setError(world.error);
    if (!world.running) setRunning(false);
  }
  if (world.tick > 0) music.play(world.season);
  renderer.draw(world, running ? acc : 0, typeof selected === 'number' ? selected : null, hover);
  world.events = [];
  updateHud();
  requestAnimationFrame(frame);
}

function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

function clock(ticks: number): string {
  const s = Math.round(ticks / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateHud(): void {
  hud.honey.textContent = String(world.honey);
  hud.bees.textContent = String(world.bees.length);
  hud.eggs.textContent = String(world.eggs.length);
  hud.comb.textContent = `${world.space}/${world.comb}`;
  hud.deaths.textContent = String(world.deaths);
  hud.tick.textContent = world.tick.toLocaleString('en-US');
  const season = world.season;
  hud.season.textContent = `Year ${world.year} · ${season[0].toUpperCase()}${season.slice(1)}`;
  hud.season.dataset.season = season;
  hud.seasonBar.style.width = `${(1 - world.seasonLeft / SEASON_TICKS) * 100}%`;
  hud.seasonLeft.textContent = `${clock(world.seasonLeft)} left at 1×`;

  // how many bees of each role, once there are custom roles
  const names = world.roleNames;
  roleCountsEl.hidden = names.length < 2;
  if (names.length > 1) {
    const counts = names
      .map(r => {
        const color = roleColor(names, r);
        const dot = color ? `<i class="role-dot" style="background:${color}"></i>` : '';
        return `<span>${dot}${r} <b>${world.bees.filter(b => b.role === r).length}</b></span>`;
      })
      .join('');
    if (roleCountsEl.innerHTML !== counts) roleCountsEl.innerHTML = counts;
  }

  // the queen, then one chip per living bee with a small energy bar; rebuilt only when something visible changes
  const queenChip = world.queen
    ? `<button type="button" class="bee-chip queen ${queenStatus(world.queen).tone}${selected === 'queen' ? ' on' : ''}" data-select="queen">Queen</button>`
    : '';
  const chips = queenChip + world.bees
    .map(b => {
      const s = beeStatus(b);
      const pct = Math.round((b.energy / MAX_ENERGY) * 20) * 5;
      return `<button type="button" class="bee-chip ${s.tone}${b.id === selected ? ' on' : ''}" data-select="${b.id}" title="${s.label}">#${b.id}<i style="width:${pct}%"></i></button>`;
    })
    .join('');
  if (chips !== shownChips) chipsEl.innerHTML = shownChips = chips;

  let card: string;
  if (selected === 'queen' && world.queen) {
    editor.setActiveLine(world.queen.runner.finished ? null : 'queen', world.queen.runner.line || null);
    card = queenCard(world, sourceLines.queen);
  } else {
    const bee = world.findBee(typeof selected === 'number' ? selected : null);
    const at = bee && !bee.death && !bee.runner.finished && bee.runner.line ? locate(bee.role, bee.runner.line) : null;
    editor.setActiveLine(at?.file ?? null, at?.line ?? null);
    card = bee
      ? beeCard(bee, sourceLines, TICKS_PER_SECOND)
      : `<p class="muted">${world.running ? 'Click a bee or the hive, or pick from the list, to see stats.' : 'Press Run to start the colony, then click a bee to see its stats.'}</p>`;
  }
  if (card !== shownCard) cardEl.innerHTML = shownCard = card;

  for (; logShown < world.log.length; logShown++) consoleEl.append(logRow(world.log[logShown]));
  while (consoleEl.childElementCount > CONSOLE_LIMIT) consoleEl.firstElementChild!.remove();
  if (logShown && consoleEl.lastElementChild) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function logRow(line: LogLine): HTMLElement {
  const row = document.createElement('div');
  row.className = line.tone ? `log-row ${line.tone}` : 'log-row';
  const meta = document.createElement('span');
  meta.className = 'log-meta';
  meta.textContent = `t=${line.tick}${line.who === 'queen' ? ' queen' : line.who !== null ? ` #${line.who}` : ''}`;
  row.append(meta, document.createTextNode(line.text));
  return row;
}

// ---- saving scripts and settings in this browser ----

// forager, queen and shared keep their original keys; each custom role's script is "role:<name>"
function codeKey(file: ScriptFile): string {
  return `hive-script:${DEFAULTS[file] === undefined ? `role:${file}` : file}`;
}

function loadCode(file: ScriptFile): string {
  const fallback = DEFAULTS[file] ?? roleTemplate(file);
  try {
    return localStorage.getItem(codeKey(file)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveCode(file: ScriptFile, code: string): void {
  try {
    localStorage.setItem(codeKey(file), code);
  } catch {
    // storage can be unavailable (private windows); the script just won't persist
  }
}

function removeCode(file: ScriptFile): void {
  try {
    localStorage.removeItem(codeKey(file));
  } catch {
    // nothing was saved, then
  }
}

/** The saved list of custom roles, skipping anything that isn't a valid role name. */
function loadRoles(): string[] {
  try {
    const list: unknown = JSON.parse(loadSetting('roles') ?? '[]');
    if (!Array.isArray(list)) return [];
    const valid = list.filter((r): r is string => typeof r === 'string' && ROLE_NAME.test(r) && !RESERVED_NAMES.includes(r));
    return [...new Set(valid)].slice(0, MAX_ROLES);
  } catch {
    return [];
  }
}

function saveRoles(): void {
  saveSetting('roles', JSON.stringify(roles));
}

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
    // as with scripts, the setting just won't persist
  }
}

setRunning(false);
requestAnimationFrame(frame);
