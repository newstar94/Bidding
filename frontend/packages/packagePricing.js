import { parseVND, sumVND } from "../shared/formatters.js";
import { parseLotListStrict } from "./lotJsonParser.js";

export function derivePackagePrice({ phanLo, giaGoiThau = 0, phanLoList = [] } = {}) {
  if (phanLo !== "Có") return parseVND(giaGoiThau) ?? 0;
  const lots = parseLotListStrict(phanLoList, { context: "package_pricing_command" });
  return sumVND(lots.map((lot) => lot?.giaTriPhanLo ?? 0));
}
