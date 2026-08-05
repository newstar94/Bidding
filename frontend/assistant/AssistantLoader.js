import { assistantApi } from "./AssistantApi.js";

export async function loadAssistant(controller) {
  let config;
  try { config = await assistantApi.getConfig(); } catch (_) { return null; }
  if (!config?.enabled) return null;
  const { mountAssistant } = await import("./AssistantController.js");
  return mountAssistant(controller, config);
}
