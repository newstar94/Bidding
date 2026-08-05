import { hydrateVersionFamily } from "../shared/VersionFamilyLoader.js";

export async function selectExpertVersion(controller, rootId, selectedId) {
  const state = controller?.model?.state;
  const records = state?.chuyengia;
  if (!Array.isArray(records) || !rootId || !selectedId) return false;

  const familySource = records.find(
    (expert) => String(expert?.rootId || expert?.id || "") === String(rootId),
  );
  if (familySource) {
    await hydrateVersionFamily(controller, "chuyengia", familySource);
  }

  const selectedExists = controller.model.state.chuyengia.some(
    (expert) => String(expert?.id || "") === String(selectedId),
  );
  if (!selectedExists) return false;

  state.selectedChuyenGiaVersion ||= {};
  state.selectedChuyenGiaVersion[rootId] = selectedId;
  await controller.view?.renderChuyenGiaTable?.({ reuseCurrentPage: true });
  return true;
}
