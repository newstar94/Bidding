import { assertOutboundRecordFields } from "../app/outboundSerializer.js";

function resolveControl(root, target) {
  if (!target) return null;
  if (typeof target !== "string") return target;
  return root?.getElementById?.(target)
    || root?.querySelector?.(`#${globalThis.CSS?.escape ? globalThis.CSS.escape(target) : target}`)
    || null;
}

export function clearFormValidation(form) {
  form?.querySelectorAll?.(".form-group.invalid, .invalid")?.forEach((element) => element.classList.remove("invalid"));
}

export function setFormValues(root, data, mapping) {
  Object.entries(mapping || {}).forEach(([dataKey, config]) => {
    const descriptor = typeof config === "string" ? { target: config } : config;
    const control = resolveControl(root, descriptor.target);
    if (!control) return;
    const raw = data?.[dataKey];
    const value = descriptor.format ? descriptor.format(raw, data) : raw;
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
    } else {
      control.value = value ?? descriptor.defaultValue ?? "";
    }
  });
}

export function collectFormValues(root, mapping, schemaType = null) {
  const result = {};
  Object.entries(mapping || {}).forEach(([dataKey, config]) => {
    const descriptor = typeof config === "string" ? { target: config } : config;
    const control = resolveControl(root, descriptor.target);
    if (!control) return;
    const raw = control.type === "checkbox" ? control.checked : control.value;
    const parsed = descriptor.parse ? descriptor.parse(raw, control) : raw;
    result[dataKey] = descriptor.normalize ? descriptor.normalize(parsed, control) : parsed;
  });
  if (schemaType) {
    assertOutboundRecordFields(result, schemaType, { source: `form ${schemaType}` });
  }
  return result;
}

export function normalizeFormValues(data, schema = {}) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => {
    const normalize = schema[key]?.normalize || schema[key];
    return [key, typeof normalize === "function" ? normalize(value, data) : value];
  }));
}

export function resetFormState(form, { values = null, root = document, mapping = null } = {}) {
  form?.reset?.();
  clearFormValidation(form);
  if (values && mapping) setFormValues(root, values, mapping);
}
