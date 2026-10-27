// Runs a colony that looks after itself (tests/fixtures.ts) for two years on a few seeds and prints how the colony does each season.
// Use it after changing tuning numbers in src/sim/world.ts: npm run balance
import { DEFAULT_SHARED } from '../src/defaultScript';
import { SURVIVOR_FORAGER, SURVIVOR_QUEEN } from '../tests/fixtures';
import { parse } from '../src/lang/parser';
import { SEASON_TICKS, SHARED_LINE_BASE, World } from '../src/sim/world';
for (const seed of [1, 2, 3]) {
  const shared = parse(DEFAULT_SHARED, SHARED_LINE_BASE + 1);
  const w = new World({ forager: parse(SURVIVOR_FORAGER), queen: parse(SURVIVOR_QUEEN), shared }, seed);
  const rows: string[] = [];
  for (let s = 0; s < 8 && w.running; s++) {
    let minHoney = Infinity, maxBees = 0;
    for (let i = 0; i < SEASON_TICKS && w.running; i++) { w.step(); minHoney = Math.min(minHoney, w.colony.honey); maxBees = Math.max(maxBees, w.colony.bees.length); }
    const starved = w.colony.fallen.filter(b => b.death?.cause === 'starved').length;
    rows.push(`${w.season.padEnd(6)} y${w.year} bees=${w.colony.bees.length} (max ${maxBees}) eggs=${w.colony.eggs.length} honey=${w.colony.honey} (min ${minHoney}) comb=${w.colony.comb} deaths=${w.colony.deaths} starved=${starved}`);
  }
  console.log(`seed ${seed}${w.colony.over ? ' OVER: ' + w.colony.over : ''}${w.error ? ' ERROR ' + JSON.stringify(w.error) : ''}\n  ` + rows.join('\n  '));
}
