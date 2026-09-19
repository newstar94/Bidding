const ACRONYMS = new Set([
  "TNHH", "CTCP", "CP", "MTV", "UBND", "HĐND", "BQL", "BQLDA", "HTX",
  "JSC", "LLC", "FPT", "VNPT", "EVN", "BIDV", "PCCC", "TM", "DV", "XNK",
]);
const PHRASES = [
  "Công ty", "Cổ phần", "Trách nhiệm hữu hạn", "Một thành viên", "Hai thành viên",
  "Thương mại", "Dịch vụ", "Dược phẩm", "Xây dựng", "Đầu tư", "Phát triển",
  "Trung tâm", "Y tế", "Bệnh viện", "Ban quản lý", "Dự án", "Ủy ban nhân dân",
  "Liên danh", "Chi nhánh", "Khu vực", "Thành phố", "Thị xã", "Thị trấn",
];

// Casing only: retain spacing, punctuation, accents, codes and mixed-case names.
export function normalizeProcurementPartnerName(value) {
  const text = String(value ?? "");
  if (text === text.toLocaleLowerCase("vi") || text !== text.toLocaleUpperCase("vi")) return text;
  let result = text.replace(/\p{L}[\p{L}\p{M}\p{N}]*/gu, (word) => {
    if (ACRONYMS.has(word) || /\p{N}/u.test(word)) return word;
    return word[0] + word.slice(1).toLocaleLowerCase("vi");
  });
  for (const phrase of PHRASES) {
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{M}])${phrase}(?![\\p{L}\\p{M}])`, "giu"), phrase);
  }
  return result;
}
