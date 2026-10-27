import { format } from '../lang/interpreter';
import type { BeeView, ColonyView, QueenView, RunnerView } from '../sim/view';
import { BEE_COST, ENERGY_PER_TILE, locate, MAX_ENERGY, NEST_COST, WASP_COST, type ScriptFile } from '../sim/world';

const HUNGRY = 25;
const LONG_VALUE = 48;

export type StatusTone = 'ok' | 'warn' | 'dead';

/** What a bee is doing, in words, plus how worried the player should be. */
export function beeStatus(bee: BeeView): { label: string; tone: StatusTone } {
  if (bee.death) {
    const c = bee.death.cause;
    const label = c === 'starved' ? 'Starved' : c === 'by choice' ? 'Gave its life' : c === 'stung' ? 'Stung to death' : 'Died of old age';
    return { label, tone: 'dead' };
  }
  if (bee.runner.error) return { label: 'Stopped by an error', tone: 'warn' };
  if (bee.runner.finished) return { label: 'Finished its script', tone: 'warn' };
  const tone: StatusTone = bee.energy < HUNGRY ? 'warn' : 'ok';
  switch (bee.action?.kind) {
    case 'move': return { label: 'Flying', tone };
    case 'collect': return { label: 'Collecting', tone };
    case 'deposit': return { label: 'Depositing', tone };
    case 'eat': return { label: 'Eating', tone };
    case 'mark': return { label: 'Marking', tone };
    case 'sting': return { label: 'Stinging', tone };
    case 'steal': return { label: 'Raiding', tone };
    case 'bump': return { label: 'Bumped the edge', tone };
    default: return { label: 'Thinking', tone };
  }
}

