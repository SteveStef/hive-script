export const DEFAULT_FORAGER = `# forager.bee: every forager bee runs this, over and over.
# Press Run, then click a bee to see which line it's on.
while True:
    if energy() < distance(get_pos(), hive_pos()) + 20:
        go_home()  # getting tired: head home while there's energy to get there
        eat()
    elif season() == "winter":
        go_home()  # no flowers in winter: stay warm in the hive
        wait(30)
    elif nectar() == capacity():
        go_home()
        deposit()  # nectar becomes honey
        eat()  # top up before the next trip
    else:
        f = nearest_flower()
        if f:
            move_to(f)
            collect()
        else:
            move_to(random_spot())  # nothing nearby: look somewhere new
`;

export const DEFAULT_QUEEN = `# queen.bee: the queen stays in the hive and lays eggs.
# Each egg costs 10 honey and hatches into a new forager.
while True:
    if season() != "winter" and honey() >= 10 + 5 * bee_count() and space() > 0:
        lay()  # keeps about 5 honey per bee for winter
    else:
        wait(60)
`;

export const DEFAULT_WASP = `# wasp.bee: every wasp runs this. Wasps guard the hive and sting enemies.
while True:
    enemies = enemies_near()
    if energy() < 40 or health() < 15:
        go_home()
        eat()  # eating heals stings, too
    elif enemies and distance(get_pos(), enemies[0]) == 1:
        sting(enemies[0])
    else:
        move_to([hive_pos()[0] + 1, hive_pos()[1]])  # stand guard next to the hive
        wait(1)
`;

export const DEFAULT_SHARED = `# shared.bee: functions you write here work in every worker bee's script.
# It's empty for now. The docs show what you can put here.
`;

/** What a new role's script starts as. */
export function roleTemplate(name: string): string {
  return `# ${name}.bee: every bee the queen lays with lay("${name}") runs its own copy of this.
# Functions from shared.bee work here too.
while True:
    if energy() < 30:
        go_home()
        eat()
    else:
        print("I'm a ${name} with nothing to do yet")
        wait(60)
`;
}
