let appController = null;

export const getAppController = () => appController;
export const setAppController = (controller) => { appController = controller || null; };
