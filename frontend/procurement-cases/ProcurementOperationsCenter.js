import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const CSS_URL = new URL("./ProcurementOperationsCenter.css", import.meta.url).pathname;
const ACTION_LABELS = Object.freeze({
  ASSIGN: "Phân công", START_REVIEW: "Bắt đầu kiểm tra",
  DRAFT_RESPONSE: "Chuyển sang dự thảo", SUBMIT_REVIEW: "Gửi duyệt",
  RETURN: "Trả lại", APPROVE: "Phê duyệt", ISSUE: "Phát hành",
  CLOSE: "Đóng", REJECT: "Từ chối", WITHDRAW: "Rút hồ sơ",
  REOPEN: "Mở lại", SAVE_RESPONSE: "Lưu nội dung mới",
  SET_DUE_DATE: "Đặt hạn xử lý",
  ADD_PARTY: "Thêm bên liên quan", ADD_LEGAL_BASIS: "Thêm căn cứ pháp lý",
  ADD_ATTACHMENT: "Tải tệp đính kèm",
});
const ACTION_PATHS = Object.freeze({
  ASSIGN: "assign", START_REVIEW: "start-review", DRAFT_RESPONSE: "draft-response",
  SUBMIT_REVIEW: "submit-review", RETURN: "return", APPROVE: "approve",
  ISSUE: "issue", CLOSE: "close", REJECT: "reject", WITHDRAW: "withdraw",
  REOPEN: "reopen",
});

export function normalizeCaseFilters(value = {}) {
  const type = ["CLARIFICATION", "PETITION"].includes(value.caseType) ? value.caseType : "";
  return { caseType: type, state: String(value.state || "").trim() };
}

export function availableCaseActions(value) {
  return Array.isArray(value?.availableActions)
    ? value.availableActions.filter((key) => Object.hasOwn(ACTION_LABELS, key)) : [];
}

export function normalizeCalendarConnections(payload = {}) {
  const allowedProviders = new Set(["GOOGLE", "MICROSOFT"]);
  const allowedStatuses = new Set(["ACTIVE", "REAUTH_REQUIRED", "REVOKED"]);
  return (Array.isArray(payload.connections) ? payload.connections : [])
    .filter((item) => item?.id && allowedProviders.has(item.provider) && allowedStatuses.has(item.status))
    .map((item) => ({
      id: String(item.id),
      provider: item.provider,
      calendarId: String(item.calendarId || ""),
      accountLabel: String(item.accountLabel || ""),
      status: item.status,
      scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : [],
      outboundProfileVersion: String(item.outboundProfileVersion || ""),
      tokenExpiresAt: Number.isFinite(item.tokenExpiresAt) ? item.tokenExpiresAt : null,
      consentedAt: Number.isFinite(item.consentedAt) ? item.consentedAt : null,
    }));
}

export function normalizeCalendarDeliveries(payload = {}) {
  const statuses = new Set(["PENDING", "PROCESSING", "RETRY", "DELIVERED", "FAILED"]);
  return (Array.isArray(payload.deliveries) ? payload.deliveries : [])
    .filter((item) => item?.id && item?.connectionId && statuses.has(item.status))
    .map((item) => ({
      id: String(item.id), connectionId: String(item.connectionId),
      provider: String(item.provider || ""), action: String(item.action || ""),
      status: item.status, attemptCount: Number(item.attemptCount || 0),
      lastErrorCode: item.lastErrorCode ? String(item.lastErrorCode) : null,
      eventSequence: Number(item.eventSequence || 0),
      createdAt: Number(item.createdAt || 0), updatedAt: Number(item.updatedAt || 0),
    }));
}

function element(tag, attrs = {}, text = "") {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("data-")) node.setAttribute(key, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

async function jsonRequest(url, options = {}) {
  const response = await apiFetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.code || payload.error || "REQUEST_FAILED");
  return payload;
}

class ProcurementOperationsCenter {
  constructor(root, packages) {
    this.root = root;
    this.packages = (packages || []).filter((item) => item?.id && !item?.archivedAt);
    this.cases = [];
    this.current = null;
  }

