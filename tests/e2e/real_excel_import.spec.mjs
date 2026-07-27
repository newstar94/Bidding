import path from "node:path";
import { expect, test } from "@playwright/test";

const realExcelDirectory = process.env.E2E_REAL_EXCEL_DIR;

const REAL_EXCEL_SCENARIOS = Object.freeze([
  {
    fileName: "Báo cáo đánh giá 1G1T không phân lô.xlsx",
    pkg: {
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
      phanLo: "Không",
    },
    bid: { loaiNhaThau: "Độc lập" },
    expectedGroups: ["validity", "capacity", "financial"],
    expectedSheets: { validity: "Mẫu số 01", capacity: "Mẫu số 02", financial: "Mẫu số 07B" },
  },
  {
    fileName: "Báo cáo đánh giá 1G1T Phân lô.xlsx",
    pkg: {
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
      phanLo: "Có",
    },
    bid: { loaiNhaThau: "Độc lập", maPhanLo: "PP2600239582" },
    expectedGroups: ["validity", "capacity", "financial"],
    expectedSheets: { validity: "Mẫu số 01", capacity: "Mẫu số 02A", financial: "Mẫu số 07B" },
  },
  {
    fileName: "Báo cáo đánh giá 1G2T Phân lô.xlsx",
    pkg: {
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
      phanLo: "Có",
    },
    bid: { loaiNhaThau: "Độc lập", maPhanLo: "PP2500456845" },
    expectedGroups: ["validity", "capacity"],
    expectedSheets: { validity: "Mẫu số 01", capacity: "Mẫu số 02A" },
  },
  {
    fileName: "Báo cáo đánh giá 1G2T Tài chính.xlsx",
    pkg: {
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
      phanLo: "Không",
    },
    bid: { loaiNhaThau: "Độc lập" },
    expectedGroups: ["financial"],
    expectedSheets: { financial: "Mẫu số 06C" },
  },
  {
    fileName: "Báo cáo đánh giá kỹ thuật - Tư vấn.xlsx",
    pkg: {
      linhVuc: "Tư vấn",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
      phanLo: "Không",
    },
    bid: { loaiNhaThau: "Độc lập" },
    expectedGroups: ["validity", "technical"],
    expectedSheets: { validity: "Mẫu số 01", technical: "Mẫu số 02" },
  },
  {
    fileName: "Báo cáo đánh giá tài chính - Tư vấn.xlsx",
    pkg: {
      linhVuc: "Tư vấn",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
      phanLo: "Không",
    },
    bid: { loaiNhaThau: "Độc lập" },
    expectedGroups: ["financial"],
    expectedSheets: { financial: "Mẫu số 02B" },
  },
]);

test.describe("nhập báo cáo MuaSắmCông thật", () => {
  test.skip(!realExcelDirectory, "Chỉ chạy khi E2E_REAL_EXCEL_DIR trỏ tới bộ file thật.");

  for (const scenario of REAL_EXCEL_SCENARIOS) {
    test(`nhận diện ${scenario.fileName}`, async ({ page }, testInfo) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "real-excel-file";
        input.type = "file";
        input.accept = ".xlsx,.xls";
        document.body.replaceChildren(input);
      });
      const filePath = path.join(realExcelDirectory || "", scenario.fileName);
      await page.locator("#real-excel-file").setInputFiles(filePath);

      const metrics = await page.evaluate(async ({ pkg, bid }) => {
        const file = document.querySelector("#real-excel-file")?.files?.[0];
        const reader = await import("/frontend/documents/excelFileReader.js");
        const parser = await import("/frontend/packages/detailedEvaluationExcel.js");
        const startedAt = performance.now();
        const sheets = await reader.readExcelWorkbookSheets(file);
        const readCompletedAt = performance.now();
        const groups = ["validity", "capacity", "technical", "financial"];
        const parsed = Object.fromEntries(groups.map((group) => {
          const groupStartedAt = performance.now();
          const result = parser.parseMuasamcongDetailedEvaluationWorkbook(sheets, {
            group,
            pkg,
            bid,
          });
          return [group, {
            durationMs: Math.round((performance.now() - groupStartedAt) * 10) / 10,
            recognized: Boolean(result),
            sheetName: result?.sheetName || null,
            criteriaCount: result?.criteria?.length || 0,
            matchCount: result?.matches?.length || 0,
            warningCount: result?.warnings?.length || 0,
          }];
        }));
        return {
          fileName: file.name,
          fileBytes: file.size,
          sheetCount: sheets.length,
          sheetNames: sheets.map((sheet) => sheet.name),
          rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
          readAndValidateMs: Math.round((readCompletedAt - startedAt) * 10) / 10,
          totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
          groups: parsed,
        };
      }, { pkg: scenario.pkg, bid: scenario.bid });

      const recognizedGroups = Object.entries(metrics.groups)
        .filter(([, result]) => result.recognized)
        .map(([group]) => group);
      await testInfo.attach("real-excel-import-metrics.json", {
        body: Buffer.from(JSON.stringify({ scenario, metrics }, null, 2)),
        contentType: "application/json",
      });
      expect(recognizedGroups).toEqual(scenario.expectedGroups);
      for (const group of scenario.expectedGroups) {
        expect(metrics.groups[group].criteriaCount).toBeGreaterThan(0);
        expect(metrics.groups[group].matchCount).toBe(metrics.groups[group].criteriaCount);
        expect(metrics.groups[group].sheetName).toBe(scenario.expectedSheets[group]);
        expect(metrics.groups[group].warningCount).toBe(0);
      }
      expect(metrics.totalMs).toBeLessThan(5_000);

    });
  }
});
