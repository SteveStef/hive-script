// Runs the default scripts for two years on a few seeds and prints how the colony does each season.
// Use it after changing tuning numbers in src/sim/world.ts: npm run balance
import { DEFAULT_FORAGER, DEFAULT_QUEEN } from '../src/defaultScript';
import { parse } from '../src/lang/parser';
import { SEASON_TICKS, World } from '../src/sim/world';
for (const seed of [1, 2, 3]) {
  const w = new World({ forager: parse(DEFAULT_FORAGER), queen: parse(DEFAULT_QUEEN) }, seed);
  const rows: string[] = [];
  for (let s = 0; s < 8 && w.running; s++) {
    let minHoney = Infinity, maxBees = 0;
    for (let i = 0; i < SEASON_TICKS && w.running; i++) { w.step(); minHoney = Math.min(minHoney, w.honey); maxBees = Math.max(maxBees, w.bees.length); }
    const starved = w.fallen.filter(b => b.death?.cause === 'starved').length;
    rows.push(`${w.season.padEnd(6)} y${w.year} bees=${w.bees.length} (max ${maxBees}) eggs=${w.eggs.length} honey=${w.honey} (min ${minHoney}) comb=${w.comb} deaths=${w.deaths} starved=${starved}`);
  }
  console.log(`seed ${seed}${w.over ? ' OVER: ' + w.over : ''}${w.error ? ' ERROR ' + JSON.stringify(w.error) : ''}\n  ` + rows.join('\n  '));
}
