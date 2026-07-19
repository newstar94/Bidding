const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_048;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 30 * 1024 * 1024;
const MAX_SINGLE_XML_BYTES = 10 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const LEGACY_XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const REQUIRED_XLSX_PARTS = new Set(["[content_types].xml", "xl/workbook.xml"]);

function unsafe(message) {
  throw new Error(message);
}

function normaliseEntryName(name) {
  const candidate = name.replaceAll("\\", "/");
  if (!candidate || candidate.startsWith("/") || candidate.includes("\0")) {
    unsafe("Tệp Excel chứa đường dẫn nội bộ không hợp lệ.");
  }
  const firstPart = candidate.split("/", 1)[0];
  const withoutDirectorySuffix = candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
  const components = withoutDirectorySuffix.split("/");
  if (firstPart.endsWith(":") || components.some((part) => !part || part === "." || part === "..")) {
    unsafe("Tệp Excel chứa đường dẫn nội bộ không an toàn.");
  }
  return candidate;
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  unsafe("Tệp Excel không phải là gói ZIP hợp lệ.");
}

function decodeEntryName(bytes, flags) {
  const encoding = flags & 0x0800 ? "utf-8" : "latin1";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    unsafe("Tên thành phần trong tệp Excel không hợp lệ.");
  }
}

export function validateXlsxArchiveBytes(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 22) {
    unsafe("Tệp Excel đang trống hoặc không hợp lệ.");
  }

  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  if (
    diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount ||
    entryCount === 0 || entryCount > MAX_ARCHIVE_ENTRIES || entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff
  ) {
    unsafe("Cấu trúc tệp Excel không được hỗ trợ.");
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    unsafe("Thư mục thành phần của tệp Excel không hợp lệ.");
  }

  const names = new Set();
  const localSegments = [];
  let totalSize = 0;
  let totalXmlSize = 0;
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      unsafe("Thư mục thành phần của tệp Excel không hợp lệ.");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;

    if (fileNameLength === 0 || nextOffset > eocdOffset || diskStart !== 0) {
      unsafe("Thông tin thành phần trong tệp Excel không hợp lệ.");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) unsafe("Không hỗ trợ tệp Excel ZIP64.");
    if (flags & 0x0001) unsafe("Không hỗ trợ tệp Excel có thành phần được mã hóa.");
    if (compressionMethod !== 0 && compressionMethod !== 8) unsafe("Tệp Excel sử dụng phương thức nén không được hỗ trợ.");

    const rawName = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = normaliseEntryName(decodeEntryName(rawName, flags));
    const foldedName = name.toLocaleLowerCase("en-US");
    if (names.has(foldedName)) unsafe("Tệp Excel chứa thành phần trùng tên.");
    if (foldedName.startsWith("xl/externallinks/")) unsafe("Tệp Excel chứa liên kết ngoài không được phép.");
    names.add(foldedName);

    if (localHeaderOffset + 30 > centralDirectoryOffset || view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
      unsafe("Header cục bộ của tệp Excel không hợp lệ.");
    }
    const localFlags = view.getUint16(localHeaderOffset + 6, true);
    const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const localDataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const localDataEnd = localDataOffset + compressedSize;
    if (
      localFlags !== flags || localCompressionMethod !== compressionMethod ||
      localNameLength !== fileNameLength || localDataEnd > centralDirectoryOffset
    ) {
      unsafe("Header cục bộ của tệp Excel không khớp.");
    }
    const localName = bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength);
    if (localName.some((value, nameIndex) => value !== rawName[nameIndex])) {
      unsafe("Tên thành phần trong header cục bộ không khớp.");
    }
    if (!(flags & 0x0008) && (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
      unsafe("Kích thước thành phần trong header cục bộ không khớp.");
    }
    localSegments.push([localHeaderOffset, localDataEnd]);

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) unsafe("Một thành phần trong tệp Excel vượt quá giới hạn.");
    totalSize += uncompressedSize;
    if (totalSize > MAX_TOTAL_UNCOMPRESSED_BYTES) unsafe("Kích thước giải nén của tệp Excel vượt quá giới hạn.");
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)) {
      unsafe("Tỷ lệ nén của tệp Excel vượt quá giới hạn an toàn.");
    }

    if (foldedName.endsWith(".xml") || foldedName.endsWith(".rels")) {
      if (uncompressedSize > MAX_SINGLE_XML_BYTES) unsafe("Một thành phần XML vượt quá giới hạn.");
      totalXmlSize += uncompressedSize;
      if (totalXmlSize > MAX_TOTAL_XML_BYTES) unsafe("Tổng kích thước XML vượt quá giới hạn.");
    }
    offset = nextOffset;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) unsafe("Thư mục thành phần của tệp Excel không khớp.");
  localSegments.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < localSegments.length; index += 1) {
    if (localSegments[index][0] < localSegments[index - 1][1]) unsafe("Các thành phần trong tệp Excel bị chồng lấn.");
  }
  for (const requiredPart of REQUIRED_XLSX_PARTS) {
    if (!names.has(requiredPart)) unsafe("Cấu trúc tệp Excel không hợp lệ.");
  }
}

function hasLegacyXlsSignature(bytes) {
  return LEGACY_XLS_SIGNATURE.every((value, index) => bytes[index] === value);
}

export async function readAndValidateExcelFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") unsafe("Không tìm thấy tệp Excel hợp lệ.");
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) unsafe("Tệp Excel phải có dung lượng từ 1 byte đến 10 MB.");

  const extension = String(file.name || "").split(".").pop().toLocaleLowerCase("en-US");
  if (extension !== "xlsx" && extension !== "xls") unsafe("Chỉ hỗ trợ tệp Excel .xlsx hoặc .xls.");
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength !== file.size) unsafe("Không thể đọc đầy đủ tệp Excel.");

  if (extension === "xlsx") {
    validateXlsxArchiveBytes(arrayBuffer);
  } else if (!hasLegacyXlsSignature(new Uint8Array(arrayBuffer))) {
    unsafe("Tệp .xls không có định dạng Excel hợp lệ.");
  }
  return arrayBuffer;
}
