let cachedSession = null;
let capabilityRequest = null;
let sessionGeneration = 0;

export const PROCUREMENT_IMPORT_CAPABILITY = "procurement-import-v2";
export const PROCUREMENT_LOOKUP_CAPABILITY = "procurement-lookup-v1";

function normalizedCapabilities(session) {
  return Array.isArray(session?.serverCapabilities)
    ? [...new Set(session.serverCapabilities.map(String).filter(Boolean))]
    : [];
}

function authenticatedSessionIdentity(session) {
  if (session?.valid !== true) return "";
  return String(session?.user?.id || "").trim();
}

export function invalidateServerCapabilities() {
  cachedSession = null;
  capabilityRequest = null;
  sessionGeneration += 1;
}

export function hasServerCapability(capability) {
  return Boolean(
    cachedSession?.capabilities.includes(String(capability || "")),
  );
}

export function updateServerCapabilitiesFromSession(session) {
  const identity = authenticatedSessionIdentity(session);
  if (!identity) {
    invalidateServerCapabilities();
    return normalizedCapabilities(session);
  }
  // A refresh is authoritative even when the user id is unchanged. Bump the
  // generation so an older in-flight discovery cannot overwrite it.
  sessionGeneration += 1;
  cachedSession = {
    capabilities: normalizedCapabilities(session),
    identity,
  };
  return [...cachedSession.capabilities];
}

export async function resolveServerCapabilities(fetchSession) {
  if (cachedSession) return [...cachedSession.capabilities];
  if (capabilityRequest) return capabilityRequest;
  if (typeof fetchSession !== "function") return [];
  const requestedGeneration = sessionGeneration;
  let request;
  request = Promise.resolve()
    .then(fetchSession)
    .then((session) => {
      if (sessionGeneration !== requestedGeneration) {
        return cachedSession ? [...cachedSession.capabilities] : [];
      }
      return updateServerCapabilitiesFromSession(session);
    })
    .finally(() => {
      if (capabilityRequest === request) capabilityRequest = null;
    });
  capabilityRequest = request;
  return request;
}
