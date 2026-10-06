import { assistantApi } from "./AssistantApi.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const ASSISTANT_STYLESHEET_URL = new URL("./assistant.css", import.meta.url).pathname;

export async function loadAssistant(controller) {
  let config;
  try { config = await assistantApi.getConfig(); } catch (_) { return null; }
  if (!config?.enabled) return null;
  // Fetch the stylesheet and controller chunk together so the visible trigger
  // is not delayed by two serial asset waits after the config response.
  const [{ mountAssistant }] = await Promise.all([
    import("./AssistantController.js"),
    loadStyleOnce(ASSISTANT_STYLESHEET_URL),
  ]);
  return mountAssistant(controller, config);
}
