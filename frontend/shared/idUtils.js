const RECORD_ID_PREFIXES = {
  user: "user-", organization: "org-", org: "org-",
  chudautu: "cdt-", chu_dau_tu: "cdt-",
  nhathau: "nt-", nha_thau: "nt-",
  chuyengia: "cg-", chuyen_gia: "cg-",
  kehoach: "kh-", ke_hoach_lcnt: "kh-",
  goithau: "gt-", goi_thau: "gt-",
  hopdong: "hd-", hop_dong: "hd-",
  thongtinmothau: "mt-", thong_tin_mo_thau: "mt-",
  hanghoaduthaunhathau: "hhdt-", hang_hoa_du_thau_nha_thau: "hhdt-",
  assignments: "asg-", phan_cong_nhan_su: "asg-",
  customcontractstatuses: "tthd-", danh_muc_trang_thai_hop_dong: "tthd-",
  permissionmatrix: "perm-", ma_tran_phan_quyen: "perm-",
  phanlo: "pl-", goi_thau_phan_lo: "pl-",
  tuychonmuathem: "tcmt-", goi_thau_tuy_chon_mua_them: "tcmt-",
  giahan: "gh-", goi_thau_gia_han: "gh-",
  lamro: "lr-", yeucaulamro: "lr-", traloilamro: "lr-", goi_thau_lam_ro: "lr-",
  ke_hoach_cong_viec: "khcv-",
  canculapkehoach: "khcc-", can_cu_lap_ke_hoach: "khcc-", ke_hoach_can_cu: "khcc-",
  nha_thau_lien_danh_thanh_vien: "ntld-",
  thong_tin_mo_thau_lien_danh_thanh_vien: "mtld-",
  wordmapping: "wmp-", cau_hinh_bien_word: "wmp-",
};

export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : random & 3 | 8;
    return value.toString(16);
  });
}

export function generateRecordId(type) {
  const key = String(type || "").trim().toLowerCase();
  return `${RECORD_ID_PREFIXES[key] || ""}${generateUUID()}`;
}
