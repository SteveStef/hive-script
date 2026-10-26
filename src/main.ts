import './style.css';
import { Music } from './audio/music';
import { DEFAULT_FORAGER, DEFAULT_QUEEN } from './defaultScript';
import { ScriptError } from './lang/errors';
import { parse } from './lang/parser';
import { Renderer } from './render/renderer';
import { TILE } from './render/scenery';
import { MAX_ENERGY, SEASON_TICKS, World, type Bee, type LogLine, type Programs, type ScriptFile, type Tile } from './sim/world';
import { beeCard, beeStatus, queenCard, queenStatus } from './ui/beeCard';
import { createEditor } from './ui/editor';

const TICKS_PER_SECOND = 15; // at 1x; 4x and 16x multiply this
const CONSOLE_LIMIT = 300;
const FILES: ScriptFile[] = ['forager', 'queen'];
const DEFAULTS: Record<ScriptFile, string> = { forager: DEFAULT_FORAGER, queen: DEFAULT_QUEEN };
const TAB_NOTES: Record<ScriptFile, string> = { forager: 'every worker bee runs this', queen: 'the queen runs this in the hive' };

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

const editor = createEditor($('editor'), { forager: loadCode('forager'), queen: loadCode('queen') });
editor.onChange(saveCode);
editor.onRun(start);
editor.onShow(file => {
  document.querySelectorAll<HTMLElement>('.file-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.file === file)));
  $('tab-note').textContent = TAB_NOTES[file];
});
document.querySelectorAll<HTMLElement>('.file-tab').forEach(tab => {
  tab.addEventListener('click', () => editor.show(tab.dataset.file as ScriptFile));
});

let world = new World(null);
const renderer = new Renderer(canvas, world);
let running = false;
let speed = 1;
let acc = 0;
let last = 0;
let selected: Selection = null;
let hover: Tile | null = null;
let logShown = 0;
// the scripts as they were when Run was pressed, for the cards' line text
let sourceLines: Record<ScriptFile, string[]> = { forager: [], queen: [] };
let shownChips = '';
let shownCard = '';
const music = new Music(loadSetting('music') === 'off');
musicBtn.setAttribute('aria-pressed', String(!music.isMuted));

// ---- controls ----

/** Parses both scripts and starts a fresh colony running them. */
function start(): void {
  editor.setError(null);
  const programs = {} as Programs;
  for (const file of FILES) {
    try {
      programs[file] = parse(editor.getValue(file));
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      editor.setError({ file, line: e.line, message: e.message });
      consoleEl.replaceChildren(logRow({ tick: 0, who: null, text: `${file}.bee line ${e.line}: ${e.message}`, tone: 'error' }));
      return;
    }
  }
  world = new World(programs);
  sourceLines = { forager: editor.getValue('forager').split('\n'), queen: editor.getValue('queen').split('\n') };
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
  if (target !== null) editor.show(target === 'queen' ? 'queen' : 'forager');
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
  const what = world.atHive(hover) ? ' · the hive (click to follow the queen)' : flower ? ` · flower with ${flower.nectar} nectar` : '';
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
    editor.setActiveLine(bee && !bee.death && !bee.runner.finished ? 'forager' : null, bee?.runner.line || null);
    card = bee
      ? beeCard(bee, sourceLines.forager, TICKS_PER_SECOND)
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

function loadCode(file: ScriptFile): string {
  try {
    return localStorage.getItem(`hive-script:${file}`) ?? DEFAULTS[file];
  } catch {
    return DEFAULTS[file];
  }
}

function saveCode(file: ScriptFile, code: string): void {
  try {
    localStorage.setItem(`hive-script:${file}`, code);
  } catch {
    // storage can be unavailable (private windows); the script just won't persist
  }
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
