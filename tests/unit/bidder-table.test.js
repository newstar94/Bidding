import test from "node:test";
import assert from "node:assert/strict";

import { renderBidContractorLink } from "../../frontend/packages/detail/BidderTable.js";

test("bidder table links independent contractors to their exact stored version", () => {
  const model = { state: { nhathau: [
    { id: "nt-00", rootId: "nt-root", phienBan: "00", maNhaThau: "VN01", tenNhaThau: "Tên <cũ>" },
    { id: "nt-01", rootId: "nt-root", phienBan: "01", maNhaThau: "VN01", tenNhaThau: "Tên mới" }
  ] } };
  const html = renderBidContractorLink(model, {
    nhaThauId: "nt-00", maNhaThau: "VN01", tenNhaThau: "Tên hồ sơ", loaiNhaThau: "Độc lập"
  }, "key");
  assert.match(html, /data-id="nt-00"/);
  assert.match(html, /Tên &lt;cũ&gt;/);
  assert.doesNotMatch(html, /Tên mới/);
});
