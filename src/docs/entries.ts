import {
  BEE_CAPACITY, BEE_HEALTH, BEE_STING_DAMAGE, HEALTH_PER_HONEY, NEST_BUILD_TICKS, NEST_COST, NEST_HEALTH, STEAL_TICKS, STING_DAMAGE, STING_TICKS, WASP_CAPACITY, WASP_COST, WASP_HEALTH,
  BEE_COST, BUILD_COST, BUILD_TICKS, COLLECT_TICKS, DEPOSIT_TICKS, EAT_TICKS, ENERGY_PER_HONEY, HATCH_TICKS, LAY_TICKS,
  BLOOMS, MARK_TICKS, MOVE_TICKS, SCENT_LIFE, SCENT_MAX, SEASON_TICKS, SENSE_RANGE, SHARED_LINE_BASE, SMELL_RANGE, VISITOR_KILLS, WINTER_IDLE,
  type Programs, type WorldOptions,
} from '../sim/world';
import { parse } from '../lang/parser';

/** A small scene the docs page plays on loop: real game, real scripts. */
export interface Demo {
  forager?: string; // what the demo bee runs; an idle bee if left out
  queen?: string; // what the queen runs; an idle queen if left out
  view: [number, number, number, number]; // part of the meadow to show, in tiles: x, y, width, height
  follow?: 'bee' | 'queen' | 'wasp'; // whose line is highlighted and whose prints are shown (default: the bee)
  wasp?: string; // what the colony's wasps run
  wasps?: number; // wasps the colony starts with
  health?: number; // the first bee's starting health
  nest?: [number, number]; // a wild wasp nest...
  nestWasps?: number; // ...and how many wild wasps are in it
  rival?: { x: number; y: number; honey: number; shielded?: boolean }; // another colony's hive, named "rival"
  colonyNest?: [number, number]; // the colony's own wasp nest, already built
  hedges?: boolean; // a corner of a multiplayer world: two maps, hedged, with a gate between
  bees?: number;
  honey?: number;
  tick?: number;
  energy?: number;
  comb?: number;
  roles?: Record<string, string>; // custom roles' scripts, by name
  sight?: boolean; // draw the circle of what the bee can see
  length?: number; // ticks before the clip starts over, if the script hasn't finished
}

export interface DocEntry {
  section: string;
  details: string; // a fuller explanation than the one-line editor tooltip
  returns: string;
  time: string; // how much game time a call takes
  demo?: Demo; // an animated clip...
  example?: string; // ...or, for plain language helpers, a snippet whose output is shown
  covers?: string[]; // other names this card also explains
}

export const SECTIONS = ['Moving', 'Working', 'What a bee knows', 'Scent', 'The queen', 'Roles', 'Raids and wasps', 'The colony', 'Time and seasons', 'Utilities', 'Language helpers'];

// Clips use one fixed meadow, so the positions in their scripts always land on flowers.
// (In the game, flowers bloom in new places every season.) The hive sits at [2, 6].
const DEMO_MEADOW: [number, number][] = [
  [4, 9], [5, 9], [5, 10],
  [5, 3], [6, 3],
  [6, 9], [7, 10], [8, 9],
  [7, 2], [8, 2], [8, 3], [9, 3],
  [12, 6], [13, 6], [13, 7],
  [13, 1], [14, 1], [14, 2],
  [16, 9], [17, 9], [17, 10], [18, 9],
];

const IDLE = 'while True:\n    wait(1000)';

/** The scripts a clip runs; an idle bee or queen where it leaves one out. */
export function demoPrograms(d: Demo): Programs {
  const roles = Object.fromEntries(Object.entries(d.roles ?? {}).map(([name, src]) => [name, parse(src)]));
  return { forager: parse(d.forager ?? IDLE), queen: parse(d.queen ?? IDLE), wasp: parse(d.wasp ?? IDLE), roles, shared: parse('', SHARED_LINE_BASE + 1) };
}

/** The world a clip starts from. */
export function demoOptions(d: Demo): WorldOptions {
  return {
    bees: d.bees ?? (d.wasps ? 0 : 1), wasps: d.wasps, honey: d.honey, tick: d.tick, energy: d.energy, health: d.health, comb: d.comb, flowers: DEMO_MEADOW,
    nests: d.nest ? [d.nest] : undefined, nestWasps: d.nestWasps,
    rival: d.rival && { ...d.rival, owner: 'rival' },
    nest: d.colonyNest,
    ...(d.hedges ? { maps: [2, 1] as [number, number], hedges: true, home: true } : {}),
  };
}

