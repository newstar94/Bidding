const loadExcelIntegration = () => import("../documents/ExcelIntegration.js");
const loadWordIntegration = () => import("../documents/WordIntegration.js");
const loadWordPublication = () => import("../documents/WordPublication.js");

async function callLazyWorkflow(loader, fnName, controller, args) {
  const mod = await loader();
  const fn = mod[fnName];
  if (typeof fn !== "function") {
    throw new Error(`Missing lazy workflow function: ${fnName}`);
  }
  return fn.apply(controller, args);
}

export function setupExcelImportEvents(...args) {
  return callLazyWorkflow(loadExcelIntegration, "setupExcelImportEvents", this, args);
}
export function triggerExcelImport(...args) {
  return callLazyWorkflow(loadExcelIntegration, "triggerExcelImport", this, args);
}
export function triggerExcelTemplateDownload(...args) {
  return callLazyWorkflow(loadExcelIntegration, "triggerExcelTemplateDownload", this, args);
}
export function handleExcelUpload(...args) {
  return callLazyWorkflow(loadExcelIntegration, "handleExcelUpload", this, args);
}
export function saveExcelImport(...args) {
  return callLazyWorkflow(loadExcelIntegration, "saveExcelImport", this, args);
}
export function exportPhatHanhPhanLoExcel(...args) {
  return callLazyWorkflow(loadExcelIntegration, "exportPhatHanhPhanLoExcel", this, args);
}
export function exportEditPhanLoExcel(...args) {
  return callLazyWorkflow(loadExcelIntegration, "exportEditPhanLoExcel", this, args);
}
export function exportEditTuyChonMuaThemExcel(...args) {
  return callLazyWorkflow(loadExcelIntegration, "exportEditTuyChonMuaThemExcel", this, args);
}
export function importPhatHanhPhanLoExcel(...args) {
  return callLazyWorkflow(loadExcelIntegration, "importPhatHanhPhanLoExcel", this, args);
}
export function revalidateExcelImportData(...args) {
  return callLazyWorkflow(loadExcelIntegration, "revalidateExcelImportData", this, args);
}
export function setupWordTemplatesEvents(...args) {
  return callLazyWorkflow(loadWordIntegration, "setupWordTemplatesEvents", this, args);
}
export function setupCopyVariableEvents(...args) {
  return callLazyWorkflow(loadWordIntegration, "setupCopyVariableEvents", this, args);
}
export function loadWordTemplates(...args) {
  return callLazyWorkflow(loadWordIntegration, "loadWordTemplates", this, args);
}
export function loadWordMappings(...args) {
  return callLazyWorkflow(loadWordIntegration, "loadWordMappings", this, args);
}
export function setupTemplateActivationEvents(...args) {
  return callLazyWorkflow(loadWordIntegration, "setupTemplateActivationEvents", this, args);
}
export function handleWordTemplateUpload(...args) {
  return callLazyWorkflow(loadWordIntegration, "handleWordTemplateUpload", this, args);
}
export function setupWordPublicationPage(...args) {
  return callLazyWorkflow(loadWordPublication, "setupWordPublicationPage", this, args);
}
