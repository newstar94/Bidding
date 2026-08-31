const ENDPOINT = "/api/admin/product-analytics/dashboard";
const VIEWS = [
  ["overview", "Overview"], ["activation", "Activation"], ["features", "Features"],
  ["seats", "Seats"], ["procurement", "Procurement"], ["credits", "Credits"],
  ["funnel", "Funnel"], ["retention", "Retention"], ["economics", "Economics"],
  ["plan-fit", "Plan fit"],
];

const numberFormat = new Intl.NumberFormat("vi-VN");
const moneyFormat = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const pendingRequests = new WeakMap();
const FILTER_KEYS = new Set([
  "from", "to", "view", "ownerKind", "variant", "releaseId", "releaseMode",
  "sizeBucket", "plan", "paidState", "cohortKind", "procurementIntensity",
  "collaborationIntensity", "aiAdoption", "page", "pageSize",
]);

function dateValue(daysAgo) {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  return value.toISOString().slice(0, 10);
}

function setDateControlValue(control, value) {
  if (!control) return;
  if (control._flatpickr?.setDate) control._flatpickr.setDate(value, false);
  else control.value = value;
}

export function buildProductAnalyticsUrl(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (FILTER_KEYS.has(key) && value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  return `${ENDPOINT}?${params.toString()}`;
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

function formatPercent(value) {
  return value == null ? "Not available" : `${(Number(value) * 100).toFixed(1)}%`;
}

function formatDuration(seconds) {
  if (seconds == null) return "Not available";
  const value = Number(seconds);
  if (value < 60) return `${numberFormat.format(Math.round(value))} giây`;
  if (value < 3600) return `${(value / 60).toFixed(1)} phút`;
  if (value < 86400) return `${(value / 3600).toFixed(1)} giờ`;
  return `${(value / 86400).toFixed(1)} ngày`;
}

function displayMetric(key, value) {
  if (value == null) return "Not available";
  if (/rate|percent|utilization/iu.test(key || "")) return formatPercent(value);
  if (/seconds/iu.test(key || "")) return formatDuration(value);
  if (/vnd|revenue|margin|cost|refund/iu.test(key || "")) return moneyFormat.format(value || 0);
  return numberFormat.format(value || 0);
}

function displaySampleCount(value) {
  return value == null ? "Insufficient sample" : numberFormat.format(value);
}

function displayConfiguredCost(cost = {}) {
  return cost.status === "available" ? moneyFormat.format(cost.estimatedCostVnd) : "Not configured";
}

function displayTiming(status, seconds) {
  if (status === "available") return formatDuration(seconds);
  if (status === "insufficient_sample") return "Insufficient sample";
  return "Not available";
}

function displayAvailabilityLabel(status) {
  if (status === "available") return "available";
  if (status === "insufficient_sample") return "insufficient sample";
  return "not available";
}

function renderFunnelTimingEvidence(visual, timings = []) {
  for (const timing of timings) {
    const item = document.createElement("div"); item.className = "product-analytics__evidence-item";
    item.textContent = `${timing.fromStage} → ${timing.toStage}: ${displayTiming(timing.status, timing.medianSeconds)}`;
    visual.append(item);
  }
}

function renderKpis(root, kpis = []) {
  const target = root.querySelector("#product-analytics-kpis");
  if (!target) return;
  target.replaceChildren(...kpis.map((kpi) => {
    const article = document.createElement("article");
    article.className = "product-analytics__kpi";
    article.classList.add(`product-analytics__kpi--${["positive", "negative"].includes(kpi.changeState) ? kpi.changeState : "neutral"}`);
    const label = document.createElement("span"); label.textContent = kpi.label;
    const value = document.createElement("strong");
    value.textContent = displayMetric(kpi.key, kpi.value);
    const period = document.createElement("small");
    if (kpi.sampleStatus === "insufficient_sample") period.textContent = "Insufficient sample";
    else if (kpi.change == null) period.textContent = "Không có kỳ so sánh";
    else if (kpi.changeKind === "percentage_point") period.textContent = `${(Number(kpi.change) * 100).toFixed(1)} điểm % so với kỳ trước`;
    else period.textContent = `${formatPercent(kpi.change)} so với kỳ trước`;
    article.title = kpi.definition || kpi.label;
    article.append(label, value, period);
    return article;
  }));
}

function renderOverviewChart(target, chart) {
  const section = document.createElement("section"); section.className = "product-analytics__mini-chart";
  const title = document.createElement("h4"); title.textContent = chart.label; section.append(title);
  if (!(chart.series || []).some((series) => (series.points || []).length)) {
    const empty = document.createElement("p"); empty.className = "product-analytics__summary";
    empty.textContent = "Chưa đủ dữ liệu trong khoảng thời gian này.";
    section.append(empty); target.append(section); return;
  }
  const allValues = (chart.series || []).flatMap((series) => series.points || [])
    .map((point) => Math.abs(Number(point.value))).filter(Number.isFinite);
  const max = Math.max(1, ...allValues);
  for (const series of chart.series || []) {
    const seriesLabel = document.createElement("span"); seriesLabel.className = "product-analytics__mini-chart-label"; seriesLabel.textContent = series.label; section.append(seriesLabel);
    const bars = document.createElement("div"); bars.className = "product-analytics__mini-bars";
    for (const point of (series.points || []).slice(-31)) {
      const bar = document.createElement("span"); bar.className = "product-analytics__mini-bar";
      const pointLabel = point.date || point.label || "—";
      const metricKey = `${chart.key}_${series.key}`;
      const formatChartValue = (value) => /adoption|utilization|conversion|retention/iu.test(metricKey) ? formatPercent(value) : displayMetric(metricKey, value);
      if (point.value == null) {
        bar.classList.add("is-unavailable"); bar.style.setProperty("--bar-height", "4%");
        bar.title = `${pointLabel}: Insufficient sample`;
      } else {
        bar.style.setProperty("--bar-height", `${Math.max(4, (Math.abs(Number(point.value || 0)) / max) * 100)}%`);
        if (Number(point.value) < 0) bar.classList.add("is-negative");
        bar.title = `${pointLabel}: ${formatChartValue(point.value)}`;
      }
      bar.setAttribute("role", "img"); bar.setAttribute("aria-label", bar.title); bar.tabIndex = 0; bars.append(bar);
    }
    section.append(bars);
  }
  const details = document.createElement("details"); details.className = "product-analytics__fallback";
  const summary = document.createElement("summary"); summary.textContent = "Xem bảng dữ liệu"; details.append(summary);
  const table = document.createElement("table"); const head = document.createElement("thead"); const headRow = document.createElement("tr");
  for (const label of ["Mốc", ...(chart.series || []).map((series) => series.label)]) {
    const cell = document.createElement("th"); cell.textContent = label; headRow.append(cell);
  }
  head.append(headRow); table.append(head);
  const body = document.createElement("tbody");
  const pointLabels = [...new Set((chart.series || []).flatMap((series) => (series.points || []).map((point) => point.date || point.label || "—")))];
  for (const label of pointLabels.slice(-31)) {
    const row = document.createElement("tr"); const name = document.createElement("td"); name.textContent = label; row.append(name);
    for (const series of chart.series || []) {
      const point = (series.points || []).find((candidate) => (candidate.date || candidate.label || "—") === label);
      const metricKey = `${chart.key}_${series.key}`;
      const cell = document.createElement("td"); cell.textContent = point?.value == null ? "Not available" : (/adoption|utilization|conversion|retention/iu.test(metricKey) ? formatPercent(point.value) : displayMetric(metricKey, point.value)); row.append(cell);
    }
    body.append(row);
  }
  table.append(body); details.append(table); section.append(details); target.append(section);
}

function renderTrend(root, series = []) {
  const target = root.querySelector("#product-analytics-trend");
  if (!target) return;
  target.replaceChildren();
  if (!(series || []).some((item) => (item.points || []).length)) {
    const empty = document.createElement("p"); empty.className = "product-analytics__summary";
    empty.textContent = "Chưa đủ dữ liệu trend trong khoảng thời gian này.";
    target.append(empty);
    root.querySelector("#product-analytics-trend-table-body")?.replaceChildren();
    return;
  }
  const values = series.flatMap((item) => item.points || []).map((item) => Number(item.value || 0));
  const max = Math.max(1, ...values);
  const chart = document.createElement("div"); chart.className = "product-analytics__bars";
  for (const point of (series[0]?.points || []).slice(-31)) {
    const bar = document.createElement("span");
    bar.className = "product-analytics__bar";
    bar.style.setProperty("--bar-height", `${Math.max(4, (Number(point.value || 0) / max) * 100)}%`);
    bar.title = `${point.date}: ${numberFormat.format(point.value || 0)}`;
    bar.setAttribute("aria-label", `${point.date}: ${numberFormat.format(point.value || 0)}`);
    bar.setAttribute("role", "img"); bar.tabIndex = 0;
    chart.append(bar);
  }
  target.append(chart);
  const fallback = root.querySelector("#product-analytics-trend-table-body");
  if (fallback) {
    fallback.replaceChildren(...(series[0]?.points || []).slice(-31).map((point) => {
      const row = document.createElement("tr");
      const day = document.createElement("td"); day.textContent = point.date;
      const value = document.createElement("td"); value.textContent = numberFormat.format(point.value || 0);
      row.append(day, value); return row;
    }));
  }
}

function renderSegments(root, segments = []) {
  const target = root.querySelector("#product-analytics-segments");
  if (!target) return;
  target.replaceChildren(...segments.slice(0, 12).map((segment) => {
    const row = document.createElement("div"); row.className = "product-analytics__segment";
    const label = document.createElement("span"); label.textContent = segment.feature || segment.classification || segment.segment || "—";
    const value = document.createElement("strong");
    value.textContent = segment.suppressed ? "Insufficient sample" : numberFormat.format(segment.eventCount ?? segment.workspaceCount ?? 0);
    row.append(label, value); return row;
  }));
}

function renderEconomics(root, economics = {}) {
  const target = root.querySelector("#product-analytics-economics");
  if (!target) return;
  target.replaceChildren();
  for (const [label, key] of [["Gross revenue", "grossRevenueVnd"], ["Net settled", "netSettledRevenueVnd"], ["Top-up revenue", "topupRevenueVnd"], ["Refunds", "refundAmountVnd"], ["Variable cost", "estimatedVariableCostVnd"], ["Contribution margin", "contributionMarginVnd"]]) {
    const item = document.createElement("div"); item.className = "product-analytics__economics-item";
    const name = document.createElement("span"); name.textContent = label;
    const amount = document.createElement("strong"); amount.textContent = displayMetric(key, economics[key]);
    item.append(name, amount); target.append(item);
  }
}

function renderFunnel(root, funnel = []) {
  const target = root.querySelector("#product-analytics-funnel");
  if (!target) return;
  target.replaceChildren(...funnel.map((stage) => {
    const item = document.createElement("div"); item.className = "product-analytics__funnel-stage";
    const label = document.createElement("span"); label.textContent = stage.stage;
    const value = document.createElement("strong"); value.textContent = numberFormat.format(stage.uniqueWorkspaces ?? stage.count ?? 0);
    const timing = stage.timingStatus === "available"
      ? ` · P50 ${formatDuration(stage.medianSecondsFromPriorStage)}`
      : stage.timingStatus === "insufficient_sample" ? " · Insufficient sample" : "";
    const rate = document.createElement("small"); rate.textContent = `${stage.stepConversionRate == null ? "Bước đầu" : `${formatPercent(stage.stepConversionRate)} · bỏ ${formatPercent(stage.abandonmentRate)}`}${timing}`;
    item.append(label, value, rate); return item;
  }));
}

function renderDataTable(root, columns = [], rows = []) {
  const table = root.querySelector("#product-analytics-detail-table");
  const head = root.querySelector("#product-analytics-detail-table-head");
  const body = root.querySelector("#product-analytics-detail-table-body");
  if (!table || !head || !body) return;
  table.hidden = !columns.length;
  head.replaceChildren(...columns.map(([key, label]) => {
    const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; cell.dataset.key = key; return cell;
  }));
  body.replaceChildren(...rows.slice(0, 200).map((source) => {
    const row = document.createElement("tr");
    for (const [key] of columns) {
      const cell = document.createElement("td");
      const value = source?.[key];
      cell.textContent = source?.suppressed && value == null
        ? "Insufficient sample"
        : (typeof value === "number" ? displayMetric(key, value) : String(value ?? "Not available"));
      row.append(cell);
    }
    return row;
  }));
}

function renderPagination(root, pagination = null) {
  const nav = root.querySelector("#product-analytics-pagination");
  const previous = root.querySelector("#product-analytics-previous");
  const next = root.querySelector("#product-analytics-next");
  if (!nav || !previous || !next) return;
  const visible = pagination && pagination.totalRows > pagination.pageSize;
  nav.hidden = !visible;
  previous.disabled = !pagination?.hasPrevious;
  next.disabled = !pagination?.hasNext;
  setText(root, "#product-analytics-page-status", `Trang ${pagination?.page || 1} / ${pagination?.pageCount || 1} · ${numberFormat.format(pagination?.totalRows || 0)} dòng`);
}

function renderDetailed(root, dashboard = {}) {
  const title = root.querySelector("#product-analytics-detail-title");
  const summary = root.querySelector("#product-analytics-detail-summary");
  const visual = root.querySelector("#product-analytics-detail-visual");
  if (!title || !summary || !visual) return;
  visual.replaceChildren();
  const view = dashboard.view || "overview";
  const titles = {
    overview: "Commercial signals", activation: "Activation journey", features: "Feature adoption & association",
    seats: "Seat distribution & tier pressure", procurement: "Procurement economics",
    credits: "Credit pack behavior", funnel: "Stage conversion & abandonment",
    retention: "Mature retention cohorts", economics: "Revenue, cost & contribution margin",
    "plan-fit": "Analytical plan fit",
  };
  title.textContent = titles[view] || "Detailed evidence";
  summary.textContent = dashboard.correlationDisclaimer || "Dữ liệu aggregate, múi giờ Asia/Ho_Chi_Minh.";
  let columns = []; let tableRows = dashboard.table || [];

  if (view !== "overview") {
    for (const chart of dashboard.viewCharts || []) renderOverviewChart(visual, chart);
  }

  if (view === "overview") {
    for (const chart of dashboard.overviewCharts || []) renderOverviewChart(visual, chart);
    const insights = dashboard.insights || [];
    const insightPanel = document.createElement("section"); insightPanel.className = "product-analytics__insights";
    const heading = document.createElement("h4"); heading.textContent = "Threshold insights"; insightPanel.append(heading);
    if (!insights.length) {
      const empty = document.createElement("p"); empty.textContent = "No threshold signal in the selected range."; insightPanel.append(empty);
    }
    for (const insight of insights) {
      const item = document.createElement("div"); item.className = "product-analytics__evidence-item";
      item.textContent = insight.message; item.title = insight.basis || "Fixed aggregate threshold"; insightPanel.append(item);
    }
    visual.append(insightPanel);
    summary.textContent = "Descriptive signals use fixed aggregate thresholds; they are not pricing recommendations or automated actions.";
  } else if (view === "activation" && dashboard.activation) {
    for (const stage of dashboard.activation.funnel || []) {
      const item = document.createElement("div"); item.className = "product-analytics__evidence-item";
      item.textContent = `${stage.stage}: ${displaySampleCount(stage.workspaceCount)}`; visual.append(item);
    }
    for (const [label, value] of Object.entries(dashboard.activation.retention || {})) {
      const item = document.createElement("div"); item.className = "product-analytics__evidence-item";
      item.textContent = `${label}: ${value.status === "available" ? formatPercent(value.rate) : "Insufficient sample"}`; visual.append(item);
    }
    summary.textContent = `TTFV P50 ${formatDuration(dashboard.activation.ttfv?.medianSeconds)}, P75 ${formatDuration(dashboard.activation.ttfv?.p75Seconds)}, P90 ${formatDuration(dashboard.activation.ttfv?.p90Seconds)}. Timestamp xác minh lịch sử thiếu: ${numberFormat.format(dashboard.activation.verification?.historicalTimestampUnavailable || 0)}.`;
  } else if (view === "features") {
    columns = [["feature", "Feature"], ["activeUsers", "Active users"], ["workspaceCount", "Active workspaces"], ["eventCount", "Usage"], ["usageFrequency", "Usage/workspace"], ["adoptionRate", "Adoption"], ["medianUsagePerWorkspace", "Median/workspace"]];
    tableRows = dashboard.table || dashboard.segments || [];
    summary.textContent = "Association is descriptive and cohort-suppressed. Correlation does not imply causation.";
  } else if (view === "seats") {
    for (const bin of dashboard.seatDistribution || []) {
      const item = document.createElement("div"); item.className = "product-analytics__distribution-bin";
      const label = document.createElement("span"); label.textContent = String(bin.segment).replaceAll("_", "–");
      const value = document.createElement("strong"); value.textContent = bin.suppressed ? "Insufficient sample" : numberFormat.format(bin.workspaceCount || 0);
      item.append(label, value); visual.append(item);
    }
    const percentiles = document.createElement("p"); percentiles.className = "product-analytics__percentiles";
    percentiles.textContent = Object.entries(dashboard.seatPercentiles || {}).map(([key, value]) => `${key} ${value ?? "—"}`).join(" · "); visual.append(percentiles);
    const markers = document.createElement("p"); markers.className = "product-analytics__tier-markers"; markers.textContent = `Mốc tier: ${(dashboard.tierMarkers || []).join(" / ")}`; visual.append(markers);
    columns = [["currentTier", "Current tier"], ["workspaceCount", "Workspaces"], ["medianActiveSeats", "Median active"], ["p90ActiveSeats", "P90 active"], ["medianSeatUtilization", "Median utilization"], ["atOrAbove80Percent", "≥80%"], ["overLimit", "Over limit"]];
    tableRows = dashboard.tierTable || [];
  } else if (view === "procurement" && dashboard.procurement) {
    const quota = dashboard.procurement.quotaUtilization || {};
    const externalCost = dashboard.procurement.externalCost || {};
    summary.textContent = `Quota coverage ${numberFormat.format(quota.workspaceCount || 0)} workspaces · ≥80%: ${numberFormat.format(quota.atOrAbove80Percent || 0)} · >100%: ${numberFormat.format(quota.over100Percent || 0)}. External cost: ${displayConfiguredCost(externalCost)}. Cache hit: not available.`;
    columns = [["metric", "Percentile"], ["value", "Successful fetches/workspace"]];
  } else if (view === "credits" && dashboard.credits) {
    for (const pack of dashboard.credits.packSalesMix || []) {
      const item = document.createElement("div"); item.className = "product-analytics__evidence-item";
      item.textContent = `${numberFormat.format(pack.packSize)} credits · ${numberFormat.format(pack.purchaseCount)} purchases · ${moneyFormat.format(pack.revenueVnd)}`; visual.append(item);
    }
    summary.textContent = `Consumed ${numberFormat.format(dashboard.credits.purchasedCreditsConsumed || 0)} purchased credits · expired unused ${numberFormat.format(dashboard.credits.expiredUnusedCredits?.value || 0)} · repeat top-up ${formatPercent(dashboard.credits.repeatTopupRate)} · median ${dashboard.credits.medianDaysBetweenTopups ?? "not available"} ngày · tín hiệu 4 lần/45 ngày: ${numberFormat.format(dashboard.credits.smallPack45DaySignals?.length || 0)}.`;
    columns = [["packSize", "Pack"], ["purchaseCount", "Purchases"], ["creditsPurchased", "Credits"], ["revenueVnd", "Revenue"], ["unusedCredits", "Unused"]];
  } else if (view === "funnel") {
    columns = [["stage", "Stage"], ["releaseId", "Release"], ["ownerKind", "Owner"], ["sizeBucket", "Size"], ["skuCode", "SKU"], ["variant", "Variant"], ["plan", "Plan"], ["workspaceCount", "Workspaces"], ["eventCount", "Events"]];
    tableRows = dashboard.table || dashboard.funnelBreakdown || [];
    const outcomes = dashboard.funnelOutcomes || {};
    const timingStatus = dashboard.funnelSummary?.stageTimingStatus;
    const timingLabel = displayAvailabilityLabel(timingStatus);
    summary.textContent = `Payment failures ${numberFormat.format(outcomes.paymentFailures || 0)} · activation failures ${numberFormat.format(outcomes.activationFailures || 0)} · refunds ${numberFormat.format(outcomes.refunds || 0)} · paid TTFV P50 ${formatDuration(outcomes.paidTtfv?.medianSeconds)}. Stage timing: ${timingLabel}.`;
    renderFunnelTimingEvidence(visual, dashboard.funnelSummary?.stageTimings);
  } else if (view === "retention") {
    columns = [["cohortKind", "Cohort"], ["cohort", "Week"], ["weekNumber", "Retention week"], ["workspaceCount", "Workspaces"], ["retainedWorkspaces", "Retained"], ["retentionRate", "Rate"]];
    tableRows = dashboard.cohorts || [];
    summary.textContent = "Only mature W1/W2/W4/W8/W12 observations are shown; heartbeat is excluded.";
  } else if (view === "economics") {
    columns = [["tier", "Tier"], ["grossRevenueVnd", "Gross"], ["refundAmountVnd", "Refunds"], ["netRevenueVnd", "Net"], ["variableCostVnd", "Variable cost"], ["costStatus", "Cost status"], ["contributionMarginVnd", "Margin"], ["contributionMarginRate", "Margin %"]];
    tableRows = dashboard.economicsByTier || [];
    summary.textContent = "Estimated costs are labelled as estimates; unconfigured sources are not treated as accounting actuals.";
  } else if (view === "plan-fit") {
    columns = [["snapshot_month", "Month"], ["classification", "Classification"], ["plan_code", "Plan"], ["variant", "Variant"], ["active_seats", "Active seats"], ["seat_utilization", "Seat utilization"], ["procurement_usage", "Procurement"], ["quota_utilization", "Quota utilization"], ["repeat_topups", "Repeat top-ups"], ["topup_spend_vnd", "Top-up spend"], ["estimated_cost_vnd", "Estimated cost"], ["cost_status", "Cost status"], ["revenue_status", "Revenue status"], ["days_to_break_even", "Break-even days"]];
    tableRows = dashboard.planFitDetails || [];
    summary.textContent = "Recommendations are analytical only. No plan, quota, entitlement or subscription is changed automatically.";
  }
  renderDataTable(root, columns, tableRows);
}

function renderAi(root, ai = {}) {
  const target = root.querySelector("#product-analytics-ai");
  if (!target) return;
  const percent = (value) => value == null ? "Chưa đủ feedback" : `${(Number(value) * 100).toFixed(1)}%`;
  const metrics = [
    ["AI-active workspaces", numberFormat.format(ai.activeWorkspaces || 0)],
    ["Requests", numberFormat.format(ai.requests || 0)],
    ["Requests / AI-active workspace", ai.requestsPerActiveWorkspace == null ? "Not available" : numberFormat.format(ai.requestsPerActiveWorkspace)],
    ["Tool calls", numberFormat.format(ai.toolCalls || 0)],
    ["Estimated AI cost", ai.estimatedCostStatus === "available" ? moneyFormat.format(ai.estimatedCostVnd || 0) : "Not configured"],
    ["Helpful rate", percent(ai.helpfulRate)],
    ["Too slow rate", percent(ai.tooSlowRate)],
    ["Incorrect / missing source", percent(ai.incorrectOrMissingSourceRate)],
    ["Retention association", ai.retentionAssociation?.status === "available" ? `${Number(ai.retentionAssociation.percentagePointDifference).toFixed(1)} điểm %` : "Insufficient sample"],
    ["Paid conversion association", ai.paidConversionAssociation?.status === "available" ? `${Number(ai.paidConversionAssociation.percentagePointDifference).toFixed(1)} điểm %` : "Insufficient sample"],
  ];
  target.replaceChildren(...metrics.map(([label, display]) => {
    const item = document.createElement("div"); item.className = "product-analytics__economics-item";
    const name = document.createElement("span"); name.textContent = label;
    const value = document.createElement("strong"); value.textContent = display;
    item.append(name, value); return item;
  }));
}

export async function loadProductAnalytics(root, options = {}) {
  const from = root.querySelector("#product-analytics-from")?.value || dateValue(29);
  const to = root.querySelector("#product-analytics-to")?.value || dateValue(0);
  const view = root.querySelector("[data-product-view].is-active")?.dataset.productView || "overview";
  const filters = {
    from, to, view, page: Number(root.dataset.productAnalyticsPage || 1), pageSize: 50,
    ownerKind: root.querySelector("#product-analytics-owner")?.value,
    variant: root.querySelector("#product-analytics-variant")?.value,
    releaseId: root.querySelector("#product-analytics-release")?.value,
    releaseMode: root.querySelector("#product-analytics-release-mode")?.value,
    sizeBucket: root.querySelector("#product-analytics-size")?.value,
    plan: root.querySelector("#product-analytics-plan")?.value,
    paidState: root.querySelector("#product-analytics-paid")?.value,
    cohortKind: root.querySelector("#product-analytics-cohort")?.value,
    procurementIntensity: root.querySelector("#product-analytics-procurement-intensity")?.value,
    collaborationIntensity: root.querySelector("#product-analytics-collaboration")?.value,
    aiAdoption: root.querySelector("#product-analytics-ai-adoption")?.value,
  };
  const loading = root.querySelector("#product-analytics-loading");
  const error = root.querySelector("#product-analytics-error");
  const empty = root.querySelector("#product-analytics-empty");
  const content = root.querySelector("#product-analytics-content");
  pendingRequests.get(root)?.abort();
  const abortController = new AbortController();
  pendingRequests.set(root, abortController);
  loading?.removeAttribute("hidden"); error?.setAttribute("hidden", ""); empty?.setAttribute("hidden", ""); content?.setAttribute("hidden", "");
  try {
    const url = buildProductAnalyticsUrl(filters);
    if (options.updateUrl !== false && globalThis.history?.replaceState) {
      const shareable = new URL(globalThis.location?.href || "http://localhost/");
      for (const key of ["from", "to", "view", "ownerKind", "variant", "releaseId", "releaseMode", "sizeBucket", "plan", "paidState", "cohortKind", "procurementIntensity", "collaborationIntensity", "aiAdoption", "page"]) {
        if (filters[key]) shareable.searchParams.set(`analytics_${key}`, filters[key]);
        else shareable.searchParams.delete(`analytics_${key}`);
      }
      globalThis.history.replaceState(null, "", `${shareable.pathname}${shareable.search}${shareable.hash}`);
    }
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: abortController.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Không thể tải analytics.");
    const dashboard = payload.dashboard || {};
    if (!dashboard.hasData) { empty?.removeAttribute("hidden"); setText(root, "#product-analytics-empty-message", dashboard.message || "Chưa đủ dữ liệu trong khoảng thời gian này."); return dashboard; }
    content?.removeAttribute("hidden"); renderKpis(root, dashboard.kpis); renderTrend(root, dashboard.series); renderSegments(root, dashboard.segments); renderEconomics(root, dashboard.economics); renderFunnel(root, dashboard.funnel); renderAi(root, dashboard.ai); renderDetailed(root, dashboard); renderPagination(root, dashboard.pagination);
    setText(root, "#product-analytics-updated", dashboard.updatedAt ? `Cập nhật ${dashboard.updatedAt}` : "Đã cập nhật");
    return dashboard;
  } catch (cause) {
    if (cause?.name === "AbortError") return null;
    error?.removeAttribute("hidden"); setText(root, "#product-analytics-error-message", cause?.message || "Vui lòng thử lại.");
    return null;
  } finally { loading?.setAttribute("hidden", ""); }
}

export function mountProductAnalytics(root, controller) {
  if (!root || root.dataset.productAnalyticsBound === "true") return;
  root.dataset.productAnalyticsBound = "true";
  const search = new URLSearchParams(globalThis.location?.search || "");
  root.dataset.productAnalyticsPage = String(Math.max(1, Number(search.get("analytics_page") || 1) || 1));
  const from = root.querySelector("#product-analytics-from"); if (from && !from.value) setDateControlValue(from, search.get("analytics_from") || dateValue(29));
  const to = root.querySelector("#product-analytics-to"); if (to && !to.value) setDateControlValue(to, search.get("analytics_to") || dateValue(0));
  for (const [id, key] of [["owner", "ownerKind"], ["variant", "variant"], ["release", "releaseId"], ["release-mode", "releaseMode"], ["size", "sizeBucket"], ["plan", "plan"], ["paid", "paidState"], ["cohort", "cohortKind"], ["procurement-intensity", "procurementIntensity"], ["collaboration", "collaborationIntensity"], ["ai-adoption", "aiAdoption"]]) {
    const element = root.querySelector(`#product-analytics-${id}`);
    const value = search.get(`analytics_${key}`);
    if (element && value) element.value = value;
  }
  const initialView = search.get("analytics_view");
  if (initialView && VIEWS.some(([key]) => key === initialView)) {
    root.querySelectorAll("[data-product-view]").forEach((item) => item.classList.toggle("is-active", item.dataset.productView === initialView));
  }
  root.querySelectorAll("[data-product-view]").forEach((button) => button.addEventListener("click", () => {
    root.dataset.productAnalyticsPage = "1";
    root.querySelectorAll("[data-product-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    void loadProductAnalytics(root, controller);
  }));
  root.querySelector("#product-analytics-filter-form")?.addEventListener("submit", (event) => { event.preventDefault(); root.dataset.productAnalyticsPage = "1"; void loadProductAnalytics(root, controller); });
  root.querySelectorAll("[data-product-range]").forEach((button) => button.addEventListener("click", () => {
    const days = Number(button.dataset.productRange || 30);
    setDateControlValue(from, dateValue(days - 1));
    setDateControlValue(to, dateValue(0));
    root.dataset.productAnalyticsPage = "1";
    void loadProductAnalytics(root, controller);
  }));
  root.querySelector("#product-analytics-previous")?.addEventListener("click", () => {
    root.dataset.productAnalyticsPage = String(Math.max(1, Number(root.dataset.productAnalyticsPage || 1) - 1));
    void loadProductAnalytics(root, controller);
  });
  root.querySelector("#product-analytics-next")?.addEventListener("click", () => {
    root.dataset.productAnalyticsPage = String(Number(root.dataset.productAnalyticsPage || 1) + 1);
    void loadProductAnalytics(root, controller);
  });
  root.querySelector("#product-analytics-retry")?.addEventListener("click", () => void loadProductAnalytics(root, controller));
  void loadProductAnalytics(root, controller);
}
