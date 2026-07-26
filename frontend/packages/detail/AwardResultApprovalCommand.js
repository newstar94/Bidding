function valueOf(element, { trim = true } = {}) {
  const value = String(element?.value || "");
  return trim ? value.trim() : value;
}

function readApprovalRow(element, { pkg, model, isDirectOrSpecial }) {
  const status = valueOf(element.querySelector(".row-status-select"))
    || (isDirectOrSpecial ? "trung" : "truot");
  const awardPriceElement = element.querySelector(".row-gia-trung");
  const awardPriceRaw = valueOf(awardPriceElement, { trim: false });
  return {
    element,
    bidId: String(element.getAttribute("data-approve-bid-id") || ""),
    contractorId: String(element.getAttribute("data-nt-id") || ""),
    status,
    isWinner: status === "trung",
    contractorCode: valueOf(element.querySelector(".row-ma-nha-thau")),
    contractorName: valueOf(element.querySelector(".row-ten-nha-thau")),
    contractorType: valueOf(element.querySelector(".row-loai-nha-thau")) || "Độc lập",
    jointVentureMembers: Array.isArray(element._thanhVienLienDanh)
      ? element._thanhVienLienDanh
      : [],
    leadMemberContractorId: String(element._leadMemberContractorId || ""),
    leadMemberName: String(element._leadMemberName || ""),
    lotCode: pkg?.phanLo === "Có"
      ? valueOf(element.querySelector(".row-ma-phan-lo"))
        || String(element.cells?.[0]?.textContent || "").trim()
      : "",
    lotName: pkg?.phanLo === "Có"
      ? valueOf(element.querySelector(".row-ten-phan-lo"))
        || String(element.cells?.[1]?.textContent || "").trim()
      : "",
    awardPriceRaw,
    awardPrice: model.parseVND(awardPriceRaw),
    packageDuration: valueOf(element.querySelector(".row-tg-goithau")),
    contractDuration: valueOf(element.querySelector(".row-tg-hopdong")),
    rejectionReason: valueOf(element.querySelector(".row-ly-do-truot")),
  };
}

function requiredError(code, element, kind = "field") {
  return { code, element, kind };
}

export function prepareAwardApprovalCommand({
  root,
  pkg,
  model,
  isDirectOrSpecial = false,
} = {}) {
  if (!root?.querySelector || !model) {
    throw new TypeError("Award approval requires a rendered root and model.");
  }

  const appraisalNumberElement = root.querySelector("#award-so-bctd");
  const appraisalDateElement = root.querySelector("#award-ngay-bctd");
  const decisionNumberElement = root.querySelector("#award-decision-no");
  const decisionDateElement = root.querySelector("#award-decision-date");
  const appraisalNumber = valueOf(appraisalNumberElement);
  const appraisalRawDate = valueOf(appraisalDateElement, { trim: false });
  const decisionNumber = valueOf(decisionNumberElement);
  const decisionRawDate = valueOf(decisionDateElement, { trim: false });
  const tbody = root.querySelector("#approve-bidders-tbody");
  const rows = Array.from(tbody?.querySelectorAll?.("tr") || []).map((element) => (
    readApprovalRow(element, { pkg, model, isDirectOrSpecial })
  ));
  const winnerRows = rows.filter((row) => row.isWinner);
  const errors = [];

  if (appraisalNumberElement && !appraisalNumber) {
    errors.push(requiredError("appraisal_number_required", appraisalNumberElement));
  }
  if (appraisalDateElement && !appraisalRawDate) {
    errors.push(requiredError("appraisal_date_required", appraisalDateElement));
  }
  if (!decisionNumber) {
    errors.push(requiredError("decision_number_required", decisionNumberElement));
  }
  if (!decisionRawDate) {
    errors.push(requiredError("decision_date_required", decisionDateElement));
  }
  winnerRows.forEach((row) => {
    if (isDirectOrSpecial && !row.contractorCode) {
      errors.push(requiredError(
        "contractor_code_required",
        row.element.querySelector(".row-ma-nha-thau"),
        "winner",
      ));
    }
    if (isDirectOrSpecial && !row.contractorName) {
      errors.push(requiredError(
        "contractor_name_required",
        row.element.querySelector(".row-ten-nha-thau"),
        "winner",
      ));
    }
    if (!row.awardPriceRaw) {
      errors.push(requiredError(
        "award_price_required",
        row.element.querySelector(".row-gia-trung"),
        "winner",
      ));
    }
    if (!row.packageDuration) {
      errors.push(requiredError(
        "package_duration_required",
        row.element.querySelector(".row-tg-goithau"),
        "winner",
      ));
    }
    if (!row.contractDuration) {
      errors.push(requiredError(
        "contract_duration_required",
        row.element.querySelector(".row-tg-hopdong"),
        "winner",
      ));
    }
  });

  return {
    ok: errors.length === 0,
    isDirectOrSpecial,
    decision: {
      number: decisionNumber,
      date: model.convertDMYToYMD(decisionRawDate),
      rawDate: decisionRawDate,
      appraisalNumber,
      appraisalDate: model.convertDMYToYMD(appraisalRawDate),
      appraisalRawDate,
    },
    rows,
    winnerRows,
    errors,
  };
}
