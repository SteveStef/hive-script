import {
  BEE_COST, BUILD_COST, BUILD_TICKS, COLLECT_TICKS, DEPOSIT_TICKS, EAT_TICKS, ENERGY_PER_HONEY, ENERGY_PER_TILE,
  HATCH_TICKS, LAY_TICKS, MARK_TICKS, MAX_ENERGY, MAX_WAIT, MOVE_TICKS, SCENT_LIFE, SCENT_MAX, SEASON_TICKS, SENSE_RANGE, SMELL_RANGE,
  HEALTH_PER_HONEY, NEST_BUILD_TICKS, NEST_COST, STEAL_TICKS, BEE_STING_DAMAGE, STING_DAMAGE, STING_TICKS, WASP_COST,
} from './world';

export interface ApiDoc {
  name: string;
  signature: string;
  doc: string;
  /** Snippet inserted by autocomplete; ${1:...} marks a placeholder. */
  insert: string;
  constant?: boolean;
  /** Which scripts can use it: worker roles and wasps (and shared.bee), wasps only, or the queen; all of them when left out. */
  only?: 'worker' | 'wasp' | 'queen';
}

// Shown in editor autocomplete and hover. Keep in step with api.ts and builtins.ts.
export const API_DOCS: ApiDoc[] = [
  // worker actions
  { name: 'move', signature: 'move(direction)', insert: 'move(${1:North})', only: 'worker',
    doc: `Fly one tile North, South, East or West (${MOVE_TICKS} ticks). Returns False if the edge of the meadow or another bee is in the way.` },
  { name: 'move_to', signature: 'move_to(position)', insert: 'move_to(${1:position})', only: 'worker',
    doc: `Fly to a tile like [5, 3], one tile at a time (${MOVE_TICKS} ticks per tile), steering around other bees and through hedge gates. Returns False if it couldn't get there.` },
  { name: 'go_home', signature: 'go_home()', insert: 'go_home()', only: 'worker', doc: 'Fly back to the hive.' },
  { name: 'collect', signature: 'collect()', insert: 'collect()', only: 'worker',
    doc: `Collect one nectar from the flower you are on (${COLLECT_TICKS} ticks). Returns True if it worked.` },
  { name: 'deposit', signature: 'deposit()', insert: 'deposit()', only: 'worker',
    doc: `At the hive, turn all carried nectar into honey (${DEPOSIT_TICKS} ticks). Returns how much.` },
  { name: 'eat', signature: 'eat()', insert: 'eat()', only: 'worker',
    doc: `At the hive, eat honey to refill energy (${EAT_TICKS} ticks). 1 honey gives ${ENERGY_PER_HONEY} energy; you only eat whole honey you have room for. Returns how much honey you ate.` },
  { name: 'build', signature: 'build()', insert: 'build()', only: 'worker',
    doc: `At the hive, turn ${BUILD_COST} honey into wax for one more cell of comb (${BUILD_TICKS} ticks). Every bee and egg needs a cell. Returns True if it worked.` },

  { name: 'die', signature: 'die()', insert: 'die()', only: 'worker',
    doc: "End this bee's life right away. It stops eating the colony's honey and frees its cell of comb. Any nectar it carries is lost." },

  // worker senses
  { name: 'role', signature: 'role()', insert: 'role()',
    doc: 'Your role\'s name, like "forager" or "builder", or "queen" for the queen. It never changes. Handy in shared.bee functions that act differently per role.' },
  { name: 'nearest_flower', signature: 'nearest_flower()', insert: 'nearest_flower()', only: 'worker',
    doc: `Position of the closest flower with nectar and no other bee on it, within ${SENSE_RANGE} tiles, or None if you can't see one.` },
  { name: 'flowers_near', signature: 'flowers_near() or flowers_near(True)', insert: 'flowers_near()', only: 'worker',
    doc: `Positions of every flower with nectar within ${SENSE_RANGE} tiles, nearest first, even ones another bee is on. flowers_near(True) includes empty flowers too (they refill). An empty list if you can't see any.` },
  { name: 'nectar_at', signature: 'nectar_at(position)', insert: 'nectar_at(${1:position})', only: 'worker',
    doc: `Nectar left in the flower on a tile within ${SENSE_RANGE} tiles (0 if it's empty), or None if there's no flower there or it's out of sight.` },
  { name: 'flower_here', signature: 'flower_here()', insert: 'flower_here()', only: 'worker', doc: 'True if you are on a flower that has nectar.' },
  { name: 'get_pos', signature: 'get_pos()', insert: 'get_pos()', doc: 'Your position as [x, y]. [0, 0] is the top-left tile. The queen is always at the hive.' },
  { name: 'hive_pos', signature: 'hive_pos()', insert: 'hive_pos()', doc: "The hive's position as [x, y], wherever you placed it." },
  { name: 'random_spot', signature: 'random_spot()', insert: 'random_spot()', only: 'worker',
    doc: 'A random open tile on your own map, as [x, y]: somewhere new to explore when nothing is in sight.' },
  { name: 'nectar', signature: 'nectar()', insert: 'nectar()', only: 'worker', doc: 'How much nectar you are carrying.' },
  { name: 'capacity', signature: 'capacity()', insert: 'capacity()', only: 'worker', doc: 'How much nectar you can carry at once.' },
  { name: 'at_hive', signature: 'at_hive()', insert: 'at_hive()', doc: 'True if you are at the hive (always, for the queen).' },
  { name: 'energy', signature: 'energy()', insert: 'energy()', only: 'worker',
    doc: `Energy left, 0 to ${MAX_ENERGY}. Flying costs ${ENERGY_PER_TILE} per tile (double in winter) and working costs a little. At 0 you starve.` },
  { name: 'max_energy', signature: 'max_energy()', insert: 'max_energy()', only: 'worker', doc: `The most energy a bee can hold (${MAX_ENERGY}).` },
  { name: 'age', signature: 'age()', insert: 'age()', only: 'worker', doc: 'How many ticks you have been alive.' },
  { name: 'life_left', signature: 'life_left()', insert: 'life_left()', only: 'worker', doc: 'Ticks until you die of old age.' },

  // scent
  { name: 'mark', signature: 'mark(name)', insert: 'mark("${1:food}")', only: 'worker',
    doc: `Leave a scent called name, like "food" or "danger", on the tile you are on (${MARK_TICKS} ticks). It fades away over ${SCENT_LIFE} ticks; marking again makes it fresh.` },
  { name: 'smell', signature: 'smell(name)', insert: 'smell("${1:food}")', only: 'worker',
    doc: `Position of the tile within ${SMELL_RANGE} tiles where that scent is strongest, or None if you can't smell it. Scent carries twice as far as a bee can see.` },
  { name: 'smell_here', signature: 'smell_here(name)', insert: 'smell_here("${1:food}")', only: 'worker',
    doc: `How strong that scent is on your tile: ${SCENT_MAX} when just marked, fading to 0.` },

  // the queen
  { name: 'lay', signature: 'lay() or lay(role)', insert: 'lay()', only: 'queen',
    doc: `Lay an egg (${LAY_TICKS} ticks). Costs ${BEE_COST} honey and needs a free cell of comb (a wasp egg needs the nest instead). It hatches after ${HATCH_TICKS} ticks into a bee of that role, like lay("builder"), or a forager if you name none. lay("wasp") costs ${WASP_COST} and needs the colony's wasp nest (build_nest). Returns True if she laid.` },

  // the colony, for everyone
  { name: 'roles', signature: 'roles()', insert: 'roles()', doc: 'Every role\'s name, forager first, like ["forager", "builder"].' },
  { name: 'role_count', signature: 'role_count(role)', insert: 'role_count("${1:forager}")', doc: "How many living bees have that role. Eggs don't count until they hatch: egg_count() counts those." },
  { name: 'honey', signature: 'honey()', insert: 'honey()', doc: 'Honey stored in the hive.' },
  { name: 'bee_count', signature: 'bee_count()', insert: 'bee_count()', doc: 'How many worker bees are alive.' },
  { name: 'egg_count', signature: 'egg_count()', insert: 'egg_count()', doc: 'How many eggs are waiting to hatch.' },
  { name: 'comb', signature: 'comb()', insert: 'comb()', doc: 'Cells of comb in the hive. Every bee and egg needs one (wasps live in the nest).' },
  { name: 'space', signature: 'space()', insert: 'space()', doc: 'Free cells of comb: how many more eggs there is room for.' },
  { name: 'season', signature: 'season()', insert: 'season()',
    doc: `"spring", "summer", "autumn" or "winter". Each season lasts ${SEASON_TICKS} ticks and grows its own flowers in new places: clover, lavender, then goldenrod. Nothing blooms in winter.` },
  { name: 'season_left', signature: 'season_left()', insert: 'season_left()', doc: 'Ticks until the season changes.' },
  { name: 'year', signature: 'year()', insert: 'year()', doc: 'Which year it is, starting at 1.' },
  { name: 'wait', signature: 'wait(ticks)', insert: 'wait(${1:30})', doc: `Do nothing for a number of ticks (1 to ${MAX_WAIT}).` },
  { name: 'random', signature: 'random(n)', insert: 'random(${1:4})', doc: 'A random whole number from 0 to n - 1.' },
  { name: 'print', signature: 'print(value, ...)', insert: 'print(${1})', doc: 'Write to the log, tagged with who printed it.' },
  { name: 'range', signature: 'range(stop) or range(start, stop, step)', insert: 'range(${1:5})', doc: 'A list of numbers, for loops.' },
  { name: 'len', signature: 'len(list)', insert: 'len(${1})', doc: 'How many items are in a list or text.' },
  { name: 'abs', signature: 'abs(number)', insert: 'abs(${1})', doc: 'The number without its sign.' },
  { name: 'min', signature: 'min(a, b, ...)', insert: 'min(${1})', doc: 'The smallest number.' },
  { name: 'max', signature: 'max(a, b, ...)', insert: 'max(${1})', doc: 'The largest number.' },
  { name: 'str', signature: 'str(value)', insert: 'str(${1})', doc: 'The value as text.' },
  { name: 'distance', signature: 'distance(a, b)', insert: 'distance(${1:get_pos()}, ${2:hive_pos()})',
    doc: 'How many tiles a bee flies between two positions: across plus up or down, or the way around hedges through a gate. Flying costs energy per tile.' },
  { name: 'blocked', signature: 'blocked(position)', insert: 'blocked(${1:position})',
    doc: 'True if nothing can fly into a tile: a hedgerow, or off the edge of the world.' },
  { name: 'gates', signature: 'gates()', insert: 'gates()',
    doc: "The gaps in the hedges around your colony's map, nearest first, as a list of positions. Each gate is two tiles wide." },
  { name: 'health', signature: 'health()', insert: 'health()', only: 'worker',
    doc: `This bee's or wasp's health. A wasp's sting takes ${STING_DAMAGE}, a bee's ${BEE_STING_DAMAGE}; at 0 it dies. eat() at the hive heals ${HEALTH_PER_HONEY} per honey.` },
  { name: 'max_health', signature: 'max_health()', insert: 'max_health()', only: 'worker', doc: 'Full health: 10 for a bee, 30 for a wasp.' },
  { name: 'enemies_near', signature: 'enemies_near()', insert: 'enemies_near()', only: 'worker',
    doc: `Positions of other colonies' bees and wasps, and wild wasps, within sight (${SENSE_RANGE} tiles), nearest first; protected new colonies don't count. An empty list when there are none.` },
  { name: 'owner_at', signature: 'owner_at(position)', insert: 'owner_at(${1:position})',
    doc: 'Whose hive, nest or unit is on a tile: a player\'s name ("you" for your own in single player), "wild" for wild wasps, or None.' },
  { name: 'steal', signature: 'steal()', insert: 'steal()', only: 'worker',
    doc: `At another colony's hive, take as much of its honey as you can carry (${STEAL_TICKS} ticks); deposit() it at home. Returns how much (0 anywhere else).` },
  { name: 'sting', signature: 'sting(position)', insert: 'sting(${1:position})', only: 'worker',
    doc: `Sting an enemy on the tile right next to you (${STING_TICKS} ticks). A wasp does ${STING_DAMAGE} damage and can sting again, and can sting an enemy's nest. A bee's sting does ${BEE_STING_DAMAGE} damage and is its last act: if it hits, the bee dies and leaves a "danger" scent. Bees can't sting nests. Returns True if it hit.` },
  { name: 'shielded', signature: 'shielded(position)', insert: 'shielded(${1:position})',
    doc: "True if the hive, nest or unit on a tile belongs to a protected new colony: for its first 24 hours, it can't be raided or stung, and attacking anyone ends its protection." },
  { name: 'build_nest', signature: 'build_nest(position)', insert: 'build_nest(${1:position})', only: 'queen',
    doc: `Build the colony's wasp nest on a free tile of your own map, for ${NEST_COST} honey (${NEST_BUILD_TICKS} ticks). Then lay("wasp") raises wasps, which hatch there. One nest per colony; returns False if it couldn't.` },
  { name: 'nest_pos', signature: 'nest_pos()', insert: 'nest_pos()', doc: "Your colony's wasp nest as [x, y], or None if it has none." },
  { name: 'my_map', signature: 'my_map()', insert: 'my_map()',
    doc: "Which map the colony's hive is on, as [column, row]. A map is 20 tiles across and 12 down; single player is the one map [0, 0]." },
  { name: 'map_at', signature: 'map_at(position)', insert: 'map_at(${1:get_pos()})',
    doc: 'Which map a position is on, as [column, row]. In multiplayer, maps sit side by side in one big grid of positions.' },
  { name: 'int', signature: 'int(value)', insert: 'int(${1})', doc: 'The value as a whole number.' },
  { name: 'North', signature: 'North', insert: 'North', doc: 'Up the screen.', constant: true, only: 'worker' },
  { name: 'South', signature: 'South', insert: 'South', doc: 'Down the screen.', constant: true, only: 'worker' },
  { name: 'East', signature: 'East', insert: 'East', doc: 'Right.', constant: true, only: 'worker' },
  { name: 'West', signature: 'West', insert: 'West', doc: 'Left.', constant: true, only: 'worker' },
];
