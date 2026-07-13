const jvDataMap = Object.create(null);
const getStore = () => jvDataMap;
export function setJvData(key, data) {
  if (!key) return;
  getStore()[key] = data;
}
export function getJvData(key) {
  return getStore()[key] || null;
}
