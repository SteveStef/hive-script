// Scripts for tests and the balance tools: a colony that works and survives for years, unlike
// the deliberately short starting scripts in src/defaultScript.ts.

export const SURVIVOR_FORAGER = `while True:
    if energy() < distance(get_pos(), hive_pos()) + 20:
        go_home()
        eat()
    elif season() == "winter":
        go_home()
        wait(30)
    elif nectar() == capacity():
        go_home()
        deposit()
        eat()  # top up before the next trip
    else:
        f = nearest_flower()
        if f:
            move_to(f)
            collect()
        else:
            move_to(random_spot())
`;

export const SURVIVOR_QUEEN = `while True:
    if season() != "winter" and honey() >= 10 + 5 * bee_count() and space() > 0:
        lay()
    else:
        wait(60)
`;

// a wasp that guards the hive: stands beside it and stings any enemy next to it
export const GUARD_WASP = `# wasp.bee: wasps guard the hive and sting enemies next to them.
while True:
    enemies = enemies_near()
    if enemies and distance(get_pos(), enemies[0]) == 1:
        sting(enemies[0])
    else:
        move_to([hive_pos()[0] + 1, hive_pos()[1]])
`;
