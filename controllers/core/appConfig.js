const appDocument = typeof document === "undefined" ? null : document;

export const APP_DEBUG = appDocument?.querySelector('meta[name="bf-app-debug"]')?.content === "true";
