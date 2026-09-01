function emptySession() {
  return {
    server: null,
    browser: null,
    context: null,
    page: null,
  };
}

async function closeResource(resource) {
  if (resource && typeof resource.close === "function") await resource.close();
}

export function createBrowserSessionManager({
  launchServer,
  connect,
  contextOptions = {},
  configurePage = async () => {},
} = {}) {
  if (typeof launchServer !== "function" || typeof connect !== "function") {
    throw new TypeError("Browser session launch and connect functions are required.");
  }

  let session = emptySession();

  const snapshot = () => ({ ...session });

  async function close() {
    const previous = session;
    session = emptySession();
    let firstError = null;
    try {
      await closeResource(previous.context);
    } catch (error) {
      firstError = error;
    }
    try {
      await closeResource(previous.server);
    } catch (error) {
      firstError ||= error;
    }
    // The BrowserServer owns the connected Chromium process. Closing the
    // server after its context avoids racing Browser.close() against the
    // server's own process shutdown.
    if (!previous.server) {
      try {
        await closeResource(previous.browser);
      } catch (error) {
        firstError ||= error;
      }
    }
    if (firstError) throw firstError;
  }

  async function open(preservedState = undefined) {
    if (session.server || session.browser || session.context || session.page) {
      throw new Error("Browser session is already open.");
    }

    const next = emptySession();
    try {
      next.server = await launchServer();
      next.browser = await connect(next.server);
      next.context = await next.browser.newContext({
        ...contextOptions,
        storageState: preservedState?.storageState,
      });
      if (preservedState?.sessionStorage) {
        await next.context.addInitScript(({ origin, entries }) => {
          if (location.origin !== origin) return;
          for (const [key, value] of entries) sessionStorage.setItem(key, value);
        }, preservedState.sessionStorage);
      }
      next.page = await next.context.newPage();
      await configurePage(next.page);
      session = next;
      return snapshot();
    } catch (error) {
      session = next;
      try {
        await close();
      } catch {
        // Preserve the launch/configuration error that made the session unusable.
      }
      throw error;
    }
  }

  async function captureState() {
    if (!session.context) throw new Error("Browser session is not open.");
    const storageState = await session.context.storageState({ indexedDB: true });
    let capturedSessionStorage;
    if (session.page && typeof session.page.evaluate === "function") {
      capturedSessionStorage = await session.page.evaluate(() => ({
        origin: location.origin,
        entries: Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)]),
      }));
    }
    // storageState covers cookies, localStorage and IndexedDB. The application
    // also keeps the active workspace/persona bootstrap in sessionStorage, so
    // preserve that origin-scoped state explicitly across a context restart.
    return {
      storageState,
      ...(capturedSessionStorage?.origin ? { sessionStorage: capturedSessionStorage } : {}),
    };
  }

  async function restartPreservingStorage() {
    let preservedState;
    try {
      preservedState = await captureState();
    } catch (error) {
      try {
        await close();
      } catch {
        // Preserve the state-capture error; the unusable session is released.
      }
      throw error;
    }
    await close();
    try {
      return await open(preservedState);
    } catch (error) {
      try {
        await close();
      } catch {
        // Preserve the reopen failure; cleanup is best-effort at this point.
      }
      throw error;
    }
  }

  return Object.freeze({
    open,
    close,
    captureState,
    restartPreservingStorage,
    snapshot,
  });
}
