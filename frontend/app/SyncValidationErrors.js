export function getSyncValidationErrors(data) {
  if (Array.isArray(data?.errors)) return data.errors;
  if (Array.isArray(data?.fields?.errors)) return data.fields.errors;
  return [];
}
