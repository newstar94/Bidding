import { apiFetch } from "../shared/apiClient.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
  isWorkspaceLeaseCurrent,
} from "../app/workspaceLease.js";

export const WORD_PUBLICATION_TEMPLATE_ASSIGNMENTS_ENDPOINT = (
  "/api/word-publication-template-assignments"
);

function stringListMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalizedKey = String(key || "").trim();
    const values = Array.isArray(item) ? item : [item];
    const seen = new Set();
    const normalizedValues = values.flatMap((filename) => {
      const normalized = String(filename || "").trim();
      const identity = normalized.toLocaleLowerCase("vi");
      if (!normalized || seen.has(identity)) return [];
      seen.add(identity);
      return [normalized];
    });
    return normalizedKey && normalizedValues.length ? [[normalizedKey, normalizedValues]] : [];
  }));
}

function resolvedTemplateListMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([documentType, items]) => {
      const candidates = Array.isArray(items) ? items : [items];
      const normalized = candidates.flatMap((item) => {
        const filename = String(item?.filename || "").trim();
        if (!filename) return [];
        return [{
          filename,
          source: String(item?.source || "assignment").trim(),
        }];
      });
      return normalized.length ? [[String(documentType), normalized]] : [];
    }),
  );
}

export function normalizeWordPublicationTemplateConfig(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Phản hồi cấu hình biểu mẫu Word không đúng định dạng.");
  }
  const documentTypes = Array.isArray(payload.documentTypes)
    ? payload.documentTypes.filter((item) => (
      item && typeof item === "object" && String(item.id || "").trim()
    )).map((item) => ({
      id: String(item.id).trim(),
      label: String(item.label || item.id).trim(),
      scope: String(item.scope || "").trim(),
      contextType: String(item.contextType || "").trim(),
      legacyActiveFallback: item.legacyActiveFallback === true,
    }))
    : [];
  const assignmentSets = stringListMap(
    payload.assignmentSets || payload.assignments,
  );
  const resolvedTemplateSets = resolvedTemplateListMap(
    payload.resolvedTemplateSets || payload.resolvedTemplates,
  );
  const revision = Number(payload.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Phiên bản cấu hình biểu mẫu Word không hợp lệ.");
  }
  return {
    revision,
    documentTypes,
    assignments: assignmentSets,
    assignmentSets,
    resolvedTemplates: Object.fromEntries(
      Object.entries(resolvedTemplateSets).map(([documentType, items]) => (
        [documentType, items[0]]
      )),
    ),
    resolvedTemplateSets,
    activeTemplate: String(payload.activeTemplate || "").trim(),
  };
}

async function readConfigResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return normalizeWordPublicationTemplateConfig(payload);
}

export async function loadWordPublicationTemplateConfig(controller) {
  const request = beginWorkspaceRequest(controller.model);
  if (controller._wordPublicationTemplateConfigWorkspaceToken !== request.lease.token) {
    controller._wordPublicationTemplateConfigWorkspaceToken = request.lease.token;
    controller._wordPublicationTemplateConfig = null;
    controller._wordPublicationTemplateConfigError = "";
  }
  try {
    const response = await apiFetch(WORD_PUBLICATION_TEMPLATE_ASSIGNMENTS_ENDPOINT, {
      signal: request.signal,
    });
    assertWorkspaceLeaseCurrent(controller.model, request.lease);
    const config = await readConfigResponse(response);
    assertWorkspaceLeaseCurrent(controller.model, request.lease);
    controller._wordPublicationTemplateConfig = config;
    controller._wordPublicationTemplateConfigError = "";
    return config;
  } catch (error) {
    if (isWorkspaceLeaseCurrent(controller.model, request.lease)) {
      controller._wordPublicationTemplateConfigError = error instanceof Error
        ? error.message
        : String(error);
    }
    throw error;
  } finally {
    finishWorkspaceRequest(controller.model, request);
  }
}

export async function saveWordPublicationTemplateAssignments(controller, assignments) {
  const request = beginWorkspaceRequest(controller.model);
  try {
    if (
      request.lease.token
      && controller._wordPublicationTemplateConfigWorkspaceToken !== request.lease.token
    ) {
      throw new Error("Cần tải lại cấu hình biểu mẫu Word cho workspace hiện tại.");
    }
    const revision = Number(
      controller._wordTemplateAssignmentState?.config?.revision
      ?? controller._wordPublicationTemplateConfig?.revision,
    );
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("Cần tải lại cấu hình biểu mẫu Word trước khi lưu.");
    }
    const response = await apiFetch(WORD_PUBLICATION_TEMPLATE_ASSIGNMENTS_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: revision,
        assignmentSets: assignments,
      }),
      signal: request.signal,
    });
    assertWorkspaceLeaseCurrent(controller.model, request.lease);
    const config = await readConfigResponse(response);
    assertWorkspaceLeaseCurrent(controller.model, request.lease);
    controller._wordPublicationTemplateConfig = config;
    controller._wordPublicationTemplateConfigError = "";
    return config;
  } finally {
    finishWorkspaceRequest(controller.model, request);
  }
}

export function resolvedWordPublicationTemplates(config, documentType) {
  const templates = config?.resolvedTemplateSets?.[documentType];
  if (Array.isArray(templates)) return templates;
  const legacy = config?.resolvedTemplates?.[documentType];
  return legacy ? [legacy] : [];
}
