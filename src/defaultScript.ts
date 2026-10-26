export const DEFAULT_FORAGER = `# forager.bee: every worker bee runs its own copy of this.
# Press Run (or Ctrl+Enter). Click a bee to see its stats and which line it is on.

def can_reach(p):
    # flying costs 1 energy per tile: is there enough to get there and back home?
    return energy() > distance(get_pos(), p) + distance(p, hive_pos()) + 10

while True:
    if energy() < distance(get_pos(), hive_pos()) + 10:
        # turn back while there's still enough energy to get home
        go_home()
        eat()
    elif season() == "winter":
        # nothing blooms in winter: stay in the hive and keep warm
        go_home()
        wait(30)
    elif nectar() >= capacity():
        go_home()
        deposit()
        if space() == 0 and honey() >= 60:
            build()  # turn honey into wax: one more cell of comb
    else:
        f = nearest_flower()
        s = smell("food")
        if f and can_reach(f):
            move_to(f)
            if collect():
                mark("food")  # tell the others: flowers here
        elif s and distance(get_pos(), s) > 6 and can_reach(s):
            # flowers out of sight that another bee marked: follow the scent
            move_to(s)
        else:
            # nothing to see or smell: explore somewhere new
            spot = [random(20), random(12)]
            if can_reach(spot):
                move_to(spot)
            else:
                go_home()
                eat()
`;

export const DEFAULT_QUEEN = `# queen.bee: the queen never leaves the hive. She decides when the colony grows.
# Each egg costs 10 honey and needs a free cell of comb. It hatches into a worker.
# Bees laid in autumn live through winter (bees age slowly then), but the colony needs
# honey to get through the cold: about 5 per bee. So in autumn, keep that much back.
while True:
    reserve = 10
    if season() == "autumn":
        reserve = 5 * bee_count()
    if bee_count() == 0 and egg_count() == 0 and honey() >= 10:
        lay()  # the hive is empty: lay no matter what
    elif season() != "winter" and honey() >= reserve + 10 and space() > 0:
        lay()
    else:
        wait(60)
`;
