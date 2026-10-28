import { DEFAULT_SHARED } from '../defaultScript';
import { parse } from '../lang/parser';
import type { ScriptSet } from '../sim/scripts';
import { SCENT_LIFE, SEASON_TICKS, SENSE_RANGE, World, type Programs, type ScriptFile, type WorldOptions } from '../sim/world';

/** One goal of a lesson, checked against the running world after every tick. */
export interface Goal {
  text: string;
  check(world: World): boolean;
}

export type Topic = 'The basics' | 'Growing the colony' | 'Advanced tools' | 'Multiplayer';
export const TOPICS: Topic[] = ['The basics', 'Growing the colony', 'Advanced tools', 'Multiplayer'];

/**
 * A hands-on lesson: starter scripts, a small world to run them in, goals the game checks,
 * hints, a working solution, and what the player learned. Lessons never touch the player's
 * own single player or multiplayer scripts.
 */
export interface Lesson {
  id: string;
  topic: Topic;
  title: string;
  /** What to know and what to do, as HTML; fn() links functions to the docs. */
  intro: string;
  /** The tabs the lesson shows, in order (roles the player adds appear too). */
  tabs: ScriptFile[];
  starter: Partial<ScriptSet>;
  solution: Partial<ScriptSet>;
  /** The world the scripts run in, built fresh on every Run. */
  world(programs: Programs): World;
  goals: Goal[];
  hints: string[];
  recap: string;
  /** Ticks the solution needs to meet every goal (the tests hold lessons to it). */
  budget: number;
}

const IDLE = 'while True:\n    wait(1000)';

/** A function's name as a link to its card on the docs page. */
const fn = (name: string, args = '') => `<a href="./docs.html#${name}" target="_blank" rel="noopener"><code>${name}(${args})</code></a>`;
const code = (text: string) => `<code>${text}</code>`;

/** A single player world on a fixed meadow, with these options. */
const meadow = (flowers: [number, number][], options: WorldOptions = {}) => (programs: Programs) => new World(programs, 1, { flowers, ...options });

/**
 * A practice world of two maps side by side, like a corner of a multiplayer world: your colony
 * on map [0, 0] and, if given, a rival colony on map [1, 0] running its own scripts.
 */
function practice(flowers: [number, number][], setup: (world: World) => void, rival?: { programs: Programs; honey: number }) {
  return (programs: Programs) => {
    const world = new World(null, 1, { maps: [2, 1], flowers, hedges: true });
    world.found(programs, { x: 0, y: 0 }, null);
    if (rival) world.found(rival.programs, { x: 1, y: 0 }, 'rival').honey = rival.honey;
    setup(world);
    return world;
  };
}

/** Scripts for a lesson's rival colony. */
const rivalPrograms = (forager: string, queen = IDLE): Programs => ({ forager: parse(forager), queen: parse(queen), shared: parse(DEFAULT_SHARED) });
// the rival in the wasps lesson raids your hive with every bee it has, and keeps laying more
// the Wasps lesson's solution: stand beside the hive and sting whatever lands next to you
const GUARD_WASP = `# wasp.bee: wasps guard the hive and sting enemies next to them.
while True:
    enemies = enemies_near()
    if enemies and distance(get_pos(), enemies[0]) == 1:
        sting(enemies[0])
    else:
        move_to([hive_pos()[0] + 1, hive_pos()[1]])
`;
const RAIDER = 'while True:\n    move_to([2, 6])\n    steal()\n    go_home()\n    deposit()\n';
const RAIDER_QUEEN = 'while True:\n    if bee_count() < 2 and honey() >= 10:\n        lay()\n    wait(60)\n';
// a forager that works, for lessons about something else
const FORAGER = 'while True:\n    f = nearest_flower()\n    if f:\n        move_to(f)\n        while nectar() < capacity() and collect():\n            pass\n    go_home()\n    deposit()\n';

const made = (w: World) => w.colony.totalHoney;
const printedBy = (w: World, role: string, text: string) =>
  w.colony.log.some(l => typeof l.who === 'number' && !l.tone && l.text.includes(text) && w.colony.findBee(l.who)?.role === role);

// the hive is at [2, 6] in every lesson meadow
const NEAR: [number, number][] = [[5, 8], [6, 8], [5, 9], [6, 9], [7, 8], [7, 9]];
// plenty of flowers close by, for a forager that doesn't know about energy yet
const PLENTY: [number, number][] = [...NEAR, [4, 3], [5, 3], [4, 4], [5, 4]];

