# Hive Script

A 2D pixel colony game where you never steer a bee. You write a script, and every bee
in the hive runs its own copy of it.

## Hosting

The live game is at **https://bee.stevestef.com**, on an OVH VPS (Ubuntu, `ssh ubuntu@40.160.90.18`).
`docker-compose.prod.yml` runs three containers: Postgres, the game server (the `Dockerfile`:
it builds the pages and serves them with the API), and Caddy, the only one reachable from outside.
Cloudflare proxies the domain (SSL mode Full (strict)) and Caddy uses a Cloudflare Origin
certificate, valid until 2041.

- **Deploy:** push to `main`. GitHub Actions (`.github/workflows/deploy.yml`) runs the type check,
  tests and build, and only if they pass logs into the server with a key that can run nothing but
  `scripts/server-deploy.sh`: pull (a read-only deploy key), rebuild, restart, check it answers.
  Worlds are saved on the way down. `npm run deploy` does the same by hand, without a push.
- **Secrets stay on the server:** `~/hive-script/.env.production` (the database password) and
  `~/hive-certs/` (the certificate and its private key).
- **Logs:** `ssh ubuntu@40.160.90.18 'cd ~/hive-script && docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app'`
- **Server safety:** key-only SSH, ufw allowing 22, 80 and 443, automatic security updates.
  There are no database backups yet.

## Running it

The game is a website with accounts: single player runs in the browser, and multiplayer is a
shared world that runs on the game server around the clock. Locally you need Node 20 and Docker.

```sh
npm install
cp .env.example .env   # database URL, server port, game clock
npm run db:up          # Postgres 16 in Docker, on port 5433 (also creates hive_test)
npm run dev            # web client (Vite) + game server; open the printed localhost URL
npm test               # language and simulation tests
npm run test:server    # accounts, scripts and colony tests against hive_test (needs db:up)
npm run build          # typecheck + production build into dist/
npm run balance        # simulate the default scripts for two years and print each season
npm run bench          # time a full 25-colony world, to check ticks stay well under GAME_TICK_MS
```

Sign up, then pick **Single player**, **Multiplayer** or **Tutorial** from the menu. A new
account starts with short scripts (`src/defaultScript.ts`) that gather honey and hatch bees but,
on purpose, let the colony die out within its first year: keeping it alive is the player's job. In
single player, from summer of year 1, about half the seasons with flowers bring a lone wild wasp
(`VISITOR_CHANCE`): it hunts bees in the open, never the hive, and goes after any bee it sees, even resting or
on its way out. It heads off after 4 kills, when it catches nobody for a while, or at the
season's end, and is gone by the next season at the latest. A new
game's colony (single player, or a newly founded multiplayer one) starts with no bees and 10 honey
(`NEW_COLONY`): the queen lays the first bee, of any role, and that first egg hatches at once. The
tutorial is 14 hands-on lessons, from your first bee to wasps and raids: each gives a goal the
game checks as your code runs, with hints and a **Show me** solution. Lessons run their own
starter scripts in small fixed worlds (the multiplayer ones in a two-map practice world on
your computer), never your own scripts; finished lessons get a checkmark on your account. Scripts are saved to
your account (single player and multiplayer keep separate sets).

