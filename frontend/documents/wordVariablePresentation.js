function normalizeVariableName(value) {
  return String(value || "")
    .trim()
    .replace(/^\{+|\}+$/g, "");
}

export function getDerivedWordVariableCodes(variableName, format) {
  const name = normalizeVariableName(variableName);
  if (!name) return [];
  switch (String(format || "").trim().toLowerCase()) {
    case "currency":
      return [{ code: `{bangchu_${name}}`, label: "Bằng chữ" }];
    case "date":
    case "datetime":
      return [{ code: `{S_${name}}`, label: "Ngày ngắn" }];
    default:
      return [];
  }
}

export function normalizeWordVariableSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

export function matchesWordVariableSearch(query, values) {
  const normalizedQuery = normalizeWordVariableSearch(query);
  if (!normalizedQuery) return true;
  return normalizeWordVariableSearch((values || []).flat().join(" "))
    .includes(normalizedQuery);
}
