const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const verifyScript = path.join(root, "scripts", "verify_bidder_goods_e2e.cjs");
const configuredWorkbookDirectory = String(
  process.env.BIDDER_GOODS_E2E_WORKBOOK_DIR || "",
).trim();

const workbookCases = [
  {
    filename: "Dự thầu không phân lô.xlsx",
    rows: [
      ["STT", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      ["1", "Máy tính xách tay", "Bộ", 2, 10_000_000, 20_000_000],
      ["2", "Màn hình", "Cái", 3, 5_000_000, 15_000_000],
    ],
  },
  {
    filename: "Dự thầu 1 phân lô 1 mặt hàng.xlsx",
    rows: [
      ["STT", "Mã phần lô", "Tên phần lô", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      ["1", "L01", "Lô 01", "Máy in", "Cái", 1, 8_000_000, 8_000_000],
    ],
  },
  {
    filename: "Dự thầu 1 phân lô nhiều mặt hàng.xlsx",
    rows: [
      ["STT", "Mã phần lô", "Tên phần lô", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      ["1", "L01", "Lô 01", "Máy chủ", "Bộ", 1, 50_000_000, 50_000_000],
      ["2", "L01", "Lô 01", "Switch mạng", "Cái", 2, 10_000_000, 20_000_000],
    ],
  },
];

function loadXlsx() {
  const sheetModule = { exports: {} };
  const sheetExports = sheetModule.exports;
  const sheetRuntime = fs.readFileSync(
    path.join(root, "views", "vendor", "xlsx", "xlsx.full.min.js"),
    "utf8",
  );
  Function("module", "exports", "require", sheetRuntime)(sheetModule, sheetExports, require);
  return Object.keys(sheetModule.exports).length ? sheetModule.exports : sheetExports;
}

function createWorkbookFixtures(directory) {
  const XLSX = loadXlsx();
  fs.mkdirSync(directory, { recursive: true });
  for (const definition of workbookCases) {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(definition.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Mẫu số 12.1B. Bảng giá dự thầu");
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    fs.writeFileSync(path.join(directory, definition.filename), output);
  }
}

let temporaryWorkbookDirectory = null;
let workbookDirectory = configuredWorkbookDirectory;

try {
  if (!workbookDirectory) {
    temporaryWorkbookDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "biddingflow-bidder-goods-e2e-"),
    );
    workbookDirectory = temporaryWorkbookDirectory;
    createWorkbookFixtures(workbookDirectory);
    process.stdout.write(
      `[BIDDER-GOODS-E2E] Generated CI workbook fixtures in ${workbookDirectory}\n`,
    );
  } else {
    process.stdout.write(
      `[BIDDER-GOODS-E2E] Using configured workbook directory ${workbookDirectory}\n`,
    );
  }

  const execution = spawnSync(process.execPath, [verifyScript], {
    cwd: root,
    env: {
      ...process.env,
      BIDDER_GOODS_E2E_WORKBOOK_DIR: workbookDirectory,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (execution.error) throw execution.error;
  process.exitCode = execution.status ?? 1;
} finally {
  if (temporaryWorkbookDirectory) {
    fs.rmSync(temporaryWorkbookDirectory, { recursive: true, force: true });
  }
}