  async mount() {
    const enabled = (name) => document.querySelector(`meta[name="${name}"]`)?.content === "true";
    const caseEnabled = enabled("bf-procurement-case-enabled");
    const calendarEnabled = enabled("bf-work-calendar-enabled");
    this.connectorEnabled = enabled("bf-work-calendar-connectors-enabled");
    this.googleCalendarEnabled = enabled("bf-work-calendar-google-enabled");
    this.microsoftCalendarEnabled = enabled("bf-work-calendar-microsoft-enabled");
    const bulkEnabled = enabled("bf-bulk-export-enabled");
    this.root.querySelector('[data-center-tab="cases"]').hidden = !caseEnabled;
    this.root.querySelector('[data-center-tab="calendar"]').hidden = !calendarEnabled;
    this.root.querySelector('[data-center-tab="bulk"]').hidden = !bulkEnabled;
    this.root.querySelectorAll("[data-center-tab]").forEach((button) => {
      button.addEventListener("click", () => this.selectPanel(button.dataset.centerTab));
    });
    if (caseEnabled) this.renderCases();
    if (calendarEnabled) this.renderCalendar();
    if (bulkEnabled) this.renderBulk();
    const first = caseEnabled ? "cases" : calendarEnabled ? "calendar" : bulkEnabled ? "bulk" : null;
    if (first) this.selectPanel(first);
    else this.root.append(element("p", { class: "pc-card" }, "Các tính năng trung tâm hiện đang tắt."));
    if (caseEnabled) await this.loadCases();
  }

