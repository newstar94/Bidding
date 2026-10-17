/** UI eligibility only. The server revalidates creator, access and references. */
export function canRequestRecordDelete(model, record) {
  if (model?.state?.activerole !== "employee") return true;
  const userId = String(model?.state?.activeuser?.id || model?.workspaceScope?.userId || "");
  const organizationId = String(model?.workspaceScope?.organizationId || model?.state?.activeuser?.activeOrganizationId || "");
  if (!userId) return false;
  if (organizationId.startsWith("personal:")) return organizationId === `personal:${userId}`;
  return String(record?.deleteOwnerUserId || "") === userId;
}
