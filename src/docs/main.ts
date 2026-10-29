import './docs.css';
import { coreBuiltins } from '../lang/builtins';
import { Runner } from '../lang/interpreter';
import { KEYWORDS } from '../lang/lexer';
import { parse } from '../lang/parser';
import { Renderer } from '../render/renderer';
import { TILE } from '../render/scenery';
import { API_DOCS } from '../sim/apiDocs';
import { World } from '../sim/world';
import { demoOptions, demoPrograms, DOCS, SECTIONS, type Demo, type DocEntry } from './entries';

const DEMO_TICKS_PER_SECOND = 30; // twice 1x, so the clips don't drag
const DEFAULT_LENGTH = 600; // ticks before a clip that never finishes starts over
const HOLD_TICKS = 45; // a short pause on the last frame before starting over
const API_NAMES = new Set(API_DOCS.map(d => d.name));

// ---- code display ----

function esc(text: string): string {
  return text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function highlight(line: string): string {
  return line.replace(/(#.*$)|("[^"]*"|'[^']*')|\b(\d+)\b|\b([A-Za-z_]\w*)\b|([^#"'\w]+)/g, (m, com, str, num, word, other) => {
    if (com) return `<span class="t-com">${esc(com)}</span>`;
    if (str) return `<span class="t-str">${esc(str)}</span>`;
    if (num) return `<span class="t-num">${num}</span>`;
    if (word) return KEYWORDS.has(word) ? `<span class="t-kw">${word}</span>` : API_NAMES.has(word) ? `<span class="t-api">${word}</span>` : word;
    return esc(other ?? m);
  });
}

function codeBlock(source: string): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.innerHTML = source
    .split('\n')
    .map((l, i) => `<span class="ln" data-line="${i + 1}"><span class="no">${i + 1}</span>${highlight(l) || ' '}</span>`)
    .join('');
  return pre;
}

// ---- clips: the real game running a demo script on loop ----

class Clip {
  playing = true;
  visible = false;
  private world!: World;
  private readonly full = document.createElement('canvas');
  private readonly renderer: Renderer;
  private readonly g: CanvasRenderingContext2D;
  private acc = 0;
  private hold = 0;
  private line = 0;
  private shownOutput = '';

  constructor(private readonly demo: Demo, canvas: HTMLCanvasElement, private readonly code: HTMLElement, private readonly output: HTMLElement) {
    this.renderer = new Renderer(this.full);
    this.renderer.setPace(DEMO_TICKS_PER_SECOND);
    canvas.width = demo.view[2] * TILE;
    canvas.height = demo.view[3] * TILE;
    this.g = canvas.getContext('2d')!;
    this.reset();
  }

  private reset(): void {
    const d = this.demo;
    this.world = new World(demoPrograms(d), 1, demoOptions(d));
    this.acc = 0;
    this.hold = 0;
  }

  private get follower() {
    const c = this.world.colony;
    if (this.demo.follow === 'queen') return c.queen;
    return this.demo.follow === 'wasp' ? (c.bees.find(b => b.role === 'wasp') ?? c.fallen.find(b => b.role === 'wasp')) : (c.bees[0] ?? c.fallen[0]);
  }

  /** The followed script has run to its end and nothing is left to watch. */
  private get done(): boolean {
    const f = this.follower;
    return !!f && f.runner.finished && !f.action && this.world.colony.eggs.length === 0;
  }

  advance(ms: number): void {
    if (!this.playing) return;
    this.acc += (ms * DEMO_TICKS_PER_SECOND) / 1000;
    let ticks = Math.floor(this.acc);
    this.acc -= ticks;
    while (ticks-- > 0) {
      if (this.done) {
        if (++this.hold > HOLD_TICKS) return this.reset();
        continue;
      }
      this.world.step();
      if (this.world.tick - (this.demo.tick ?? 0) >= (this.demo.length ?? DEFAULT_LENGTH)) return this.reset();
    }
  }

  draw(): void {
    const w = this.world.colony;
    const bee = w.bees[0];
    this.renderer.draw(w, 0, this.demo.sight && bee ? bee.id : null, null);
    w.events = [];
    const [x, y, vw, vh] = this.demo.view;
    this.g.drawImage(this.full, x * TILE, y * TILE, vw * TILE, vh * TILE, 0, 0, vw * TILE, vh * TILE);

    const runner = this.follower?.runner;
    const line = runner && !runner.finished ? runner.line : 0;
    if (line !== this.line) {
      this.code.querySelector('.ln.on')?.classList.remove('on');
      this.code.querySelector(`.ln[data-line="${line}"]`)?.classList.add('on');
      this.line = line;
    }
    const f = this.follower;
    const who = this.demo.follow === 'queen' ? 'queen' : f && 'id' in f ? f.id : 1;
    const output = w.log.filter(l => l.who === who && !l.tone).slice(-3).map(l => l.text).join('\n');
    if (output !== this.shownOutput) {
      this.shownOutput = output;
      this.output.replaceChildren(...(output ? output.split('\n') : []).map(text => Object.assign(document.createElement('span'), { textContent: text })));
    }
  }
}

