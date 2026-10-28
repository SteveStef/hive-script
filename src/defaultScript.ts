// The starting scripts are short and work, but on purpose they don't keep a colony alive for
// long (it dies in its first autumn): improving them is the game.

export const DEFAULT_FORAGER = `# forager.bee: every forager runs this, over and over.
while True:
    f = nearest_flower()
    if f:
        move_to(f)
        collect()
    go_home()
    deposit()
    eat()
`;

export const DEFAULT_QUEEN = `# queen.bee: the queen stays home and lays eggs (10 honey each).
while True:
    lay()
    wait(100)
`;

export const DEFAULT_WASP = `while True:
    wait(100)
`;

export const DEFAULT_SHARED = `# shared.bee: functions you write here work in every script, the queen's too.
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