  selectPanel(name) {
    this.root.querySelectorAll("[data-center-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.centerTab === name));
    });
    this.root.querySelectorAll("[data-center-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.centerPanel !== name;
    });
  }

  renderCases() {
    const panel = this.root.querySelector('[data-center-panel="cases"]');
    panel.replaceChildren();
    const card = element("div", { class: "pc-card" });
    const toolbar = element("div", { class: "pc-toolbar" });
    const type = element("select", { ariaLabel: "Lọc loại hồ sơ" });
    [["", "Tất cả loại"], ["CLARIFICATION", "Làm rõ"], ["PETITION", "Kiến nghị"]]
      .forEach(([value, label]) => type.append(element("option", { value }, label)));
    const state = element("input", { placeholder: "Lọc trạng thái", ariaLabel: "Lọc trạng thái" });
    const refresh = element("button", { type: "button", class: "pc-primary" }, "Tải lại");
    const create = element("button", { type: "button", class: "pc-primary pc-secondary" }, "Tạo hồ sơ");
    toolbar.append(type, state, refresh, create);
    const status = element("div", { class: "pc-status", role: "status", ariaLive: "polite" });
    const grid = element("div", { class: "pc-grid" });
    const list = element("div", { class: "pc-list", role: "list", tabIndex: 0 });
    const detail = element("article", { class: "pc-detail", ariaLive: "polite" });
    grid.append(list, detail); card.append(toolbar, status, grid); panel.append(card);
    this.caseUi = { type, state, status, list, detail };
    refresh.addEventListener("click", () => this.loadCases());
    type.addEventListener("change", () => this.loadCases());
    state.addEventListener("change", () => this.loadCases());
    create.addEventListener("click", () => this.openCreateDialog());
  }

  async loadCases() {
    const { type, state, status } = this.caseUi;
    status.textContent = "Đang tải hồ sơ…";
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (type.value) params.set("caseType", type.value);
      if (state.value.trim()) params.set("state", state.value.trim());
      const [official, legacy] = await Promise.all([
        jsonRequest(`/api/procurement-cases?${params}`),
        jsonRequest("/api/procurement-cases/legacy-clarifications?limit=100"),
      ]);
      this.cases = official.items || [];
      this.renderCaseList(legacy.items || []);
      status.textContent = `${this.cases.length} hồ sơ · ${(legacy.items || []).length} mục legacy chưa liên kết`;
    } catch (error) { status.textContent = `Không thể tải: ${error.message}`; }
  }

  renderCaseList(legacy) {
    const list = this.caseUi.list; list.replaceChildren();
    this.cases.forEach((item) => {
      const button = element("button", { type: "button", role: "listitem" });
      button.append(element("strong", {}, `${item.caseNo} · ${item.subject}`),
        element("span", { class: "pc-meta" }, `${item.caseType} · ${item.state} · ${item.packageName || ""}`));
      button.addEventListener("click", () => this.loadCase(item.id, button)); list.append(button);
    });
    legacy.forEach((item) => {
      const button = element("button", { type: "button", role: "listitem" });
      button.append(element("strong", {}, `LEGACY_UNLINKED · ${item.kind}`),
        element("span", { class: "pc-meta" }, `${item.packageName || ""} · ${item.content || ""}`));
      button.addEventListener("click", () => {
        this.caseUi.detail.replaceChildren(element("h3", {}, "Mục làm rõ legacy (chỉ đọc)"),
          element("p", { class: "pc-preview" }, item.content || "Không có nội dung."));
      }); list.append(button);
    });
    if (!list.children.length) list.append(element("p", { class: "pc-meta" }, "Chưa có hồ sơ."));
  }

  async loadCase(id, button) {
    this.caseUi.detail.textContent = "Đang tải chi tiết…";
    try {
      this.current = await jsonRequest(`/api/procurement-cases/${encodeURIComponent(id)}`);
      this.caseUi.list.querySelectorAll("button").forEach((node) => node.removeAttribute("aria-current"));
      button.setAttribute("aria-current", "true"); this.renderDetail();
    } catch (error) { this.caseUi.detail.textContent = `Không thể tải: ${error.message}`; }
  }

  renderDetail() {
    const value = this.current; const detail = this.caseUi.detail; detail.replaceChildren();
    detail.append(element("h3", {}, `${value.caseNo} · ${value.subject}`));
    const facts = element("dl", { class: "pc-facts" });
    [["Loại", value.caseType], ["Trạng thái", value.state], ["Hạn xử lý", value.dueAt || "Chưa đặt"],
      ["Đánh giá hạn", value.deadlineStatus], ["Phiên bản policy", value.policyVersion],
      ["Phiên bản gói", value.currentPackageVersionId]].forEach(([term, val]) => {
      const box = element("div"); box.append(element("dt", {}, term), element("dd", {}, String(val || "—"))); facts.append(box);
    }); detail.append(facts);
    const responses = element("section"); responses.append(element("h4", {}, "Phiên bản phản hồi"));
    (value.responses || []).forEach((item) => responses.append(element("p", { class: "pc-preview" }, `#${item.revisionNo} · ${item.content}`)));
    detail.append(responses);
    const parties = element("section"); parties.append(element("h4", {}, "Bên liên quan"));
    (value.parties || []).forEach((item) => parties.append(element("p", { class: "pc-preview" }, `${item.role} · ${item.displayName}\n${JSON.stringify(item.contact, null, 2)}`)));
    if (!(value.parties || []).length) parties.append(element("p", { class: "pc-meta" }, "Chưa có bên liên quan."));
    detail.append(parties);
    const legal = element("section"); legal.append(element("h4", {}, `Căn cứ pháp lý · ${value.legalBasisStatus || "NOT_EVALUATED"}`));
    (value.legalBases || []).forEach((item) => legal.append(element("p", { class: "pc-preview" }, `${item.verificationStatus} · ${item.profileVersionId || "note"} · ${item.instrumentVersionId || ""}\n${item.note || ""}`)));
    if (!(value.legalBases || []).length) legal.append(element("p", { class: "pc-meta" }, "Chưa có căn cứ exact; kết luận pháp lý là NOT_EVALUATED."));
    detail.append(legal);
    const attachments = element("section"); attachments.append(element("h4", {}, "Tệp đính kèm"));
    (value.attachments || []).forEach((item) => attachments.append(element("a", { href: `/api/procurement-cases/${encodeURIComponent(value.id)}/attachments/${encodeURIComponent(item.id)}/download` }, `${item.filename} · ${item.byteSize} bytes`)));
    if (!(value.attachments || []).length) attachments.append(element("p", { class: "pc-meta" }, "Chưa có tệp đính kèm."));
    detail.append(attachments);
    const history = element("section"); history.append(element("h4", {}, "Lịch sử chuyển trạng thái"));
    (value.transitions || []).forEach((item) => history.append(element("p", { class: "pc-meta" }, `${item.sequenceNo}. ${item.action}: ${item.fromState || "—"} → ${item.toState}`)));
    const activity = element("div", { class: "pc-status", ariaLive: "polite" }, "Đang tải activity…");
    history.append(activity); detail.append(history);
    void jsonRequest(`/api/activities/procurement_case/${encodeURIComponent(value.id)}?limit=30`)
      .then((result) => { activity.textContent = (result.items || []).map((item) => `${item.occurredAt} · ${item.action} · ${item.actorName}`).join("\n") || "Chưa có activity."; })
      .catch((error) => { activity.textContent = `Không thể tải activity: ${error.message}`; });
    const actions = element("div", { class: "pc-actions" });
    availableCaseActions(value).forEach((key) => {
      const button = element("button", { type: "button" }, ACTION_LABELS[key]);
      button.addEventListener("click", () => this.runCaseAction(key)); actions.append(button);
    }); detail.append(actions);
  }

  async runCaseAction(key) {
    const value = this.current; let path = ACTION_PATHS[key];
    const body = { expectedRowVersion: value.rowVersion, packageVersionId: value.currentPackageVersionId };
    if (key === "SAVE_RESPONSE") { path = "responses"; body.content = globalThis.prompt("Nội dung phản hồi mới") || ""; }
    if (key === "SET_DUE_DATE") { path = "due-date"; body.dueAt = globalThis.prompt("Hạn ISO (YYYY-MM-DD hoặc ISO date-time)") || ""; }
    if (key === "ASSIGN") body.responsibleUnit = globalThis.prompt("Đơn vị chịu trách nhiệm") || "";
    if (key === "ADD_PARTY") { path = "parties"; body.role = globalThis.prompt("Vai trò của bên liên quan") || "RELATED"; body.displayName = globalThis.prompt("Tên hiển thị") || ""; body.contact = {}; }
    if (key === "ADD_LEGAL_BASIS") { path = "legal-bases"; body.profileVersionId = globalThis.prompt("Exact profile version ID (để trống nếu chỉ ghi chú)") || null; body.instrumentVersionId = body.profileVersionId ? (globalThis.prompt("Exact instrument version ID") || null) : null; body.note = globalThis.prompt("Ghi chú căn cứ") || null; body.responseRevisionId = value.currentResponseRevisionId; }
    if (key === "ADD_ATTACHMENT") return this.uploadAttachment();
    try {
      this.current = await jsonRequest(`/api/procurement-cases/${encodeURIComponent(value.id)}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body),
      }); this.renderDetail(); await this.loadCases();
    } catch (error) { this.caseUi.status.textContent = `Không thể thực hiện: ${error.message}`; }
  }

  uploadAttachment() {
    const input = element("input", { type: "file", accept: ".pdf,.docx,.xlsx" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      const form = new FormData(); form.append("file", file); form.append("expectedRowVersion", String(this.current.rowVersion)); form.append("packageVersionId", this.current.currentPackageVersionId); if (this.current.currentResponseRevisionId) form.append("responseRevisionId", this.current.currentResponseRevisionId);
      try { const response = await apiFetch(`/api/procurement-cases/${encodeURIComponent(this.current.id)}/attachments`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form }); const payload = await response.json(); if (!response.ok) throw new Error(payload.code || "UPLOAD_FAILED"); this.current = payload; this.renderDetail(); }
      catch (error) { this.caseUi.status.textContent = `Không thể tải tệp: ${error.message}`; }
    });
    input.click();
  }

  openCreateDialog() {
    const dialog = element("dialog", { class: "pc-dialog" }); const form = element("form", { method: "dialog" });
    const pkg = element("select", { required: true }); this.packages.forEach((item) => pkg.append(element("option", { value: item.id }, `${item.maGoiThau || item.id} · ${item.tenGoiThau || ""}`)));
    const type = element("select"); [["CLARIFICATION", "Làm rõ"], ["PETITION", "Kiến nghị"]].forEach(([v,l]) => type.append(element("option", { value:v }, l)));
    const no = element("input", { required:true, maxLength:160 }); const subject = element("input", { required:true, maxLength:1000 });
    const category = element("select"); [["E_HSMT","E-HSMT"],["CONTRACTOR_SELECTION_RESULT","Kết quả LCNT"],["OTHER","Khác"]].forEach(([v,l])=>category.append(element("option",{value:v},l)));
    [["Gói thầu",pkg],["Loại",type],["Số hồ sơ",no],["Chủ đề",subject],["Nhóm kiến nghị",category]].forEach(([label,input])=>{const wrap=element("label",{},label);wrap.append(input);form.append(wrap);});
    const menu=element("menu"); const cancel=element("button",{type:"button",class:"pc-secondary"},"Hủy"); const submit=element("button",{type:"submit",class:"pc-primary"},"Tạo"); menu.append(cancel,submit);form.append(menu);dialog.append(form);document.body.append(dialog);
    cancel.addEventListener("click",()=>dialog.close()); dialog.addEventListener("close",()=>dialog.remove());
    form.addEventListener("submit",async(event)=>{event.preventDefault();try{await jsonRequest("/api/procurement-cases",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({packageVersionId:pkg.value,caseNo:no.value,caseType:type.value,direction:type.value==="CLARIFICATION"?"INBOUND":null,category:type.value==="PETITION"?category.value:null,otherDescription:type.value==="PETITION"&&category.value==="OTHER"?"Chưa phân loại chi tiết":null,subject:subject.value,dueAt:null})});dialog.close();await this.loadCases();}catch(error){this.caseUi.status.textContent=`Không thể tạo: ${error.message}`;}}); dialog.showModal(); no.focus();
  }

  renderCalendar() {
    const panel=this.root.querySelector('[data-center-panel="calendar"]'); panel.replaceChildren(); const card=element("div",{class:"pc-card"}); card.append(element("h3",{},"Xuất lịch công việc (.ics)"),element("p",{class:"pc-meta"},"Chỉ các trường outbound đã duyệt rời hệ thống. Không tự động đồng bộ nhà cung cấp."));
    const list=element("div",{class:"pc-checklist"}); this.packages.forEach((item)=>{const label=element("label");const input=element("input",{type:"checkbox",value:item.id});label.append(input,document.createTextNode(`${item.maGoiThau||item.id} · ${item.tenGoiThau||""}`));list.append(label);});
    const preview=element("button",{type:"button",class:"pc-primary"},"Xem trước");const download=element("button",{type:"button",class:"pc-primary pc-secondary"},"Tải .ics");const output=element("pre",{class:"pc-preview",ariaLive:"polite"});card.append(list,preview,download,output);panel.append(card);
    const selected=()=>[...list.querySelectorAll("input:checked")].map((input)=>({sourceType:"PACKAGE_TIMELINE",sourceId:input.value})); this.calendarSelectedSources=selected;
    preview.addEventListener("click",async()=>{try{const data=await jsonRequest("/api/work-calendar/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceItems:selected()})});output.textContent=JSON.stringify(data.events,null,2);}catch(error){output.textContent=error.message;}});
    download.addEventListener("click",async()=>{try{const response=await apiFetch("/api/work-calendar/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceItems:selected()})});if(!response.ok)throw new Error("DOWNLOAD_FAILED");const url=URL.createObjectURL(await response.blob());const link=element("a",{href:url,download:"biddingflow-work-calendar.ics"});link.click();URL.revokeObjectURL(url);}catch(error){output.textContent=error.message;}});
    if (this.connectorEnabled) this.renderCalendarConnections(panel);
  }

  renderCalendarConnections(panel) {
    const card=element("div",{class:"pc-card pc-integration-card"});
    card.append(element("h3",{},"Kết nối Google Calendar / Microsoft Outlook"),element("p",{class:"pc-meta"},"Đồng bộ một chiều, chỉ khi bạn bấm gửi. Chỉnh sửa trên lịch ngoài không ghi ngược BiddingFlow; ngắt kết nối không xóa sự kiện đã gửi."));
    const consent=element("div",{class:"pc-consent",role:"note"});
    consent.append(element("strong",{},"Phạm vi cấp quyền"),element("p",{class:"pc-meta"},"Google: calendar.events. Microsoft: Calendars.ReadWrite. Token được mã hóa trên máy chủ và không dùng Google login ID token."));
    const toolbar=element("div",{class:"pc-toolbar"}); const provider=element("select",{ariaLabel:"Nhà cung cấp lịch"});
    if(this.googleCalendarEnabled)provider.append(element("option",{value:"GOOGLE"},"Google Calendar"));
    if(this.microsoftCalendarEnabled)provider.append(element("option",{value:"MICROSOFT"},"Microsoft Outlook"));
    const calendarId=element("input",{value:"primary",maxLength:1024,ariaLabel:"Mã lịch đích"});
    const connect=element("button",{type:"button",class:"pc-primary"},"Kết nối và xem consent");
    toolbar.append(provider,calendarId,connect); const status=element("div",{class:"pc-status",role:"status",ariaLive:"polite"}); const connections=element("div",{class:"pc-connection-list"});
    card.append(consent,toolbar,status,connections); panel.append(card); this.calendarConnectionUi={provider,calendarId,status,connections};
    if(!provider.options.length){connect.disabled=true;status.textContent="Chưa có provider được bật.";return;}
    connect.addEventListener("click",async()=>{try{status.textContent="Đang tạo yêu cầu cấp quyền…";const result=await jsonRequest("/api/work-calendar/connections/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:provider.value,calendarId:calendarId.value.trim()})});globalThis.location.assign(result.authorizationUrl);}catch(error){status.textContent=`Không thể kết nối: ${error.message}`;}});
    void this.loadCalendarConnections();
  }

  async loadCalendarConnections() {
    const ui=this.calendarConnectionUi; if(!ui)return; ui.status.textContent="Đang tải kết nối lịch…";
    try{const [payload,deliveryPayload]=await Promise.all([jsonRequest("/api/work-calendar/connections"),jsonRequest("/api/work-calendar/deliveries")]);this.calendarConnections=normalizeCalendarConnections(payload);this.calendarDeliveries=normalizeCalendarDeliveries(deliveryPayload);this.renderCalendarConnectionList();ui.status.textContent=`${this.calendarConnections.length} kết nối lịch · ${this.calendarDeliveries.length} lần gửi gần đây`;}catch(error){ui.status.textContent=`Không thể tải kết nối: ${error.message}`;}
  }

  renderCalendarConnectionList() {
    const ui=this.calendarConnectionUi; ui.connections.replaceChildren();
    (this.calendarConnections||[]).forEach((item)=>{const row=element("article",{class:"pc-connection"});row.append(element("h4",{},`${item.provider} · ${item.accountLabel||item.calendarId}`),element("p",{class:"pc-meta"},`${item.status} · ${item.scopes.join(", ")} · ${item.outboundProfileVersion}`));const actions=element("div",{class:"pc-actions"});
      if(item.status==="ACTIVE"){const sync=element("button",{type:"button"},"Gửi các mốc đã chọn");sync.addEventListener("click",async()=>{try{ui.status.textContent="Đang đưa sự kiện vào hàng đợi…";const result=await jsonRequest("/api/work-calendar/deliveries/enqueue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({connectionId:item.id,sourceItems:this.calendarSelectedSources()})});ui.status.textContent=`Đã xếp hàng ${result.queuedCount} sự kiện.`;}catch(error){ui.status.textContent=`Không thể gửi lịch: ${error.message}`;}});actions.append(sync);}
      if(item.status!=="REVOKED"){const revoke=element("button",{type:"button",class:"pc-secondary"},"Ngắt kết nối");revoke.addEventListener("click",async()=>{try{await jsonRequest(`/api/work-calendar/connections/${encodeURIComponent(item.id)}/revoke`,{method:"POST"});await this.loadCalendarConnections();}catch(error){ui.status.textContent=`Không thể ngắt kết nối: ${error.message}`;}});actions.append(revoke);}row.append(actions);
      const deliveries=element("div",{class:"pc-deliveries"});(this.calendarDeliveries||[]).filter((delivery)=>delivery.connectionId===item.id).slice(0,5).forEach((delivery)=>{const status=element("div",{class:"pc-delivery"});status.append(element("span",{},`${delivery.action} · ${delivery.status} · lần ${delivery.attemptCount}`),element("code",{},delivery.lastErrorCode||"OK"));if(delivery.status==="FAILED"&&item.status==="ACTIVE"){const retry=element("button",{type:"button",class:"pc-secondary"},"Thử lại");retry.addEventListener("click",async()=>{try{await jsonRequest(`/api/work-calendar/deliveries/${encodeURIComponent(delivery.id)}/retry`,{method:"POST"});await this.loadCalendarConnections();}catch(error){ui.status.textContent=`Không thể thử lại: ${error.message}`;}});status.append(retry);}deliveries.append(status);});if(deliveries.children.length)row.append(deliveries);ui.connections.append(row);});
    if(!(this.calendarConnections||[]).length)ui.connections.append(element("p",{class:"pc-meta"},"Chưa kết nối lịch ngoài. Mặc định không có tự động gửi."));
  }

  renderBulk() {
    const panel=this.root.querySelector('[data-center-panel="bulk"]');const card=element("div",{class:"pc-card"});card.append(element("h3",{},"Xuất dữ liệu bản ghi"),element("p",{class:"pc-meta"},"Pilot chỉ hỗ trợ tối đa 100 ID rõ ràng. Preview hết hạn sau 10 phút; ZIP hết hạn sau 24 giờ."));
    const type=element("select");type.append(element("option",{value:"goithau"},"Gói thầu"),element("option",{value:"kehoach"},"Kế hoạch"));const ids=element("textarea",{rows:5,placeholder:"Mỗi dòng một ID bản ghi",ariaLabel:"Danh sách ID"});const prepare=element("button",{type:"button",class:"pc-primary"},"Chuẩn bị preview");const output=element("pre",{class:"pc-preview",ariaLive:"polite"});card.append(type,ids,prepare,output);panel.append(card);
    prepare.addEventListener("click",async()=>{try{const recordIds=ids.value.split(/\s+/).filter(Boolean);const preview=await jsonRequest("/api/bulk-operations/prepare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actionKey:"EXPORT_RECORD_DATA",targetType:type.value,selectionMode:"EXPLICIT_IDS",recordIds})});output.textContent=JSON.stringify(preview,null,2);const confirm=element("button",{type:"button",class:"pc-primary"},"Xác nhận tạo ZIP");card.append(confirm);confirm.focus();confirm.addEventListener("click",async()=>{try{const result=await jsonRequest(`/api/bulk-operations/${encodeURIComponent(preview.operationId)}/confirm`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:"{}"});output.textContent=JSON.stringify(result,null,2);const link=element("a",{href:`/api/bulk-operations/${encodeURIComponent(result.operationId)}/download`},"Tải ZIP");card.append(link);confirm.remove();}catch(error){output.textContent=error.message;}});}catch(error){output.textContent=error.message;}});
  }
}

export async function mountProcurementOperationsCenter(root, options = {}) {
  if (!root) return null; await loadStyleOnce(CSS_URL);
  const instance = new ProcurementOperationsCenter(root, options.packages || []);
  await instance.mount(); return instance;
}
