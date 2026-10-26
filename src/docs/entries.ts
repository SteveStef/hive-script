import {
  BEE_COST, BUILD_COST, BUILD_TICKS, COLLECT_TICKS, DEPOSIT_TICKS, EAT_TICKS, ENERGY_PER_HONEY, HATCH_TICKS, LAY_TICKS,
  MARK_TICKS, MOVE_TICKS, NECTAR_MAX, SCENT_LIFE, SCENT_MAX, SEASON_TICKS, SENSE_RANGE,
} from '../sim/world';

/** A small scene the docs page plays on loop: real game, real scripts. */
export interface Demo {
  forager?: string; // what the demo bee runs; an idle bee if left out
  queen?: string; // what the queen runs; an idle queen if left out
  view: [number, number, number, number]; // part of the meadow to show, in tiles: x, y, width, height
  follow?: 'bee' | 'queen'; // whose line is highlighted and whose prints are shown (default: the bee)
  bees?: number;
  honey?: number;
  tick?: number;
  energy?: number;
  comb?: number;
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

export const SECTIONS = ['Moving', 'Working', 'What a bee knows', 'Scent', 'The queen', 'The colony', 'Time and seasons', 'Utilities', 'Language helpers'];

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
    details: `Takes one nectar from the flower the bee is on. A flower holds up to ${NECTAR_MAX} nectar and regrows over time: quickly in summer, slowly in autumn, not at all in winter. Flowers close up when they are empty. collect() fails if the bee is not on a flower, the flower is empty, or the bee is already full (see capacity()).`,
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

  // ---- what a bee knows ----
  nearest_flower: {
    section: 'What a bee knows',
    details: `Looks for flowers that still have nectar within ${SENSE_RANGE} tiles (the dotted circle in the clip), skipping any flower another bee is already on, so bees spread out instead of queuing. If none are in sight it returns None, which counts as False in an if, so "if f:" checks whether anything was found. The flower the bee is standing on counts too.`,
    returns: 'A position like [4, 9], or None.',
    time: instant,
    demo: { forager: 'f = nearest_flower()\nprint("nearest flower:", f)\nmove_to(f)\ncollect()\nprint("now the nearest is:", nearest_flower())', view: MEADOW_VIEW, sight: true },
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
  hive_pos: {
    section: 'What a bee knows',
    details: 'Where the hive is. It never moves, but asking is clearer than writing [2, 6] into your script.',
    returns: 'The position as [x, y].',
    time: instant,
    demo: { forager: 'move_to([7, 9])\nprint("the hive is at", hive_pos())\nmove_to(hive_pos())', view: MEADOW_VIEW },
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
    details: `Looks for a scent within ${SENSE_RANGE} tiles (the dotted circle in the clip), the same distance a bee can see flowers from. If several tiles carry it, the strongest one wins, which is usually the freshest; between equally strong tiles, the closer one wins. Like nearest_flower(), it returns None when there is nothing to find, so "if smell("danger"):" works as a check.`,
    returns: 'A position like [4, 9], or None.',
    time: instant,
    demo: { forager: 'f = nearest_flower()\nmove_to(f)\nmark("food")\ngo_home()\nprint("I smell food at", smell("food"))\nmove_to(smell("food"))\ncollect()', view: MEADOW_VIEW, sight: true },
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
    details: `Only the queen can lay, from queen.bee. An egg costs ${BEE_COST} honey and needs a free cell of comb. It hatches after ${HATCH_TICKS} ticks into a worker that runs forager.bee. Laying too eagerly is the classic way to starve a colony before winter.`,
    returns: 'True if she laid an egg; False without enough honey or free comb.',
    time: `${LAY_TICKS} ticks`,
    demo: {
      queen: 'laid = lay()\nprint("laid an egg:", laid, "| eggs:", egg_count())\nwait(320)\nprint("hatched! bees:", bee_count())',
      view: HIVE_VIEW, follow: 'queen', honey: 20, length: 420,
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
    details: 'Comb is the hive\'s space. comb() is the total number of cells; space() is how many are free. Every bee and every egg uses one, so when space() is 0 the queen cannot lay until workers build() more.',
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
    details: `The year has four seasons of ${SEASON_TICKS} ticks each. Flowers bloom in spring, regrow fastest in summer, slowly in autumn, and vanish in winter, when flying costs double and keeping warm burns energy. This clip starts just before winter.`,
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