const HIVE_VIEW: Demo['view'] = [0, 3, 7, 6];
const MEADOW_VIEW: Demo['view'] = [0, 2, 11, 9];
const instant = 'Instant';

export const DOCS: Record<string, DocEntry> = {
  // ---- moving ----
  move: {
    section: 'Moving',
    details: 'Moves exactly one tile. The bee turns to face the way it flies. Only one bee fits on a tile (the hive is the exception), so if the edge of the meadow or another bee is in the way, the bee stays put and move() returns False. A loop like "while move(North):" flies until something stops it.',
    returns: 'True if the bee moved, False if the edge or another bee was in the way.',
    time: `${MOVE_TICKS} ticks`,
    demo: { forager: 'move(East)\nmove(East)\nmove(South)\nmove(South)\nmove(West)\nmove(West)\nmove(North)\nmove(North)', view: HIVE_VIEW },
  },
  North: {
    section: 'Moving',
    details: 'The four directions move() understands. North is up the screen and South is down; East is right and West is left. They are plain values, so you can keep them in a list and pick one, as in [North, South, East, West][random(4)].',
    returns: 'Not a function: these are values you pass to move().',
    time: instant,
    covers: ['South', 'East', 'West'],
    demo: { forager: 'for d in [North, East, South, West]:\n    print("flying", d)\n    move(d)', view: HIVE_VIEW },
  },
  move_to: {
    section: 'Moving',
    details: 'Flies to any tile, one tile at a time: first across (x), then up or down (y). If another bee is in the way it takes the other route or sidesteps to the right, so bees meeting head-on pass each other. If the destination itself stays taken, it gives up. Positions are [x, y] lists with [0, 0] at the top-left; hover the meadow in the game to read them.',
    returns: 'True if the bee got there, False if it was blocked too long.',
    time: `${MOVE_TICKS} ticks per tile`,
    demo: { forager: 'move_to([8, 9])\nmove_to([6, 3])\nmove_to([2, 6])', view: MEADOW_VIEW },
  },
  go_home: {
    section: 'Moving',
    details: 'A shortcut for move_to(hive_pos()). deposit(), eat() and build() only work at the hive, so they usually come right after go_home().',
    returns: 'True.',
    time: `${MOVE_TICKS} ticks per tile`,
    demo: { forager: 'move_to([7, 4])\ngo_home()\nprint("home again:", at_hive())', view: MEADOW_VIEW },
  },

  // ---- working ----
  collect: {
    section: 'Working',
    details: `Takes one nectar from the flower the bee is on. Clover and lavender hold ${BLOOMS.spring.nectar} nectar and goldenrod ${BLOOMS.autumn.nectar}, and they regrow over time: quickly in summer, slowly in autumn, not at all in winter. Flowers close up when they are empty. collect() fails if the bee is not on a flower, the flower is empty, or the bee is already full (see capacity()).`,
    returns: 'True if the bee picked up nectar, otherwise False.',
    time: `${COLLECT_TICKS} ticks`,
    demo: { forager: 'move_to([5, 9])\nwhile collect():\n    print("carrying", nectar())\nprint("full or empty, so collect() said False")', view: HIVE_VIEW.map((v, i) => (i === 3 ? 8 : v)) as Demo['view'] },
  },
  deposit: {
    section: 'Working',
    details: `Turns everything the bee is carrying into honey in the hive, one honey per nectar. Honey is the colony's only currency: eggs cost ${BEE_COST}, a cell of comb costs ${BUILD_COST}, and bees eat it. Away from the hive deposit() does nothing.`,
    returns: 'How much honey it made (0 if the bee was not at the hive or carried nothing).',
    time: `${DEPOSIT_TICKS} ticks`,
    demo: { forager: 'move_to([5, 9])\nwhile collect():\n    pass\ngo_home()\nmade = deposit()\nprint("made", made, "honey; the hive has", honey())', view: [0, 3, 8, 8] },
  },
  eat: {
    section: 'Working',
    details: `Refills energy from the hive's honey. Each honey gives ${ENERGY_PER_HONEY} energy, and a bee only eats whole honey it has room for, so a nearly full bee eats nothing. A bee whose energy reaches 0 starves, so long trips need a plan to come home and eat.`,
    returns: 'How much honey the bee ate.',
    time: `${EAT_TICKS} ticks`,
    demo: { forager: 'print("energy before:", energy())\nate = eat()\nprint("ate", ate, "honey; energy now:", energy())', view: HIVE_VIEW, energy: 30, honey: 10 },
  },
  build: {
    section: 'Working',
    details: `Turns ${BUILD_COST} honey into wax for one more cell of comb. Every bee and every egg needs a cell, so comb is what limits how big the colony can grow. It only works at the hive.`,
    returns: 'True if a cell was built; False away from the hive or without enough honey.',
    time: `${BUILD_TICKS} ticks`,
    demo: { forager: 'print("comb:", comb(), "| honey:", honey())\nok = build()\nprint("built:", ok, "| comb:", comb(), "| honey:", honey())', view: HIVE_VIEW, honey: 30 },
  },

  die: {
    section: 'Working',
    details: 'Ends the bee\'s life on the spot, the way old or sick honeybees fly off so they don\'t burden the hive. A dead bee eats no more honey and frees its cell of comb for a new egg, so it can be the right call for an old bee in winter, when every honey counts: "if season() == "winter" and life_left() < 600: die()". Whatever nectar it carries is lost, and its script stops: nothing after die() runs. In the clip the hive is full, so the queen can only lay once the bee is gone.',
    returns: 'Nothing: the bee is gone.',
    time: instant,
    // the hive is full until the bee dies; then the queen lays in its cell
    demo: {
      forager: 'move(East)\nprint("free cells:", space())\nprint("my work here is done")\ndie()\nprint("this line never runs")',
      queen: 'while not lay():\n    wait(5)', comb: 1, honey: 20, view: HIVE_VIEW, length: 200,
    },
  },

  // ---- what a bee knows ----
  nearest_flower: {
    section: 'What a bee knows',
    details: `Looks for flowers that still have nectar within ${SENSE_RANGE} tiles (the dotted circle in the clip), skipping any flower another bee is already on, so bees spread out instead of queuing. If none are in sight it returns None, which counts as False in an if, so "if f:" checks whether anything was found. The flower the bee is standing on counts too. Since flowers bloom in new places every season, this (with smell()) is how a script finds food.`,
    returns: 'A position like [4, 9], or None.',
    time: instant,
    demo: { forager: 'f = nearest_flower()\nprint("nearest flower:", f)\nmove_to(f)\ncollect()\nprint("now the nearest is:", nearest_flower())', view: MEADOW_VIEW, sight: true },
  },
  flowers_near: {
    section: 'What a bee knows',
    covers: ['nectar_at'],
    details: `Every flower with nectar within ${SENSE_RANGE} tiles (the dotted circle), nearest first, including flowers other bees are on, so a script can choose: the fullest, the one nobody else is heading for, or the patch to tell others about. flowers_near(True) lists empty flowers as well, since they refill: handy for a scout mapping where flowers are. nectar_at(position) says how much nectar a flower in sight has left (0 when it's empty), or None if there's no flower on that tile or it's too far to see. Both are instant.`,
    returns: 'flowers_near(): a list of positions, like [[4, 9], [5, 9]], or [] when none are in sight. nectar_at(): a whole number, or None.',
    time: instant,
    demo: { forager: 'here = flowers_near()\nprint(len(here), "flowers in sight:", here)\nf = here[0]\nprint("nectar at", f, "is", nectar_at(f))\nmove_to(f)\ncollect()\nprint("after one collect:", nectar_at(f))\nprint("out of sight:", nectar_at([18, 9]))', view: MEADOW_VIEW, sight: true },
  },
  flower_here: {
    section: 'What a bee knows',
    details: 'Checks the tile the bee is on. Handy before collect(), or to tell whether a flower has run dry.',
    returns: 'True if the bee is on a flower that has nectar.',
    time: instant,
    demo: { forager: 'print("on a flower?", flower_here())\nmove_to([4, 9])\nprint("on a flower?", flower_here())', view: HIVE_VIEW.map((v, i) => (i === 3 ? 8 : v)) as Demo['view'] },
  },
  get_pos: {
    section: 'What a bee knows',
    details: 'Where the bee is now. Use position[0] for x and position[1] for y.',
    returns: 'The position as [x, y].',
    time: instant,
    demo: { forager: 'print(get_pos())\nmove(East)\nprint(get_pos())\nmove(South)\nprint(get_pos())', view: HIVE_VIEW },
  },
  random_spot: {
    section: 'What a bee knows',
    details: "A bee only sees flowers 6 tiles away, and every season they bloom in new places. When nothing is in sight, a bee has to go looking: random_spot() picks a random open tile on your own map (never a hedge), so move_to(random_spot()) sends it somewhere new. The starting forager.bee does exactly that.",
    returns: 'A position as [x, y].',
    time: instant,
    demo: { forager: 'for i in range(3):\n    spot = random_spot()\n    print("exploring", spot)\n    move_to(spot)', view: [0, 0, 20, 12], length: 600 },
  },
  hive_pos: {
    section: 'What a bee knows',
    details: 'Where the hive is: wherever you placed it before the colony started. It never moves after that, and asking keeps your script working wherever the hive is.',
    returns: 'The position as [x, y].',
    time: instant,
    demo: { forager: 'move_to([7, 9])\nprint("the hive is at", hive_pos())\nmove_to(hive_pos())', view: MEADOW_VIEW },
  },
  blocked: {
    section: 'What a bee knows',
    details: "In multiplayer, hedgerows run along every border between maps and around the edge of the world, and nothing flies through them. Each border has one gate, two tiles wide, placed differently in every world. You rarely need to think about it: move_to() finds the gate by itself, and distance() counts the way around. blocked(position) tells you if a tile is hedge (or off the world), and gates() lists the gate tiles on your map's borders, nearest first, which is handy for posting wasps at the ways in. Single player has no hedges. This clip is a corner of a multiplayer world: the bee leaves its map through the gate.",
    returns: 'blocked(): True or False. gates(): a list of positions, like [[20, 4], [20, 5]].',
    time: instant,
    covers: ['gates'],
    demo: {
      forager: 'print("gates:", gates())\nprint("hedge at [0, 6]?", blocked([0, 6]), "| at [5, 6]?", blocked([5, 6]))\ng = gates()[0]\nmove_to([24, g[1]])\nprint("now on map", map_at(get_pos()))',
      view: [0, 0, 20, 12], hedges: true, length: 260,
    },
  },
  my_map: {
    section: 'What a bee knows',
    details: 'Single player is one map, 20 tiles across and 12 down, so my_map() is always [0, 0]. In multiplayer the world is a 5 by 5 grid of maps, each with its own flowers, and every position is in one big grid: map [1, 0] starts at [20, 0], map [0, 1] at [0, 12]. Bees fly across map borders like any other tile, so my_map() helps a script stay near home or explore a neighbor on purpose. map_at(position) says which map a position is on. The queen can use both.',
    returns: 'The map as [column, row].',
    time: instant,
    covers: ['map_at'],
    demo: { forager: 'm = my_map()\nprint("our map:", m, "starts at", [m[0] * 20, m[1] * 12])\nprint("[7, 9] is on map", map_at([7, 9]))\nmove_to([7, 9])', view: MEADOW_VIEW },
  },
  at_hive: {
    section: 'What a bee knows',
    details: 'Whether the bee is on the hive tile, where deposit(), eat() and build() work.',
    returns: 'True or False.',
    time: instant,
    demo: { forager: 'print("at the hive?", at_hive())\nmove(East)\nprint("at the hive?", at_hive())\ngo_home()\nprint("at the hive?", at_hive())', view: HIVE_VIEW },
  },
  nectar: {
    section: 'What a bee knows',
    details: 'How much nectar the bee is carrying right now. Together with capacity() it tells you when to head home: "if nectar() >= capacity():".',
    returns: 'A whole number from 0 to capacity().',
    time: instant,
    covers: ['capacity'],
    demo: { forager: 'move_to([5, 9])\nwhile nectar() < capacity():\n    collect()\n    print("nectar", nectar(), "of", capacity())', view: [0, 3, 8, 8] },
  },
  energy: {
    section: 'What a bee knows',
    details: 'Energy left. Every tile flown costs 1 (2 in winter), work costs a little, and even waiting slowly uses some. At 0 the bee starves. Checking energy() before a long trip is the difference between a bee that eats in time and one that never comes back.',
    returns: 'A whole number from 0 to max_energy().',
    time: instant,
    covers: ['max_energy'],
    demo: { forager: 'print("energy", energy(), "of", max_energy())\nfor i in range(3):\n    move(East)\n    move(West)\n    print("energy", energy())\neat()\nprint("after eating:", energy())', view: HIVE_VIEW, energy: 75, honey: 5 },
  },
  age: {
    section: 'What a bee knows',
    details: 'How old the bee is, in ticks. Every bee dies of old age eventually; in winter bees age at half speed. life_left() says how long this one has.',
    returns: 'age(): ticks lived. life_left(): ticks until old age.',
    time: instant,
    covers: ['life_left'],
    demo: { forager: 'while True:\n    print("age", age(), "| old age in", life_left())\n    wait(60)', view: HIVE_VIEW, length: 400 },
  },

  // ---- scent ----
  mark: {
    section: 'Scent',
    details: `Leaves a scent on the tile the bee is on, the way real bees mark flowers and the hive entrance. Give it any name you like, such as "food", "empty" or "danger"; a tile can hold several different scents. A fresh mark has strength ${SCENT_MAX} and fades evenly to nothing over ${SCENT_LIFE} ticks, and marking the same tile again makes it fresh. Every bee can smell every mark, so scent is how bees share what they have found. Marks show on the meadow as a colored outline, one color per name; hover a tile to read them.`,
    returns: 'True.',
    time: `${MARK_TICKS} ticks`,
    demo: { forager: 'move_to([3, 4])\nfor i in range(5):\n    mark("trail")\n    move(East)\nprint("left a trail of scent")', view: MEADOW_VIEW },
  },
  smell: {
    section: 'Scent',
    details: `Looks for a scent within ${SMELL_RANGE} tiles: twice as far as a bee can see (${SENSE_RANGE} tiles), so a mark can lead bees to flowers they can't see yet. If several tiles carry it, the strongest one wins, which is usually the freshest; between equally strong tiles, the closer one wins. Like nearest_flower(), it returns None when there is nothing to find, so "if smell("danger"):" works as a check.`,
    returns: 'A position like [4, 9], or None.',
    time: instant,
    demo: { forager: 'move_to([13, 6])\nmark("food")\ngo_home()\nprint("in sight?", nearest_flower() == [13, 6])\nprint("I smell food at", smell("food"))\nmove_to(smell("food"))\ncollect()', view: [0, 2, 15, 9] },
  },
  smell_here: {
    section: 'Scent',
    details: `How strong a scent is on the bee's own tile: ${SCENT_MAX} right after marking, then lower as it fades, and 0 if it's not there. Useful for skipping tiles that are already marked, or for noticing that a mark is nearly gone and needs refreshing.`,
    returns: `A number from 0 to ${SCENT_MAX}.`,
    time: instant,
    demo: { forager: 'move(East)\nmark("home")\nprint("fresh:", smell_here("home"))\nwait(300)\nprint("300 ticks later:", smell_here("home"))\nmove(East)\nprint("one tile over:", smell_here("home"))', view: HIVE_VIEW },
  },

  // ---- the queen ----
  lay: {
    section: 'The queen',
    details: `Only the queen can lay, from queen.bee. An egg costs ${BEE_COST} honey and needs a free cell of comb; a wasp egg costs ${WASP_COST} and needs no comb, since wasps live in the colony's nest. It hatches after ${HATCH_TICKS} ticks into a bee of the role you name, like lay("builder"), which runs that role's script for life; lay() with no name lays a forager, and lay("wasp") a wasp (only once the colony has built its wasp nest; see build_nest). Naming a role that doesn't exist stops the game with an error, so typos show up right away. Laying too eagerly is the classic way to starve a colony before winter.`,
    returns: 'True if she laid an egg; False without enough honey or free comb.',
    time: `${LAY_TICKS} ticks`,
    demo: {
      queen: 'laid = lay()\nprint("laid an egg:", laid, "| eggs:", egg_count())\nwait(320)\nprint("hatched! bees:", bee_count())',
      view: HIVE_VIEW, follow: 'queen', honey: 20, length: 420,
    },
  },

  // ---- roles ----
  role_count: {
    section: 'Roles',
    details: 'Besides forager, you can make up to five roles of your own with the "+ Role" button above the editor. Each role is its own script tab, and every bee the queen lays with lay("that name") runs it for life. role_count() tells you how many living bees have a role, so the queen can keep the mix she wants. Eggs only count once they hatch, so a queen that lays whenever role_count() is low lays again and again while the first egg waits its 300 ticks: check egg_count() too; roles() lists every role\'s name, forager first.',
    returns: 'role_count(): a whole number. roles(): a list of names, like ["forager", "builder"].',
    time: instant,
    covers: ['roles'],
    demo: {
      queen: 'print("roles:", roles())\nprint("builders:", role_count("builder"))\nlay("builder")\nwait(320)\nprint("builders:", role_count("builder"))',
      roles: { builder: 'while True:\n    wait(100)' },
      view: HIVE_VIEW, follow: 'queen', honey: 20, length: 420,
    },
  },
  role: {
    section: 'Roles',
    details: 'The name of the role this bee hatched as. A role never changes. Each role has its own script already, so role() is most useful in shared.bee: functions there run for every role, and the queen too (her role() is "queen"), and can check role() to act differently for each one.',
    returns: 'Text, like "forager" or "builder".',
    time: instant,
    demo: { forager: 'print("my role is", role())\nprint("every role:", roles())', roles: { builder: 'while True:\n    wait(100)' }, view: HIVE_VIEW, length: 120 },
  },

  // ---- raids and wasps ----
  health: {
    section: 'Raids and wasps',
    details: `A bee has ${BEE_HEALTH} health and a wasp ${WASP_HEALTH}. A wasp's sting takes ${STING_DAMAGE} and a bee's ${BEE_STING_DAMAGE}, and at 0 the bee dies ("stung"). Stings come from other players' wasps and bees, and from wild wasps around their nests (in multiplayer). eat() at the hive heals as well as refilling energy: ${HEALTH_PER_HONEY} health per honey, and a hurt bee eats until it's whole. This bee starts hurt.`,
    returns: 'Whole numbers.',
    time: instant,
    covers: ['max_health'],
    demo: { forager: 'print("health:", health(), "of", max_health())\ngo_home()\nprint("ate", eat(), "honey")\nprint("health:", health())', view: [0, 3, 8, 7], health: 4, honey: 10 },
  },
  enemies_near: {
    section: 'Raids and wasps',
    details: `Where the enemies are: other colonies' bees and wasps, and wild wasps, within ${SENSE_RANGE} tiles, nearest first. Protected new colonies aren't counted, since they can't be fought. In single player, now and then a lone wild wasp visits for a season: it hunts bees out in the open (never in the hive), flies off after ${VISITOR_KILLS} kills, and gives up sooner if it catches nobody, so hiding, or three bee stings, beats it. Wild wasps keep a nest on some unclaimed maps in multiplayer, and sting anyone's bees on that map (never inside a hive, and never a protected colony's). This clip hangs a nest nearby: the bee peeks, sees them, and flees home.`,
    returns: 'A list of positions, like [[9, 4], [10, 4]]; empty when no one is in sight.',
    time: instant,
    demo: { forager: 'print("near the hive:", enemies_near())\nmove_to([5, 4])\nprint("closer:", enemies_near())\ngo_home()', view: [0, 0, 13, 9], nest: [11, 3], nestWasps: 2, honey: 10, length: 260 },
  },
  owner_at: {
    section: 'Raids and wasps',
    details: 'Who a tile belongs to: the player whose hive, or bee or wasp, is on it, "wild" for a wild nest or wasp, or None for open meadow. In single player your own colony is "you". Every script can ask, the queen included.',
    returns: 'Text, or None.',
    time: instant,
    demo: { forager: 'print("our hive:", owner_at(hive_pos()))\nprint("[12, 6]:", owner_at([12, 6]))\nprint("[7, 7]:", owner_at([7, 7]))', view: [0, 3, 15, 7], rival: { x: 12, y: 6, honey: 5 }, length: 120 },
  },
  steal: {
    section: 'Raids and wasps',
    details: `At another colony's hive, steal() takes as much of its honey as the bee can carry (${BEE_CAPACITY} for a bee, ${WASP_CAPACITY} for a wasp) and holds it like nectar, so deposit() banks it at home. Nothing stops a raid automatically: the owner's defense is their code, usually wasps guarding the hive. Both colonies' logs record the raid. Anywhere else, or at a protected new colony's hive, it takes nothing.`,
    returns: 'How much honey it took.',
    time: `${STEAL_TICKS} ticks`,
    demo: { forager: 'move_to([12, 6])\nprint("stole", steal(), "honey")\ngo_home()\nprint("banked", deposit())', view: [0, 3, 15, 7], rival: { x: 12, y: 6, honey: 5 } },
  },
  sting: {
    section: 'Raids and wasps',
    details: `Wasps are the colony's fighters. Once the colony has a wasp nest (build_nest), the queen lays them with lay("wasp") for ${WASP_COST} honey each, and every wasp runs wasp.bee. A wasp has ${WASP_HEALTH} health, can carry ${WASP_CAPACITY} honey off in a raid, and can't collect nectar or build. sting(position) hits one enemy on the tile right next to it (wasps first) for ${STING_DAMAGE} damage, or a wild nest there: a nest has ${NEST_HEALTH} health, and a destroyed one hangs again somewhere next spring. Players' wasp nests can be stung down the same way. Worker bees can sting too, but only once: a bee's sting does ${BEE_STING_DAMAGE} damage, enough to kill another bee, and the bee dies when it lands, leaving a "danger" scent your colony can smell(). A missed sting (the target flew off) costs nothing, and bees can't sting nests. This wasp attacks an empty wild nest.`,
    returns: 'True if it hit something.',
    time: `${STING_TICKS} ticks`,
    demo: { wasp: 'move_to([8, 6])\nhits = 0\nwhile sting([9, 6]):\n    hits = hits + 1\n    print("hit the nest", hits, "times")', view: [0, 3, 12, 7], follow: 'wasp', wasps: 1, nest: [9, 6], nestWasps: 0, length: 300 },
  },
  shielded: {
    section: 'Raids and wasps',
    details: "In multiplayer, a new colony is protected for its first 24 hours, in real time: other players can't raid its hive or sting its bees, wasps or nest, and wild wasps leave its bees alone. Its hive shimmers with a golden ring. The protection ends early the moment the colony attacks another player itself (steals from them or stings them); fighting wild wasps and nests is fine. shielded(position) tells your scripts whether the hive, nest or unit on a tile is protected, so raiders don't waste trips. This clip's rival is protected, so the raid comes back empty.",
    returns: 'True or False.',
    time: instant,
    demo: { forager: 'print("is [12, 6] protected?", shielded([12, 6]))\nmove_to([12, 6])\nprint("stole", steal(), "honey")\ngo_home()', view: [0, 3, 15, 7], rival: { x: 12, y: 6, honey: 5, shielded: true } },
  },
  build_nest: {
    section: 'Raids and wasps',
    details: `Wasps don't come cheap. First the colony saves up ${NEST_COST} honey, and the queen builds its wasp nest with build_nest(position) on any free tile of your own map (not the hive or a flower); it takes her ${NEST_BUILD_TICKS} ticks. From then on lay("wasp") raises wasps, ${WASP_COST} honey each, and they hatch at the nest. Every wasp runs the editor's wasp.bee tab. Wasps live in the nest, so they need no comb. A colony has one nest. It has ${NEST_HEALTH} health, and enemy wasps can sting it down; then the queen can't lay wasps until you build another, though wasps already hatched live on. nest_pos() says where it is, or None. Wasps grow old and die like bees, so keeping two on guard means laying about five a year: around 150 honey, plus their food. In single player nothing ever attacks your colony, so a nest only pays off in multiplayer.`,
    returns: 'build_nest(): True if she built it; False without the honey, with a nest already, or on a taken tile. nest_pos(): [x, y] or None.',
    time: `${NEST_BUILD_TICKS} ticks`,
    covers: ['nest_pos'],
    demo: {
      queen: 'print("nest:", nest_pos(), "| lay a wasp?", lay("wasp"))\nprint("built:", build_nest([6, 5]))\nprint("nest:", nest_pos())\nlay("wasp")\nwait(320)\nprint("wasps:", role_count("wasp"))',
      view: [0, 2, 9, 7], follow: 'queen', honey: 190, length: 560,
    },
  },

  // ---- the colony ----
  honey: {
    section: 'The colony',
    details: 'Honey stored in the hive. Both the queen and the workers can read it, so the queen can save for winter and workers can decide when to build.',
    returns: 'A whole number.',
    time: instant,
    demo: { forager: 'print("honey in the hive:", honey())\nmove_to([5, 9])\nwhile collect():\n    pass\ngo_home()\ndeposit()\nprint("honey in the hive:", honey())', view: [0, 3, 8, 8], honey: 5 },
  },
  bee_count: {
    section: 'The colony',
    details: 'How many workers are alive and how many eggs are waiting. A queen script uses these to decide how big a colony she can afford.',
    returns: 'Whole numbers.',
    time: instant,
    covers: ['egg_count'],
    demo: {
      queen: 'print("bees:", bee_count(), "| eggs:", egg_count())\nlay()\nlay()\nprint("bees:", bee_count(), "| eggs:", egg_count())\nwait(300)\nprint("bees:", bee_count(), "| eggs:", egg_count())',
      view: HIVE_VIEW, follow: 'queen', honey: 30, length: 420,
    },
  },
  comb: {
    section: 'The colony',
    details: 'Comb is the hive\'s space. comb() is the total number of cells; space() is how many are free. Every bee and every egg uses one, so when space() is 0 the queen cannot lay until workers build() more. Wasps are the exception: they live in the colony\'s wasp nest, so they take no comb.',
    returns: 'Whole numbers.',
    time: instant,
    covers: ['space'],
    demo: {
      queen: 'while space() > 0:\n    lay()\n    print("comb:", comb(), "| free:", space())\nprint("the comb is full")',
      view: HIVE_VIEW, follow: 'queen', honey: 100, comb: 4, length: 260,
    },
  },

  // ---- time and seasons ----
  season: {
    section: 'Time and seasons',
    details: `The year has four seasons of ${SEASON_TICKS} ticks each, and each grows its own flowers in new places: a few patches of clover around the hive in spring, lavender across the meadow in summer, and a few rich patches of goldenrod far from the hive in autumn. Many patches grow beyond a bee's ${SENSE_RANGE}-tile sight from the hive, so finding them (and sharing finds with scent) matters. Flowers regrow fastest in summer and slowest in autumn. In winter nothing blooms, flying costs double and keeping warm burns energy: about ${Math.round((SEASON_TICKS * WINTER_IDLE) / ENERGY_PER_HONEY)} honey per resting bee over a winter. Because the flowers move, a list of flower positions is only good for one season. This clip starts just before winter.`,
    returns: 'season(): "spring", "summer", "autumn" or "winter". season_left(): ticks until it changes.',
    time: instant,
    covers: ['season_left'],
    demo: { forager: 'while True:\n    print(season(), "| changes in", season_left(), "ticks")\n    wait(30)', view: MEADOW_VIEW, tick: SEASON_TICKS * 3 - 100, length: 260 },
  },
  year: {
    section: 'Time and seasons',
    details: 'Which year the colony is in, starting at 1. A new year starts each spring. This clip starts at the very end of winter.',
    returns: 'A whole number.',
    time: instant,
    demo: { forager: 'while True:\n    print("year", year(), season())\n    wait(30)', view: MEADOW_VIEW, tick: SEASON_TICKS * 4 - 90, length: 240 },
  },
  wait: {
    section: 'Time and seasons',
    details: 'Does nothing for a while. Useful when there is nothing to do (in winter, or a queen with no honey), so the script does not spin. Waiting still uses a little energy.',
    returns: 'None.',
    time: 'As many ticks as you ask for',
    demo: { forager: 'move(East)\nprint("waiting...")\nwait(45)\nmove(West)\nprint("waiting...")\nwait(45)', view: HIVE_VIEW },
  },

  // ---- utilities ----
  random: {
    section: 'Utilities',
    details: 'Picks a number by chance. Each run of the game with the same scripts plays out the same way, so "random" choices are repeatable, which makes bugs easier to track down.',
    returns: 'A whole number from 0 to n - 1.',
    time: instant,
    demo: { forager: 'while True:\n    d = [North, South, East, West][random(4)]\n    move(d)', view: MEADOW_VIEW, length: 300 },
  },
  print: {
    section: 'Utilities',
    details: 'Writes to the Log panel in the game, tagged with which bee (or the queen) printed it. Separate several values with commas. The quickest way to see what your script is thinking.',
    returns: 'None.',
    time: instant,
    demo: { forager: 'print("hello from bee", 1)\nprint("I am at", get_pos(), "carrying", nectar())', view: HIVE_VIEW, length: 120 },
  },

  distance: {
    section: 'Utilities',
    details: 'Counts the tiles a bee flies between two positions: how far across plus how far up or down, since bees fly along the grid. In multiplayer, where hedgerows stand between maps, it counts the way a bee really goes, around the hedge and through its gate. Each tile costs energy, so it helps decide whether a far flower is worth the trip, or whether a scent is too far off.',
    returns: 'A whole number of tiles.',
    time: instant,
    example: 'home = [2, 6]\nflower = [9, 3]\nprint("tiles to fly:", distance(home, flower))\nprint("there and back:", 2 * distance(home, flower))',
  },

  // ---- language helpers: shown with their output instead of a clip ----
  range: {
    section: 'Language helpers',
    details: 'Makes a list of numbers for "for" loops. range(3) is [0, 1, 2]; range(start, stop, step) counts from start up to (not including) stop.',
    returns: 'A list of numbers.',
    time: instant,
    example: 'for i in range(3):\n    print("lap", i)\nprint(range(2, 10, 3))',
  },
  len: {
    section: 'Language helpers',
    details: 'Counts the items in a list, or the letters in text.',
    returns: 'A whole number.',
    time: instant,
    example: 'spots = [[4, 9], [5, 9], [5, 10]]\nprint(len(spots))\nprint(len("hive"))',
  },
  abs: {
    section: 'Language helpers',
    details: 'Drops the minus sign. Useful for distances between tiles.',
    returns: 'A number that is zero or more.',
    time: instant,
    example: 'a = [2, 6]\nb = [5, 9]\nprint("tiles apart:", abs(a[0] - b[0]) + abs(a[1] - b[1]))',
  },
  min: {
    section: 'Language helpers',
    details: 'The smallest or largest of some numbers, or of a list.',
    returns: 'A number.',
    time: instant,
    covers: ['max'],
    example: 'print(min(4, 2, 7))\nprint(max([3, 9, 1]))',
  },
  str: {
    section: 'Language helpers',
    details: 'Turns a value into text, so it can be joined with + to other text.',
    returns: 'Text.',
    time: instant,
    example: 'print("honey: " + str(42))',
  },
  int: {
    section: 'Language helpers',
    details: 'Turns a number (dropping anything after the point) or a piece of text into a whole number.',
    returns: 'A whole number.',
    time: instant,
    example: 'print(int(7 / 2))\nprint(int("12") + 1)',
  },
};
