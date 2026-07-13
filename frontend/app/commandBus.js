let activeExecutor = null;

export function setCommandExecutor(executor) {
  activeExecutor = typeof executor === "function" ? executor : null;
}

export function executeAppCommand(name, ...args) {
  if (!activeExecutor) {
    console.warn(`[Command] Executor is not ready: ${name}`);
    return undefined;
  }
  return activeExecutor(name, ...args);
}

export function hasCommandExecutor() {
  return typeof activeExecutor === "function";
}