export const LESSONS: Lesson[] = [
  // ---- the basics ----
  {
    id: 'first-bee',
    topic: 'The basics',
    title: 'Your first bee',
    intro: `
      <p>You never steer a bee. You write a script, and every bee runs its own copy of it. This bee runs <b>forager.bee</b>, open in the editor.</p>
      <p>Positions are ${code('[x, y]')} tiles: ${code('[0, 0]')} is the top-left, and the hive is at ${code('[2, 6]')}. Hover the meadow to read a tile's position.
      ${fn('move', 'East')} flies one tile; ${fn('move_to', '[x, y]')} flies all the way there, one tile at a time.</p>
      <p><b>Do this:</b> make the bee fly to the flower at ${code('[6, 9]')}, then press <b>Run</b> (or Ctrl+Enter). Click the bee while it flies: the <b>Colony</b> tab shows its card, with its energy and the line it's running, highlighted in the editor too.</p>`,
    tabs: ['forager'],
    starter: { forager: '# forager.bee: this bee runs it when you press Run.\nmove(East)\n' },
    solution: { forager: 'move_to([6, 9])\n' },
    world: meadow([[6, 9], [7, 9], [6, 10]]),
    goals: [{ text: 'The bee reaches the flower at [6, 9]', check: w => w.colony.bees.some(b => b.x === 6 && b.y === 9) }],
    hints: ['move_to() takes a position as a list: move_to([6, 9]).', 'Every bee starts in the hive at [2, 6]. One move_to() line is all it takes.'],
    recap: 'Scripts run top to bottom, and actions like move_to() take game time: the script waits until the bee arrives.',
    budget: 60,
  },
  {
    id: 'nectar',
    topic: 'The basics',
    title: 'Nectar to honey',
    intro: `
      <p>Bees make honey in three steps: ${fn('collect')} picks up one nectar from the flower the bee is on, ${fn('go_home')} flies back to the hive,
      and ${fn('deposit')} turns everything it carries into honey. A bee carries up to 3 nectar, and each flower holds a few.</p>
      <p>Honey is the colony's food and money: bees eat it, the queen spends it on eggs, and it builds comb.</p>
      <p><b>Do this:</b> get 3 honey into the hive. The flowers are just east of the hive.</p>`,
    tabs: ['forager'],
    starter: { forager: 'move_to([5, 8])\ncollect()\n' },
    solution: { forager: 'move_to([5, 8])\ncollect()\ncollect()\ncollect()\ngo_home()\ndeposit()\n' },
    world: meadow(NEAR),
    goals: [{ text: '3 honey in the hive', check: w => made(w) >= 3 }],
    hints: ['Call collect() three times on the flower to fill up.', 'Then go_home() and deposit(). Watch the Honey count under the meadow (Colony tab); the hive grows a box at 50 honey, and more as it fills.'],
    recap: 'collect(), go_home(), deposit(): the loop at the heart of every colony.',
    budget: 120,
  },
  {
    id: 'loops',
    topic: 'The basics',
    title: 'Keep it going',
    intro: `
      <p>A script that ends leaves its bee idle. Real foragers run forever: wrap the work in ${code('while True:')}.</p>
      <p>Flowers run dry as you collect, and slowly refill. ${fn('nearest_flower')} finds the closest flower that still has nectar
      (within ${SENSE_RANGE} tiles), or ${code('None')}. To see every flower in sight instead, ${fn('flowers_near')} lists them nearest first, and ${fn('nectar_at', 'position')} says how full one is.
      ${fn('nectar')} and ${fn('capacity')} say how much the bee carries and can carry.</p>
      <p><b>Do this:</b> make 12 honey with one bee that keeps foraging on its own.</p>`,
    tabs: ['forager'],
    starter: { forager: 'while True:\n    f = nearest_flower()\n    move_to(f)\n    collect()\n' },
    solution: { forager: 'while True:\n    f = nearest_flower()\n    if f:\n        move_to(f)\n        while nectar() < capacity() and collect():\n            pass\n    go_home()\n    deposit()\n' },
    world: meadow(PLENTY),
    goals: [{ text: '12 honey made', check: w => made(w) >= 12 }],
    hints: [
      'The starter never brings anything home. Add go_home() and deposit() inside the loop.',
      'collect() returns False when the flower is empty or the bee is full: loop on it until nectar() reaches capacity().',
      'nearest_flower() is None when every flower nearby is empty; check it with if f: before flying.',
    ],
    recap: 'while True keeps a bee working; nearest_flower() and the return values of collect() let it adapt. Leave it running and the bee eventually starves: that\'s the next lesson.',
    budget: 900,
  },
  {
    id: 'energy',
    topic: 'The basics',
    title: 'Energy and eating',
    intro: `
      <p>Flying costs 1 energy per tile, and a bee with 0 energy starves. ${fn('energy')} reads it (100 is full), and ${fn('eat')} at the hive turns honey into energy: 1 honey gives 40.</p>
      <p>This meadow's flowers are far from the hive, and this bee starts tired. A good forager turns back while it can still make it home:
      ${fn('distance', 'a, b')} counts the tiles between two positions.</p>
      <p><b>Do this:</b> make 10 honey without the bee starving.</p>`,
    tabs: ['forager'],
    starter: { forager: 'while True:\n    f = nearest_flower()\n    if not f:\n        move_to([12, 6])\n        f = nearest_flower()\n    move_to(f)\n    while nectar() < capacity() and collect():\n        pass\n    go_home()\n    deposit()\n' },
    solution: { forager: 'while True:\n    if energy() < 40:\n        go_home()\n        eat()\n    f = nearest_flower()\n    if not f:\n        move_to([12, 6])\n        f = nearest_flower()\n    move_to(f)\n    while nectar() < capacity() and collect():\n        pass\n    go_home()\n    deposit()\n' },
    world: meadow([[13, 4], [14, 4], [13, 5], [14, 5], [15, 4], [15, 5]], { energy: 30, honey: 4 }),
    goals: [
      { text: '10 honey made', check: w => made(w) >= 10 },
      { text: 'No bee starved', check: w => made(w) >= 10 && w.colony.deaths === 0 },
    ],
    hints: ['A round trip here is over 20 tiles. Check energy() at the top of the loop.', 'When energy() is low, go_home() and eat() before heading out again.'],
    recap: 'Energy is the bee\'s fuel: eat() at the hive, and plan trips so the way home is always covered.',
    budget: 1500,
  },

  // ---- growing the colony ----
  {
    id: 'queen',
    topic: 'Growing the colony',
    title: 'The queen',
    intro: `
      <p>One bee won't go far. The queen runs <b>queen.bee</b>: she never leaves the hive, and ${fn('lay')} spends 10 honey on an egg that hatches into a worker after 300 ticks.
      A new game's colony starts with no bees and 10 honey, so the queen chooses its first bee, and that first egg hatches at once. (This lesson starts you off with one forager.)</p>
      <p>Every bee and egg needs a cell of comb. ${fn('space')} says how many are free, and ${fn('honey')} what's in store. ${code('lay()')} returns False when she can't afford it.
      Each egg shows in the comb in front of the hive: an egg, then a grub, then a cap just before it hatches.</p>
      <p>The forager already works. <b>Do this:</b> grow the colony to 3 bees.</p>`,
    tabs: ['queen', 'forager'],
    starter: { queen: '# queen.bee: the queen stays in the hive and decides when to lay.\nwhile True:\n    wait(60)\n', forager: FORAGER },
    solution: { queen: 'while True:\n    if honey() >= 10 and space() > 0:\n        lay()\n    else:\n        wait(30)\n' },
    world: meadow(NEAR, { honey: 15 }),
    goals: [{ text: '3 bees alive', check: w => w.colony.bees.length >= 3 }],
    hints: ['Call lay() in her loop when honey() is at least 10.', 'Hatching takes 300 ticks. Use the 4× or 16× buttons to speed up.'],
    recap: 'Honey becomes bees through the queen, and bees bring more honey: the colony grows on its own.',
    budget: 1500,
  },
  {
    id: 'comb',
    topic: 'Growing the colony',
    title: 'More comb',
    intro: `
      <p>Comb is the hive's space. When ${fn('space')} is 0, the queen can't lay. Workers make more with ${fn('build')} at the hive: 15 honey of wax per cell.</p>
      <p>This hive is crowded: 3 cells and plenty of honey. <b>Do this:</b> build the comb up to 6 cells.</p>`,
    tabs: ['forager'],
    starter: { forager: 'while True:\n    wait(100)\n' },
    solution: { forager: 'go_home()\nwhile comb() < 6 and honey() >= 15:\n    build()\nwhile True:\n    wait(100)\n' },
    world: meadow(NEAR, { honey: 60, comb: 3, bees: 3 }),
    goals: [{ text: 'Comb reaches 6 cells', check: w => w.colony.comb >= 6 }],
    hints: ['build() only works at the hive, and every bee starts there.', 'Loop on build() while comb() < 6 and honey() >= 15.'],
    recap: 'Honey turns into comb, and comb into room for more bees. A colony that never builds stops growing.',
    budget: 400,
  },
  {
    id: 'winter',
    topic: 'Growing the colony',
    title: 'Seasons and winter',
    intro: `
      <p>A year has four seasons of ${SEASON_TICKS.toLocaleString('en-US')} ticks, and each grows its own flowers in new places. ${fn('season')} says which it is.
      Winter has no flowers at all, flying costs double, and even resting burns energy.</p>
      <p>This colony starts late in autumn. Its foragers keep searching in the cold, burning through their honey. <b>Do this:</b> get at least one bee through to spring.</p>`,
    tabs: ['forager', 'queen'],
    starter: {
      forager: 'while True:\n    if energy() < 30:\n        go_home()\n        eat()\n    f = nearest_flower()\n    if f:\n        move_to(f)\n        collect()\n    else:\n        move_to([2 + random(15), random(12)])\n',
      queen: IDLE + '\n',
    },
    solution: {
      forager: 'while True:\n    if energy() < 30:\n        go_home()\n        eat()\n    elif season() == "winter":\n        go_home()\n        wait(30)  # rest in the hive until spring\n    else:\n        f = nearest_flower()\n        if f:\n            move_to(f)\n            collect()\n            go_home()\n            deposit()\n        else:\n            move_to([2 + random(15), random(12)])\n',
    },
    world: programs => new World(programs, 7, { tick: SEASON_TICKS * 3 - 500, bees: 3, honey: 30 }),
    goals: [
      { text: 'Reach spring', check: w => w.tick >= SEASON_TICKS * 4 },
      { text: 'With at least one bee alive', check: w => w.tick >= SEASON_TICKS * 4 && w.colony.bees.length > 0 },
    ],
    hints: ['In winter, flying in search of flowers that aren\'t there only burns energy.', 'Check season() == "winter" and keep the bees home: go_home() then wait(30).'],
    recap: 'Seasons decide what\'s possible. Save honey in autumn and rest in winter; bees age slowly in the cold.',
    budget: 3400,
  },

  // ---- advanced tools ----
  {
    id: 'scent',
    topic: 'Advanced tools',
    title: 'Scent',
    intro: `
      <p>A bee sees flowers only ${SENSE_RANGE} tiles away, and scripts can't share variables: every bee has its own copy. Bees share what they know with scent.
      ${fn('mark', '"food"')} scents the bee's tile, and ${fn('smell', '"food"')} finds the strongest mark within 12 tiles. Marks fade over ${SCENT_LIFE} ticks, most of a season, and leaving one takes just a tick.</p>
      <p>The flowers here are out of sight of the hive. <b>Do this:</b> have your bees mark the flowers they find, and follow the scent.</p>`,
    tabs: ['forager'],
    starter: { forager: 'while True:\n    f = nearest_flower()\n    if f:\n        move_to(f)\n        collect()\n        go_home()\n        deposit()\n    else:\n        move_to([2 + random(15), random(12)])\n' },
    solution: { forager: 'while True:\n    f = nearest_flower()\n    s = smell("food")\n    if f:\n        move_to(f)\n        if collect():\n            mark("food")\n        while nectar() < capacity() and collect():\n            pass\n        go_home()\n        deposit()\n    elif s:\n        move_to(s)\n    else:\n        move_to([2 + random(15), random(12)])\n' },
    world: meadow([[14, 1], [15, 1], [14, 2], [15, 2], [16, 1], [16, 2]], { bees: 3 }),
    goals: [
      { text: 'A bee marks "food"', check: w => [...w.colony.scents.values()].some(m => m.has('food')) },
      { text: '12 honey made', check: w => made(w) >= 12 },
    ],
    hints: ['After a successful collect(), call mark("food") on that tile.', 'When nearest_flower() finds nothing, try s = smell("food") and move_to(s) before exploring at random.'],
    recap: 'Scent is the colony\'s shared memory: one bee\'s find becomes everyone\'s.',
    budget: 2500,
  },
  {
    id: 'roles',
    topic: 'Advanced tools',
    title: 'Roles',
    intro: `
      <p>Different bees can run different scripts. Click <b>+ Role</b> above the editor to add one, like <b>builder</b>: a new tab, builder.bee.
      The queen lays a bee of that role with ${code('lay("builder")')}, and it runs builder.bee for life. ${fn('role_count', '"builder"')} counts them.</p>
      <p><b>Do this:</b> add a builder role whose bees ${fn('build')} comb, and have the queen lay one.</p>`,
    tabs: ['forager', 'queen'],
    starter: { queen: 'lay()\nwhile True:\n    wait(100)\n' },
    solution: {
      queen: 'lay("builder")\nwhile True:\n    wait(100)\n',
      roles: [['builder', '# builder.bee\nwhile True:\n    if honey() >= 15:\n        build()\n    else:\n        wait(30)\n']],
    },
    world: meadow(NEAR, { honey: 60 }),
    goals: [
      { text: 'A builder hatches', check: w => w.colony.bees.some(b => b.role === 'builder') },
      { text: 'A builder builds comb', check: w => w.colony.bees.some(b => b.role === 'builder' && b.stats.built > 0) },
    ],
    hints: ['Click + Role and name it builder. Its tab appears beside forager.bee.', 'In queen.bee, lay("builder"). In builder.bee, loop on build() while honey() >= 15.'],
    recap: 'Roles split the work: foragers forage, builders build, and the queen decides the mix.',
    budget: 500,
  },
  {
    id: 'shared',
    topic: 'Advanced tools',
    title: 'shared.bee',
    intro: `
      <p>Code every role needs belongs in <b>shared.bee</b>: it runs ahead of every script, the queen's too, so a function or constant defined there works in all of them.
      The queen never leaves the hive, so bee-only calls like ${code('move_to()')} belong inside functions only bees call.</p>
      <p>Both forager.bee and scout.bee here start with the same ${code('report()')} function. <b>Do this:</b> move ${code('report()')} into shared.bee, delete the copies, and keep both roles calling it.</p>`,
    tabs: ['forager', 'shared', 'queen'],
    starter: {
      forager: 'def report():\n    print(role(), "reporting from", get_pos())\n\nreport()\nwhile True:\n    wait(100)\n',
      shared: '# shared.bee: functions here work in every worker role.\n',
      queen: 'lay("scout")\nwhile True:\n    wait(100)\n',
      roles: [['scout', 'def report():\n    print(role(), "reporting from", get_pos())\n\nmove(East)\nreport()\nwhile True:\n    wait(100)\n']],
    },
    solution: {
      forager: 'report()\nwhile True:\n    wait(100)\n',
      shared: 'def report():\n    print(role(), "reporting from", get_pos())\n',
      roles: [['scout', 'move(East)\nreport()\nwhile True:\n    wait(100)\n']],
    },
    world: meadow(NEAR, { honey: 10 }),
    goals: [
      { text: 'shared.bee defines a function', check: w => (w.colony.programs?.shared ?? []).some(s => s.kind === 'def') },
      { text: 'The forager reports', check: w => printedBy(w, 'forager', 'reporting') },
      { text: 'The scout reports', check: w => printedBy(w, 'scout', 'reporting') },
    ],
    hints: ['Cut the def report(): block (both lines) from forager.bee and paste it into shared.bee.', 'Delete the copy in scout.bee too; its report() call keeps working.'],
    recap: 'shared.bee keeps common code in one place; role() lets shared code act differently per role.',
    budget: 400,
  },

  // ---- multiplayer ----
  {
    id: 'maps',
    topic: 'Multiplayer',
    title: 'A world of maps',
    intro: `
      <p>Multiplayer is a world of 5 × 5 maps, each 20 × 12 tiles, shared by up to 25 players. You found your colony by picking a free map on the <b>World map</b> and clicking where its hive goes (anywhere with no flowers under it),
      press <b>Deploy</b> to send your scripts (bees start the new code at once), and the colony keeps working while you're away. To start over somewhere else, <b>Abandon colony</b> at the bottom of the world map ends it. The <b>Chat</b> and <b>Leaders</b> tabs sit beside the log.</p>
      <p>Positions are one big grid: map ${code('[1, 0]')} starts at x 20. ${fn('my_map')} and ${fn('map_at', 'position')} give map numbers.
      A <b>hedgerow</b> runs along every border and around the world, and nothing flies through it. Each border has one <b>gate</b>, two tiles wide:
      ${fn('move_to')} finds it by itself, ${fn('distance', 'a, b')} counts the way through it, and ${fn('gates')} lists your map's gates, nearest first.
      This practice world has two maps; use the arrows above the meadow to look next door.</p>
      <p><b>Do this:</b> your map has no flowers. Send a bee to collect on the map east of yours.</p>`,
    tabs: ['forager'],
    starter: { forager: 'print("our map:", my_map())\nwhile True:\n    wait(100)\n' },
    solution: { forager: 'print("our map:", my_map())\nmove_to([22, 6])\nwhile True:\n    f = nearest_flower()\n    move_to(f)\n    collect()\n    go_home()\n    deposit()\n' },
    world: practice([[23, 5], [24, 5], [23, 6], [24, 7], [25, 6]], () => {}),
    goals: [{ text: 'A bee collects on map [1, 0]', check: w => w.flowers.some(f => f.x >= 20 && f.nectar < f.max) }],
    hints: [
      'Map [1, 0] covers x 20 to 39. Fly there with move_to([22, 6]): the bee goes out through the hedge\'s gate on its own. Then nearest_flower() sees the flowers there.',
      'print(gates()) shows where the gates are. Hover the meadow: hedge tiles say "hedgerow".',
    ],
    recap: 'One grid of positions, hedges with a gate on every border: neighbors share the meadow through the gates, and the world keeps running without you.',
    budget: 400,
  },
  {
    id: 'raids',
    topic: 'Multiplayer',
    title: 'Raids',
    intro: `
      <p>Honey can be taken. A bee at another colony's hive can ${fn('steal')} as much of its honey as it can carry, and ${fn('deposit')} it at home.
      ${fn('owner_at', 'position')} says whose hive or bee is on a tile.</p>
      <p>In multiplayer a new colony is protected for its first 24 hours: nobody can raid or sting it, and ${fn('shielded', 'position')} tells you so.
      Attacking another player ends your own protection early. Other players' bees and wasps have a red edge, so you can tell them from yours. The rival's hive here is at ${code('[22, 6]')}, full of honey, with no guards and no protection. <b>Do this:</b> bring 5 stolen honey home.</p>`,
    tabs: ['forager'],
    starter: { forager: 'print("[22, 6] belongs to", owner_at([22, 6]))\nwhile True:\n    wait(100)\n' },
    solution: { forager: 'while True:\n    move_to([22, 6])\n    steal()\n    go_home()\n    deposit()\n' },
    world: practice([], () => {}, { programs: rivalPrograms(IDLE), honey: 40 }),
    goals: [
      { text: 'Steal 5 honey', check: w => w.colony.stolen >= 5 },
      { text: 'Bring 5 home', check: w => w.colony.stolen >= 5 && made(w) >= 5 },
    ],
    hints: ['steal() only works on the rival\'s hive tile: move_to([22, 6]) first.', 'A bee carries 3, so it takes two trips: loop move_to, steal, go_home, deposit.'],
    recap: 'Stores can be stolen, and nothing stops a raid but the other player\'s code.',
    budget: 700,
  },
  {
    id: 'wasps',
    topic: 'Multiplayer',
    title: 'Wasps',
    intro: `
      <p>The rival's bees are raiding <i>you</i> now. Defense is code: <b>wasps</b>. They don't come cheap: first the colony saves up 150 honey,
      and the queen builds its wasp nest with ${fn('build_nest', '[x, y]')} on a free tile of your map. Then ${code('lay("wasp")')} raises wasps, 30 honey each; they hatch at the nest, live there (no comb needed), and run <b>wasp.bee</b>.</p>
      <p>Wasps have 30 health (bees 10), can't collect, and ${fn('sting', 'position')} an enemy on the tile right next to them for 5 damage. ${fn('enemies_near')} lists enemies in sight.
      A raider has to land on your hive for 10 ticks to steal: a wasp standing beside the hive has time to sting twice.
      Worker bees can ${fn('sting', 'position')} too, but only once: it does 10 damage, and the bee dies doing it.
      While a raider sits on your hive, a red banner over the meadow says so. In single player there are no raiders, but now and then a lone wild wasp visits for a season and hunts bees in the open. Wasps grow old like bees, so in a real game the queen keeps replacing them.</p>
      <p><b>Do this:</b> you've saved 200 honey. Build a nest, lay a wasp, and make wasp.bee guard the hive until it stings a raider to death.</p>`,
    tabs: ['queen', 'wasp'],
    starter: { queen: 'while True:\n    wait(100)\n', wasp: '# wasp.bee: every wasp runs this.\nwhile True:\n    wait(100)\n' },
    solution: { queen: 'build_nest([5, 6])\nlay("wasp")\nwhile True:\n    wait(100)\n', wasp: GUARD_WASP },
    world: practice([], w => (w.colony.honey = 200), { programs: rivalPrograms(RAIDER, RAIDER_QUEEN), honey: 30 }),
    goals: [
      { text: 'Build the wasp nest', check: w => w.colony.nest !== null },
      { text: 'A wasp hatches', check: w => w.colony.bees.some(b => b.role === 'wasp') },
      { text: 'A raider is stung to death', check: w => w.colony.kills > 0 },
    ],
    hints: [
      'In queen.bee: build_nest([5, 6]) first (it takes 100 ticks), then lay("wasp"). The wasp hatches 300 ticks later.',
      'In wasp.bee: stand on the tile next to the hive, post = [hive_pos()[0] + 1, hive_pos()[1]], and sting(enemies_near()[0]) when it\'s next to you.',
    ],
    recap: 'A nest is a big investment that turns honey into an army. Let raiders come to you: the hive tile is where they have to stop.',
    budget: 1500,
  },
  {
    id: 'nests',
    topic: 'Multiplayer',
    title: 'Wild nests',
    intro: `
      <p>Some multiplayer maps hold a wild wasp nest. Its wasps sting anyone's bees nearby (never inside a hive), and nobody can found a colony on its map until it's destroyed.
      A nest has 60 health; ${fn('sting', 'nest position')} from the tile beside it hurts it.</p>
      <p>Fights hurt: ${fn('health')} reads a unit's health, and ${fn('eat')} at the hive heals 2 per honey. You have three wasps, and wild ones fight hard: they lock onto a target and chase it.
      <b>Do this:</b> destroy the nest at ${code('[24, 6]')} (it has a wild wasp guarding it).</p>`,
    tabs: ['wasp'],
    starter: { wasp: 'move_to([23, 6])\nsting([24, 6])\n' },
    solution: {
      wasp: 'nest = [24, 6]\nwhile True:\n    if health() <= 10:\n        go_home()\n        eat()  # heal before going back\n    else:\n        e = enemies_near()\n        if e and distance(get_pos(), e[0]) == 1:\n            sting(e[0])\n        elif distance(get_pos(), nest) == 1:\n            sting(nest)\n        elif owner_at([23, 6]) == None:\n            move_to([23, 6])\n        else:\n            move_to([24, 5])\n',
    },
    world: practice([], w => {
      w.addNest({ x: 24, y: 6 }, 1);
      w.spawn(w.colony, 'wasp');
      w.spawn(w.colony, 'wasp');
      w.spawn(w.colony, 'wasp');
      w.colony.honey = 60;
    }),
    goals: [{ text: 'The nest is destroyed', check: w => w.nests.length === 0 }],
    hints: [
      'One sting() then the script ends. Loop: sting the wild wasp when it\'s next to you, otherwise the nest.',
      'Wasps can\'t share a tile: send another to [24, 5] if [23, 6] is taken (owner_at tells you).',
      'Low on health? go_home() and eat() heals, then go back.',
    ],
    recap: 'Health, healing and teamwork: fights are won by scripts that know when to retreat.',
    budget: 2500,
  },
];

/** A lesson's full script set: its starter (or solution) files, with idle scripts for the rest. */
export function lessonSet(lesson: Lesson, which: 'starter' | 'solution' = 'starter'): ScriptSet {
  const files = { ...lesson.starter, ...(which === 'solution' ? lesson.solution : {}) };
  return {
    forager: files.forager || IDLE + '\n',
    queen: files.queen ?? IDLE + '\n',
    shared: files.shared ?? '',
    wasp: files.wasp ?? IDLE + '\n',
    roles: files.roles ?? [],
  };
}

export const lessonById = (id: string) => LESSONS.find(l => l.id === id) ?? null;
