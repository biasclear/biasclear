// JSON.parse wrappers. Node's own SyntaxError message quotes the start of the
// input, so its error object never leaves these functions.

export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