// ---- building the page ----

const clips: Clip[] = [];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function signature(name: string): string {
  return API_DOCS.find(d => d.name === name)?.signature ?? name;
}

function scriptTag(name: string): string {
  const only = API_DOCS.find(d => d.name === name)?.only;
  return only === 'queen' ? 'queen.bee only' : only === 'wasp' ? 'wasp.bee only' : only === 'worker' ? 'worker scripts only' : 'every script';
}

function card(name: string, entry: DocEntry): HTMLElement {
  const el = document.createElement('article');
  el.className = 'fn';
  el.id = name;
  const names = [name, ...(entry.covers ?? [])];
  const doc = API_DOCS.find(d => d.name === name)!;
  const also = (entry.covers ?? [])
    .map(n => `<li><code>${esc(signature(n))}</code> ${esc(API_DOCS.find(d => d.name === n)!.doc)}</li>`)
    .join('');
  el.innerHTML = `
    <header class="fn-head">
      <h3>${names.map(n => `<code>${esc(signature(n))}</code>`).join('<span class="sep">·</span>')}</h3>
      <div class="tags"><span class="tag">${scriptTag(name)}</span><span class="tag time">${esc(entry.time)}</span></div>
    </header>
    <p class="lead">${esc(doc.doc)}</p>
    ${also ? `<ul class="also">${also}</ul>` : ''}
    <p>${esc(entry.details)}</p>
    <p class="returns"><b>Returns</b> ${esc(entry.returns)}</p>`;

  if (entry.demo) {
    const demo = document.createElement('div');
    demo.className = 'demo';
    const figure = document.createElement('figure');
    figure.className = 'clip';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `Animated example of ${names.join(', ')}: ${entry.details}`);
    const out = document.createElement('pre');
    out.className = 'out';
    const hint = document.createElement('span');
    hint.className = 'clip-hint';
    figure.append(canvas, out, hint);
    const script = document.createElement('div');
    script.className = 'script';
    const file = entry.demo.follow === 'queen' ? 'queen.bee' : entry.demo.follow === 'wasp' ? 'wasp.bee' : 'forager.bee';
    script.innerHTML = `<div class="script-head">Example ${file}</div>`;
    const code = codeBlock(entry.demo.follow === 'queen' ? entry.demo.queen! : entry.demo.follow === 'wasp' ? entry.demo.wasp! : entry.demo.forager!);
    script.append(code);
    demo.append(figure, script);
    el.append(demo);

    const clip = new Clip(entry.demo, canvas, code, out);
    clip.playing = !reduceMotion;
    const setHint = () => (hint.textContent = clip.playing ? 'Click to pause' : 'Click to play');
    setHint();
    figure.addEventListener('click', () => {
      clip.playing = !clip.playing;
      setHint();
    });
    clips.push(clip);
    visibility.observe(figure);
    (figure as HTMLElement & { clip?: Clip }).clip = clip;
  } else if (entry.example) {
    const out: string[] = [];
    new Runner(parse(entry.example), coreBuiltins(t => out.push(t))).run(10_000);
    const demo = document.createElement('div');
    demo.className = 'demo';
    const script = document.createElement('div');
    script.className = 'script';
    script.innerHTML = '<div class="script-head">Example</div>';
    script.append(codeBlock(entry.example));
    const result = document.createElement('div');
    result.className = 'script';
    result.innerHTML = `<div class="script-head">Prints</div><pre class="code printed">${esc(out.join('\n'))}</pre>`;
    demo.append(script, result);
    el.append(demo);
  }
  return el;
}

// only clips on screen run, so a long page stays light
const visibility = new IntersectionObserver(
  items => {
    for (const item of items) {
      const clip = (item.target as HTMLElement & { clip?: Clip }).clip;
      if (clip) clip.visible = item.isIntersecting;
    }
  },
  { rootMargin: '120px' },
);

const toc = document.getElementById('toc')!;
const content = document.getElementById('content')!;
for (const section of SECTIONS) {
  const entries = Object.entries(DOCS).filter(([, e]) => e.section === section);
  const slug = section.toLowerCase().replace(/\W+/g, '-');
  const group = document.createElement('div');
  group.className = 'toc-group';
  group.innerHTML = `<a class="toc-section" href="#${slug}">${esc(section)}</a>` +
    entries.map(([name, e]) => `<a href="#${name}">${[name, ...(e.covers ?? [])].join(', ')}</a>`).join('');
  toc.append(group);

  const block = document.createElement('section');
  block.className = 'section';
  block.id = slug;
  block.innerHTML = `<h2>${esc(section)}</h2>`;
  for (const [name, entry] of entries) block.append(card(name, entry));
  content.append(block);
}

let last = 0;
function frame(now: number): void {
  const dt = last ? Math.min(100, now - last) : 0;
  last = now;
  for (const clip of clips) {
    if (!clip.visible) continue;
    clip.advance(dt);
    clip.draw();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
