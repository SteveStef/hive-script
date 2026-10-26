export const DEFAULT_FORAGER = `# forager.bee: every worker bee runs its own copy of this.
# Press Run (or Ctrl+Enter). Click a bee to see its stats and which line it is on.
while True:
    if energy() < 25:
        # flying burns energy; head home and eat before you starve
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
        if f:
            move_to(f)
            collect()
        else:
            # nothing in sight: wander one tile in a random direction
            move([North, South, East, West][random(4)])
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
