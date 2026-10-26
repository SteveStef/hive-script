# Hive Script

A 2D pixel colony game where you never steer a bee. You write a script, and every bee
in the hive runs its own copy of it.

## Running it

```sh
npm install
npm run dev        # open the printed localhost URL
npm test           # language and simulation tests
npm run build      # typecheck + production build into dist/
npm run balance    # simulate the default scripts for two years and print each season
```

A colony runs two scripts, each in its own editor tab:

- **forager.bee**: every worker bee runs its own copy.
- **queen.bee**: the queen stays in the hive and decides when to lay eggs.

Press **Run** (or Ctrl+Enter). Click a bee, the hive, or a name in the bee list to follow it:
its card shows its stats and variables, and the editor highlights the line it is running.
Hover the meadow to see tile positions. 1× is 15 ticks per second.
Calm background music starts with Run, with a track for each season; the **Music** button
mutes it (`src/audio/music.ts`).

The **Docs** button opens `docs.html`: every function a script can call, with an
explanation and a looping clip of a bee doing it (the real game running a small example).

## How it fits together

```
src/
  lang/      the bee scripting language (Python-like)
    lexer.ts        text -> tokens, including INDENT/DEDENT
    parser.ts       tokens -> syntax tree, with friendly line-numbered errors
    interpreter.ts  runs a tree; pauses after every statement and on every action
    builtins.ts     print, range, len, min, max, ...
  sim/       the game rules; no drawing here
    world.ts        grid, flowers, hive, bees; advances one tick at a time, seeded
    api.ts          what a script can call: move, collect, nearest_flower, ...
    apiDocs.ts      descriptions used by editor autocomplete and hover
  render/    draws the world onto a 320x192 pixel canvas
  audio/     background music: a CC0 loop per season, cross-faded
  ui/        Monaco editor setup, and the bee and queen stat cards
  docs/      the docs page: entries.ts holds each card's text and example clip
  main.ts    wires the editor, simulation and renderer together
scripts/
  balance.ts    two-year simulation of the default scripts, for tuning
```

Key ideas:

- **Each bee has its own interpreter** (`Runner`) over the same parsed script. The
  interpreter is built from generators, so it can stop mid-script.
- **Actions take game time.** `move()` and `collect()` pause the script until the world
  finishes them, then hand back a result.
- **Each bee gets 50 operations per tick**, so an infinite loop can't freeze the game.
- **One bee per tile** (the hive holds any number). `move()` fails into an occupied tile;
  `move_to()` steers around bees and gives up if blocked too long; `nearest_flower()` skips
  flowers another bee is on.
- **The economy limits the colony, not a fixed number.** Each egg costs 10 honey and every
  bee or egg needs a cell of comb; workers `build()` more comb from 15 honey. Flowers can
  only feed so many bees, and winter eats into stores, so a queen who lays too eagerly
  starves her colony. (A hidden ceiling of 120 bees exists only for performance.)
- **Seasons.** Spring, summer, autumn and winter last 2,700 ticks each. Flowers bloom in
  spring, regrow fastest in summer and vanish in winter. In winter flying costs double,
  resting burns more energy, and bees age at half speed.
- **Bees eat, age and die.** Flying burns energy (1 per tile); `eat()` at the hive turns
  honey into energy (1 honey = 40). A bee starves at 0 energy and dies of old age after
  3,600–5,400 ticks of aging.
- **Scent is how bees share what they know.** `mark("food")` scents the bee's own tile;
  any bee can `smell("food")` the strongest mark within sight, or read its own tile with
  `smell_here()`. Marks fade over 900 ticks and show on the meadow, one color per name.
- **Everything is available from the start.** There are no unlocks; the puzzle is the colony,
  not earning functions.
- **The simulation is deterministic.** The same script and seed always play out the
  same way, which keeps tests, replays and leaderboards possible.

## The scripting language today

`if / elif / else`, `while`, `for x in range(...)`, `break`, `continue`, `def` / `return`,
numbers, text, `True / False / None`, lists and `[x, y]` positions, `and / or / not`, `in / not in`.
Game functions are listed in `src/sim/apiDocs.ts` and appear in editor autocomplete.
When you add one, also give it a card in `src/docs/entries.ts`; `tests/docs.test.ts` fails
until every function has one, and runs every example clip to check it still works.

Positions are `[x, y]` tiles. `[0, 0]` is the top-left; `North` is up the screen.

## Next steps

1. Goals per year (survive the winter, reach 20 bees), so each year is a run
2. The honeycomb view inside the hive, ported from the concept demo
3. More communication: `dance()` inside the hive
4. More roles (builder, nurse, guard) with a script tab each
5. Saving, settings and a Tauri desktop build

## Credits

See [CREDITS.md](CREDITS.md).
