import { assistantApi } from "./AssistantApi.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const ASSISTANT_STYLESHEET_URL = new URL("./assistant.css", import.meta.url).pathname;

export async function loadAssistant(controller) {
  let config;
  try { config = await assistantApi.getConfig(); } catch (_) { return null; }
  if (!config?.enabled) return null;
  await loadStyleOnce(ASSISTANT_STYLESHEET_URL);
  const { mountAssistant } = await import("./AssistantController.js");
  return mountAssistant(controller, config);
}
