const ACRONYMS = new Set([
  "TNHH", "CTCP", "CP", "MTV", "UBND", "HĐND", "BQL", "BQLDA", "HTX",
  "JSC", "LLC", "FPT", "VNPT", "EVN", "BIDV", "PCCC", "TM", "DV", "XNK", "HDN",
]);
const PHRASES = [
  "Công ty", "Cổ phần", "Trách nhiệm hữu hạn", "Một thành viên", "Hai thành viên",
  "Thương mại", "Dịch vụ", "Dược phẩm", "Xây dựng", "Đầu tư", "Phát triển",
  "Trung tâm", "Y tế", "Bệnh viện", "Ban quản lý", "Dự án", "Ủy ban nhân dân",
  "Liên danh", "Chi nhánh", "Khu vực", "Thành phố", "Thị xã", "Thị trấn",
];
const VIETNAMESE_VOWELS = new Set("aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ".split(""));

function isShortInitialism(word) {
  const letters = [...word.toLocaleLowerCase("vi")].filter((char) => /\p{L}/u.test(char));
  return letters.length > 1 && letters.length <= 4
    && letters.every((char) => !VIETNAMESE_VOWELS.has(char));
}

// Casing only: retain spacing, punctuation, accents, codes and mixed-case names.
export function normalizeProcurementPartnerName(value) {
  const text = String(value ?? "");
  if (text === text.toLocaleLowerCase("vi") || text !== text.toLocaleUpperCase("vi")) {
    return text.replace(/\p{L}[\p{L}\p{M}\p{N}]*/gu, (word) => (
      isShortInitialism(word) ? word.toLocaleUpperCase("vi") : word
    ));
  }
  let result = text.replace(/\p{L}[\p{L}\p{M}\p{N}]*/gu, (word) => {
    if (ACRONYMS.has(word) || isShortInitialism(word) || /\p{N}/u.test(word)) {
      return isShortInitialism(word) ? word.toLocaleUpperCase("vi") : word;
    }
    return word[0] + word.slice(1).toLocaleLowerCase("vi");
  });
  for (const phrase of PHRASES) {
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{M}])${phrase}(?![\\p{L}\\p{M}])`, "giu"), phrase);
  }
  return result;
}
