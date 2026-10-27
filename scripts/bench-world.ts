// A full multiplayer world: a colony on every map without a wild nest, on the default scripts. Prints how long ticks take as the colonies grow.
// npm run bench. The server steps every world once per GAME_TICK_MS (133 ms), so a tick must stay well under that.
import { DEFAULT_FORAGER, DEFAULT_QUEEN, DEFAULT_SHARED } from '../src/defaultScript';
import { parse } from '../src/lang/parser';
import { toJson } from '../src/sim/view';
import { SEASON_TICKS, SHARED_LINE_BASE, WILD_NESTS, World } from '../src/sim/world';

const programs = () => ({ forager: parse(DEFAULT_FORAGER), queen: parse(DEFAULT_QUEEN), shared: parse(DEFAULT_SHARED, SHARED_LINE_BASE + 1) });
const world = new World(null, 42, { maps: [5, 5], nests: WILD_NESTS, haltOnError: false });
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (!world.nestOn({ x, y })) world.found(programs(), { x, y }, `p${x}${y}`);
for (let s = 0; s < 8; s++) {
  let worst = 0;
  const t0 = performance.now();
  for (let i = 0; i < SEASON_TICKS; i++) {
    const a = performance.now();
    world.step();
    world.events = [];
    worst = Math.max(worst, performance.now() - a);
  }
  const avg = (performance.now() - t0) / SEASON_TICKS;
  const bees = world.colonies.reduce((n, c) => n + c.bees.length, 0);
  const t1 = performance.now();
  const json = JSON.stringify(toJson(world, world.colonies[12], world.colonies[12].map));
  const viewMs = performance.now() - t1;
  const t2 = performance.now();
  const saveBytes = JSON.stringify(world.save()).length;
  const saveMs = performance.now() - t2;
  console.log(`${world.season.padEnd(6)} y${world.year} colonies=${world.colonies.filter(c => !c.over).length} bees=${bees} tick avg=${avg.toFixed(2)}ms worst=${worst.toFixed(1)}ms | view ${(json.length / 1024).toFixed(0)}KB ${viewMs.toFixed(1)}ms | save ${(saveBytes / 1024).toFixed(0)}KB ${saveMs.toFixed(1)}ms`);
}