/** The stats card for one bee, as HTML. Anything from the player's script is escaped. */
export function beeCard(bee: BeeView, sourceLines: Record<ScriptFile, string[]>, ticksPerSecond: number): string {
  const status = beeStatus(bee);
  const alive = bee.death === null;
  const n = (v: number) => Math.floor(v).toLocaleString('en-US');
  const clock = (ticks: number) => {
    const s = Math.round(ticks / ticksPerSecond);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const lifeLeft = bee.lifespan - bee.age;
  const energyTone = bee.energy < HUNGRY ? 'low' : bee.energy < 50 ? 'mid' : 'good';
  const wasp = bee.role === 'wasp';
  const healthTone = bee.health <= bee.maxHealth / 4 ? 'low' : bee.health <= bee.maxHealth / 2 ? 'mid' : 'good';

  const at = locate(bee.role, bee.runner.line);
  const where = alive
    ? `<span class="k">${at.file === bee.role ? '' : `${at.file}.bee `}Line ${at.line}</span><code>${esc(sourceLines[at.file]?.[at.line - 1]?.trim() ?? '')}</code>`
    : `<span class="k">Died</span>at tick ${n(bee.death!.tick)}, on tile [${bee.x}, ${bee.y}]`;

  return `
    <div class="card-head"><b>${wasp ? `Wasp #${bee.id}` : `Bee #${bee.id} · ${esc(bee.role)}`}</b><span class="badge ${status.tone}">${status.label}</span></div>
    <div class="card-line">${where}</div>
    <div class="meters">
      <span class="k">${wasp ? 'Honey' : 'Nectar'}</span>${bar(bee.carrying, bee.capacity, 'nectar')}
      <span>${bee.carrying} of ${bee.capacity}</span>
      <span class="k">Health</span>${bar(bee.health, bee.maxHealth, healthTone)}
      <span>${alive ? `${bee.health} of ${bee.maxHealth}${bee.health < bee.maxHealth ? ' · eat() at the hive to heal' : ''}` : '0'}</span>
      <span class="k">Energy</span>${bar(bee.energy, MAX_ENERGY, energyTone)}
      <span>${n(bee.energy)} of ${MAX_ENERGY}${alive ? ` · enough for ${n(bee.energy / ENERGY_PER_TILE)} tiles` : ''}</span>
      <span class="k">Age</span>${bar(bee.age, bee.lifespan, lifeLeft < 600 && alive ? 'low' : 'life')}
      <span>${alive
        ? `${n(bee.age)} of ${n(bee.lifespan)} ticks · old age in ${n(lifeLeft)} (about ${clock(lifeLeft)} at 1×)`
        : `lived ${n(bee.age)} ticks`}</span>
    </div>
    <dl class="facts">
      <dt>Position</dt><dd>[${bee.x}, ${bee.y}]</dd>
      <dt>Hatched</dt><dd>tick ${n(bee.bornAt)}</dd>
      <dt>Nectar collected</dt><dd>${bee.stats.collected}</dd>
      <dt>Honey delivered</dt><dd>${bee.stats.delivered}</dd>
      <dt>Tiles flown</dt><dd>${bee.stats.tilesFlown}</dd>
      <dt>Honey eaten</dt><dd>${bee.stats.honeyEaten}</dd>
      <dt>Comb built</dt><dd>${bee.stats.built}</dd>
      <dt>Honey stolen</dt><dd>${bee.stats.stolen ?? 0}</dd>
      <dt>Stings landed</dt><dd>${bee.stats.stings ?? 0}</dd>
      <dt>Heading to</dt><dd>${bee.action?.kind === 'move' ? `[${bee.action.target.x}, ${bee.action.target.y}] · ${bee.action.path.length} tile${bee.action.path.length === 1 ? '' : 's'}` : 'not moving'}</dd>
    </dl>
    <div class="vars-head">Variables</div>
    ${variables(bee.runner)}`;
}

export function queenStatus(queen: QueenView): { label: string; tone: StatusTone } {
  if (queen.runner.error) return { label: 'Stopped by an error', tone: 'warn' };
  if (queen.runner.finished) return { label: 'Finished her script', tone: 'warn' };
  if (queen.action?.kind === 'lay') return { label: 'Laying', tone: 'ok' };
  if (queen.action?.kind === 'wait') return { label: 'Waiting', tone: 'ok' };
  return { label: 'Thinking', tone: 'ok' };
}

/** The queen's card: her script line, eggs and the comb they need. */
export function queenCard(world: ColonyView, sourceLines: string[]): string {
  const queen = world.queen!;
  const status = queenStatus(queen);
  const used = world.comb - world.space; // wasps live in the nest, not the comb
  const next = world.eggs[0];
  return `
    <div class="card-head"><b>The queen</b><span class="badge ${status.tone}">${status.label}</span></div>
    <div class="card-line"><span class="k">Line ${queen.runner.line}</span><code>${esc(sourceLines[queen.runner.line - 1]?.trim() ?? '')}</code></div>
    <div class="meters">
      <span class="k">Comb</span>${bar(used, world.comb, used >= world.comb ? 'low' : 'nectar')}
      <span>${used} of ${world.comb} cells in use (${world.bees.length} bees, ${world.eggs.length} eggs)</span>
    </div>
    <dl class="facts">
      <dt>Eggs laid</dt><dd>${queen.laid}</dd>
      <dt>Next hatch</dt><dd>${next ? `in ${next.hatchAt - world.tick} ticks` : 'no eggs'}</dd>
      <dt>Egg cost</dt><dd>${BEE_COST} honey; a wasp ${WASP_COST}, once there's a nest</dd>
      <dt>Wasp nest</dt><dd>${world.nest ? `at [${world.nest.x}, ${world.nest.y}] · health ${world.nest.health} of ${world.nest.maxHealth}` : `none yet (build_nest costs ${NEST_COST} honey)`}</dd>
      <dt>Free comb</dt><dd>${world.space}</dd>
    </dl>
    <div class="vars-head">Variables</div>
    ${variables(queen.runner)}`;
}

function variables(runner: RunnerView): string {
  const vars = runner.variables();
  return vars.length
    ? `<dl class="vars">${vars.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(clip(format(v, true)))}</dd>`).join('')}</dl>`
    : '<p class="muted">No variables yet.</p>';
}

function bar(value: number, max: number, tone: string): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar ${tone}"><i style="width:${pct.toFixed(1)}%"></i></span>`;
}

function clip(text: string): string {
  return text.length > LONG_VALUE ? text.slice(0, LONG_VALUE - 1) + '…' : text;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