**Placing the hive:** before a colony starts, click where its hive goes: in single player on
the new meadow before **Run** (it starts at your last spot, or the nearest one that fits), in
multiplayer on the free map you picked. The hive needs its footprint (its tile, the three rows
behind it and the row in front, one tile either side) on that map and clear of flowers and nests;
a gate next to it is fine. Each map still grows its seeded meadow, minus anything under a hive,
and the hive never moves once the colony starts (`World.hiveProblem`, `bloomMap`'s `hives`).

**What the meadow shows:** the hive is a painted box hive that grows a box at 100, 200, 500 and 800
honey (`BOX_HONEY`, up to five), and a brood comb in front of it has a cell per egg: egg, grub, then capped, with a ring and
a rising "+1" when one hatches. Other players' bees and wasps have a red edge, wild wasps are grey
like their paper nests, and a red banner over the meadow names any enemy on your hive, even while
you watch another map (`ColonyView.raiders`). Under the meadow, one strip holds the season, the
colony's numbers and a chip per bee; following a bee opens its card over the meadow. The meadow
sizes itself to the window (`fitGame()`), so nothing scrolls.

**Multiplayer** is a world of 5×5 maps (each the size of single player's meadow) shared by
up to 25 players. The **World map** shows who holds each map; pick a free one, then click a spot on it
for your hive to found your colony there. **Abandon colony**, at the bottom of the world map, ends
yours on purpose (everything in it is gone and the map is free); a colony founded within 24 hours of
your first only gets what was left of that protection, so abandoning can't reset it. Positions are world positions (map `[c, r]` covers x `20c..20c+19`,
y `12r..12r+11`). Hedgerows run along every border and around the world, with one 2-tile gate
per border placed by the world's seed; `move_to()` routes through gates by itself (A* around
hedges, the old L-shaped route when nothing's in the way), `distance()` counts that route,
`blocked(position)` and `gates()` let scripts ask, and worlds saved before hedges stay open. `my_map()` and
`map_at(position)` give map numbers. The arrows and **Home** in the bar over the meadow
switch which map you watch; other players' hives and bees show there, but never their code.
**Deploy** (or Ctrl+Enter) sends every script to your colony, and each bee starts the new
code from the top. The colony keeps running when the page is closed, and the log opens with
what happened while you were away. A colony that dies out frees its map and its player picks
again. When every map is held, newcomers get a new world.

Players can fight. Every bee has health (a wasp has more), and `eat()` at home heals.
A bee at another colony's hive can `steal()` its honey and `deposit()` it at home. Wasps carry
nothing (`WASP_CAPACITY` is 0): they fight, and a raid that takes honey needs bees.
Wasps take saving up for: the queen builds the colony's **wasp nest** with
`build_nest(position)` for 150 honey, and only then lays **wasps** with `lay("wasp")`, which
hatch at the nest and live there: wasps need no comb. Enemy wasps can sting a nest down. Every wasp runs **wasp.bee**, can't collect
nectar, and can `sting()` an enemy on the next tile for 5 damage, as often as it likes. Worker bees
can `sting()` too, but only once: 10 damage, and the bee dies when the sting lands (a miss costs
nothing), leaving a "danger" scent its colony can smell. Bees can't sting nests. A new account's wasp.bee only waits:
what wasps do is up to the player. Each world also hangs three **wild wasp nests** on unclaimed maps: their
wasps spot any bee within 4 tiles and chase it, faster than a bee flies, until it's dead or home (they
never sting inside a hive), a map with a nest can't be claimed,
and a nest destroyed by players' wasps hangs again on a free map next spring. Wild wasps only
hunt on their nest's own map. A **new colony is protected for 24 real hours**: other players
can't raid or sting it and wild wasps leave it alone, its hive shimmers gold, and attacking
another player ends the protection early (`shielded(position)` tells scripts).
`enemies_near()` and `owner_at(position)` let scripts see who's around. Under the editor,
**Chat** talks to everyone in your world and **Leaders** ranks its colonies by honey made. The server ticks every
`GAME_TICK_MS` (133 by default: 7.5 ticks a second, half single player's 1×) and saves every
world each 15 seconds and on shutdown.

A colony runs a script per role, each in its own editor tab:

- **forager.bee**: every forager runs its own copy. The starting bee is a forager.
- **wasp.bee**: every wasp runs this. Once the colony has a wasp nest (`build_nest`), the
  queen lays wasps with `lay("wasp")` for 30 honey; they hatch at the nest.
- **Custom roles**: **+ Role** adds up to 5 more (builder.bee, nurse.bee...). A role is
  just a script; bees hatch into the role the queen names with `lay("builder")` and keep it
  for life. `role()`, `roles()` and `role_count()` let scripts ask about them.
- **Custom builds**: the queen can lay any role stronger by naming stats,
  `lay(type="wasp", energy=300, damage=8)`. Energy, damage, health and a bee's capacity each go
  from the role's default up to `BUILD_MAX` (10) times it, for extra honey per egg of
  `BUILD_PRICE[stat] * (value / default - 1)²` (`eggCost()` in `world.ts`; scripts ask with
  `egg_cost(...)`). The prices were tuned with strategy races: a little extra capacity or
  energy pays for itself, doubling capacity doesn't, and health and damage cost the most.
  Units look the same on the meadow; the bee card lists a unit's build. The language has
  Python's keyword arguments (`name=value`) for built-ins and players' own functions.
- **shared.bee**: functions and constants every script can use, the queen's too. It runs ahead of each script
  in the same `Runner`, with its lines numbered from `SHARED_LINE_BASE` so errors and the
  line highlight can tell the files apart (`locate()` in `world.ts`). The queen gets read-only
  `hive_pos()`, `get_pos()`, `at_hive()` and `role()` ("queen"); other bee-only calls stop her with a hint.
- **queen.bee**: the queen stays in the hive and decides when to lay eggs, and of which role.

Press **Run** (or Ctrl+Enter). Click a bee, the hive, or a name in the bee list to follow it:
its card shows its stats and variables, and the editor highlights the line it is running.
Hover the meadow to see tile positions. 1× is 15 ticks per second. The corner buttons on the editor
and the meadow make either one fullscreen, with the top bar still there; Esc leaves.
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
    world.ts        World (maps, flowers, clock) and Colony (hive, bees, honey, log); one tick at a time, seeded
    view.ts         ColonyView, what the screen draws; RemoteColony, built from the server's JSON
    api.ts          what a script can call: move, collect, nearest_flower, ...
    apiDocs.ts      descriptions used by editor autocomplete and hover
  render/    draws the world onto a 320x192 pixel canvas
  audio/     background music: a CC0 loop per season, cross-faded
  ui/        Monaco editor setup, and the bee and queen stat cards
  docs/      the docs page: entries.ts holds each card's text and example clip
  app/       talking to the server (api.ts), the title pages, and the world map (worldMap.ts)
  tutorial/  the lessons (lessons.ts: text, starter code, world, goals, solution) and their panel
  main.ts    wires the editor, simulation and renderer together, in either mode
server/
  main.ts       starts the server: migrations, saved worlds, the tick loop
  auth.ts       sign up, log in, sessions (argon2id hashes, httpOnly cookie)
  scripts.ts    saved scripts per account and mode
  tutorial.ts   which tutorial lessons each player has finished
  worlds.ts     every multiplayer world: tick loop, claiming maps, deploys, saving, chat,
                the leaderboard, and the live WebSocket
  migrations/   the database schema, applied in order on start
scripts/
  balance.ts    two-year simulation of the default scripts, for tuning
  bench-world.ts  how long ticks take in a full 25-colony world
```

The server runs the same `src/sim` and `src/lang` code as the browser. A `World` is the land
and the clock; each `Colony` on it is one player's hive. Single player is a world of two maps:
the colony's (`world.colony`), and next door through the hedge's gate one with a wild wasp nest
(`SINGLE` in `src/main.ts`); multiplayer is a world of 5×5 maps where colonies are
`found()`ed and `remove()`d. `ColonyView` (`src/sim/view.ts`) is the read-only shape the
renderer and cards draw from: one map of the world, plus the player's own colony. In single
player that is the local `Colony`; in multiplayer it is a `RemoteColony` rebuilt from the
server's JSON after every tick.

Key ideas:

- **Each bee has its own interpreter** (`Runner`) over the same parsed script. The
  interpreter is built from generators, so it can stop mid-script.
- **Actions take game time.** `move()` and `collect()` pause the script until the world
  finishes them, then hand back a result.
- **Each bee gets 50 operations per tick**, so an infinite loop can't freeze the game.
- **One bee per tile** (the hive holds any number). `move()` fails into an occupied tile;
  `move_to()` steers around bees and gives up if blocked too long; `nearest_flower()` skips
  flowers another bee is on. `flowers_near()` lists every flower with nectar in sight (4 tiles),
  nearest first, taken or not, and `nectar_at(position)` reads one, so a script can choose.
- **The economy limits the colony, not a fixed number.** Each egg costs 10 honey and every
  bee or egg needs a cell of comb; workers `build()` more comb from 15 honey. Flowers can
  only feed so many bees, and winter eats into stores, so a queen who lays too eagerly
  starves her colony. (A hidden ceiling of 120 bees exists only for performance.)
- **Seasons.** Spring, summer, autumn and winter last 2,700 ticks each. Each season grows
  its own flowers in patches placed by the seed (`BLOOMS` and `bloom()` in `world.ts`):
  clover near the hive in spring, lavender everywhere in summer, a few rich goldenrod
  patches far out in autumn, nothing in winter. Every Run is a new meadow, so scripts have
  to explore rather than hard-code positions. In winter flying costs double, resting burns
  more energy, and bees age at half speed.
- **Bees eat, age and die.** Flying burns energy (1 per tile); `eat()` at the hive turns
  honey into energy (1 honey = 40). A bee starves at 0 energy and dies of old age after
  3,600–5,400 ticks of aging.
- **Scent is how bees share what they know.** `mark("food")` scents the bee's own tile;
  any bee can `smell("food")` the strongest mark within 12 tiles (twice its sight), or read
  its own tile with `smell_here()`. Marks fade over 2,400 ticks (most of a season), take a tick to leave, and show on the meadow, one color per name.
  Each colony smells only its own marks, so in multiplayer scent is private.
- **Fights.** A sting does 5 damage; a bee has 10 health and a wasp 30. Wild wasps follow a
  small built-in mind (`stepWild()` in `world.ts`) instead of a script: they chase enemies
  they can see within two maps of their nest and wander near it otherwise.
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
`tests/tutorial.test.ts` runs every lesson's solution (it must meet every goal within the
lesson's tick budget) and starter (it must not), so a rules change that breaks a lesson fails.

Positions are `[x, y]` tiles. `[0, 0]` is the top-left; `North` is up the screen.

## Next steps

All six phases are built: accounts, the server-run colony, the 5×5 world, raiding and health,
wasps, and chat with a leaderboard. Still open:

- Hosting, so outside players can join (the design doc compares options)
- The wasp sprite's source and license (see CREDITS.md)
- Balance for multiplayer: wild nests kill unguarded foragers that wander close

## Credits

See [CREDITS.md](CREDITS.md).
