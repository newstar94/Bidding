const getStore = () => {
    window._jvDataMap = window._jvDataMap || {};
    return window._jvDataMap;
};

export function setJvData(key, data) {
    if (!key) return;
    getStore()[key] = data;
}

export function getJvData(key) {
    return getStore()[key] || null;
}
