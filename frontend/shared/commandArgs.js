const MAX_REGISTERED_ARGUMENTS = 2_000;
const commandArguments = new Map();
let nextArgumentId = 0;

/**
 * Store command arguments outside the DOM and return an attribute-safe opaque key.
 * This avoids serializing untrusted values into HTML attributes.
 */
export function registerCommandArgs(args = []) {
  const normalizedArgs = Array.isArray(args) ? [...args] : [args];
  nextArgumentId = (nextArgumentId + 1) % Number.MAX_SAFE_INTEGER;
  const key = `bf${nextArgumentId.toString(36)}`;
  commandArguments.set(key, normalizedArgs);

  while (commandArguments.size > MAX_REGISTERED_ARGUMENTS) {
    const oldestKey = commandArguments.keys().next().value;
    commandArguments.delete(oldestKey);
  }
  return key;
}

export function resolveCommandArgs(key) {
  if (!key || !commandArguments.has(key)) return [];
  return [...commandArguments.get(key)];
}

export function clearCommandArgsForTests() {
  commandArguments.clear();
  nextArgumentId = 0;
}
