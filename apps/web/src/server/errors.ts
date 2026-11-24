/** A validation or rule failure whose message is safe to show the user as-is. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}
