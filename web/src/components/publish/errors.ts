/**
 * What to show for something that was thrown.
 *
 * The store and the api both throw Error with the server's own words in them
 * (see ApiError), so those words are what a reader gets; anything else is given
 * a sentence of its own rather than a stack trace.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : '请稍后再试。';
}
