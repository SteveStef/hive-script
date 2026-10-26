/** A problem in the player's script, tied to the line it happened on (1-based). */
export class ScriptError extends Error {
  constructor(message: string, public readonly line: number) {
    super(message);
    this.name = 'ScriptError';
  }
}
