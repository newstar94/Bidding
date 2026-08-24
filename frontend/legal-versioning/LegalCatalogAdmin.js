import { getJson, postJson } from "../shared/apiClient.js";

function node(tag, className = "", text = "") {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== "") value.textContent = String(text);
  return value;
}

function loadStyles(root) {
  if (root.querySelector('link[data-legal-catalog-styles="true"]')) return;
  const link = root.createElement("link");
  link.rel = "stylesheet";
  link.href = "/frontend/legal-versioning/LegalCatalogAdmin.css";
  link.dataset.legalCatalogStyles = "true";
  root.head.appendChild(link);
}

function field({ id, label, type = "text", required = false, value = "", hint = "" }) {
  const wrapper = node("div", "legal-catalog-field");
  const labelNode = node("label", "", label);
  labelNode.htmlFor = id;
  const input = type === "textarea" ? node("textarea") : node("input");
  input.id = id;
  input.name = id;
  input.required = required;
  if (type !== "textarea") input.type = type;
  input.value = value;
  if (hint) {
    const hintNode = node("small", "legal-catalog-hint", hint);
    hintNode.id = `${id}-hint`;
    input.setAttribute("aria-describedby", hintNode.id);
    wrapper.append(labelNode, input, hintNode);
  } else {
    wrapper.append(labelNode, input);
  }
  return { wrapper, input };
}

function button(label, className = "btn btn-outline") {
  const value = node("button", className, label);
  value.type = "button";
  return value;
}

function valuesFrom(form, names) {
  return Object.fromEntries(names.map((name) => [name, form.elements.namedItem(name)?.value?.trim() || ""]));
}

function orderedIds(value) {
  const ids = String(value || "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new Error("Danh sách phiên bản văn bản phải có ít nhất một ID và không được trùng.");
  }
  return ids;
}

function parseRelations(value) {
  if (!String(value || "").trim()) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Quan hệ pháp lý phải là một mảng JSON.");
  return parsed;
}

function exactSourceArticle(source) {
  const article = node("article", "legal-catalog-source");
  const title = [source.documentType, source.documentNumber].filter(Boolean).join(" ");
  article.append(
    node("h4", "", title || source.title || "Văn bản pháp lý"),
    node("p", "", source.title || ""),
    node("p", "", `Hiệu lực: ${source.effectiveFrom || "—"}${source.effectiveTo ? ` – ${source.effectiveTo}` : " trở đi"}`),
    node("code", "", `ID: ${source.id || "—"}`),
    node("code", "", `SHA-256: ${source.contentSha256 || "—"}`),
  );
  if (source.sourceUri) {
    const link = node("a", "", "Mở nguồn chính thức");
    link.href = source.sourceUri;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    article.appendChild(link);
  }
  return article;
}

function buildInstrumentForm() {
  const form = node("form", "legal-catalog-form");
  form.setAttribute("aria-labelledby", "legal-instrument-form-title");
  const title = node("h3", "", "1. Văn bản nguồn bất biến");
  title.id = "legal-instrument-form-title";
  const stableCode = field({ id: "legal-instrument-stable-code", label: "Mã ổn định", required: true });
  const documentTitle = field({ id: "legal-instrument-title", label: "Tên văn bản", required: true });
  const documentType = field({ id: "legal-instrument-document-type", label: "Loại văn bản", required: true });
  const documentNumber = field({ id: "legal-instrument-document-number", label: "Số văn bản", required: true });
  const sourceUri = field({ id: "legal-instrument-source-uri", label: "URL nguồn chính thức", type: "url", required: true });
  const issuedDate = field({ id: "legal-instrument-issued-date", label: "Ngày ban hành", type: "date", required: true });
  const effectiveFrom = field({ id: "legal-instrument-effective-from", label: "Hiệu lực từ", type: "date", required: true });
  const effectiveTo = field({ id: "legal-instrument-effective-to", label: "Hiệu lực đến", type: "date" });
  const sourceContent = field({ id: "legal-instrument-source-content", label: "Nội dung nguồn", type: "textarea", required: true, hint: "Nội dung này được băm SHA-256 và bất biến sau khi xuất bản." });
  const relations = field({ id: "legal-instrument-relations", label: "Quan hệ pháp lý (JSON)", type: "textarea", value: "[]", hint: "Mảng JSON có thứ tự; dùng [] nếu chưa có quan hệ." });
  const grid = node("div", "legal-catalog-form-grid");
  grid.append(stableCode.wrapper, documentTitle.wrapper, documentType.wrapper, documentNumber.wrapper, sourceUri.wrapper, issuedDate.wrapper, effectiveFrom.wrapper, effectiveTo.wrapper);
  const actions = node("div", "legal-catalog-actions");
  const create = button("Tạo bản nháp văn bản", "btn btn-primary");
  create.type = "submit";
  const publish = button("Xuất bản văn bản");
  publish.disabled = true;
  actions.append(create, publish);
  form.append(title, grid, sourceContent.wrapper, relations.wrapper, actions);
  return { form, create, publish };
}

function buildProfileForm() {
  const form = node("form", "legal-catalog-form");
  form.setAttribute("aria-labelledby", "legal-profile-form-title");
  const title = node("h3", "", "2. Hồ sơ nguồn áp dụng");
  title.id = "legal-profile-form-title";
  const stableCode = field({ id: "legal-profile-stable-code", label: "Mã hồ sơ ổn định", required: true });
  const displayName = field({ id: "legal-profile-display-name", label: "Tên hồ sơ", required: true });
  const effectiveFrom = field({ id: "legal-profile-effective-from", label: "Hiệu lực từ", type: "date", required: true });
  const effectiveTo = field({ id: "legal-profile-effective-to", label: "Hiệu lực đến", type: "date" });
  const priority = field({ id: "legal-profile-priority", label: "Độ ưu tiên", type: "number", value: "0" });
  const ids = field({ id: "legal-profile-instrument-version-ids", label: "ID phiên bản văn bản theo đúng thứ tự", type: "textarea", required: true, hint: "Mỗi dòng một ID. Thứ tự này được ghim bất biến trong hồ sơ đã xuất bản." });
  const reviewWrapper = node("label", "legal-catalog-check");
  const review = node("input");
  review.type = "checkbox";
  review.name = "legal-profile-manual-review";
  reviewWrapper.append(review, node("span", "", "Bắt buộc rà soát thủ công khi profile này được chọn"));
  const grid = node("div", "legal-catalog-form-grid");
  grid.append(stableCode.wrapper, displayName.wrapper, effectiveFrom.wrapper, effectiveTo.wrapper, priority.wrapper);
  const actions = node("div", "legal-catalog-actions");
  const create = button("Tạo bản nháp hồ sơ", "btn btn-primary");
  create.type = "submit";
  const publish = button("Xuất bản hồ sơ");
  publish.disabled = true;
  actions.append(create, publish);
  form.append(title, grid, reviewWrapper, ids.wrapper, actions);
  return { form, create, publish, ids, review };
}

export function isLegalCatalogEnabled(root = globalThis.document) {
  return root?.querySelector?.('meta[name="bf-legal-versioning-enabled"]')?.content === "true";
}

export async function mountLegalCatalogAdmin(container, {
  root = document, read = getJson, write = postJson,
} = {}) {
  if (!container || !isLegalCatalogEnabled(root)) return null;
  if (container.__legalCatalogAdmin) return container.__legalCatalogAdmin;
  const card = container.closest?.("#legal-catalog-admin-card") || container;
  loadStyles(root);
  const status = node("p", "legal-catalog-live", "Đang tải danh mục pháp lý…");
  status.id = "legal-catalog-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const instrument = buildInstrumentForm();
  const profile = buildProfileForm();
  const published = node("section", "legal-catalog-published");
  published.setAttribute("aria-labelledby", "legal-catalog-published-title");
  const publishedTitle = node("h3", "", "Hồ sơ đã xuất bản");
  publishedTitle.id = "legal-catalog-published-title";
  const profileList = node("div", "legal-catalog-profile-list");
  published.append(publishedTitle, profileList);
  const workspace = node("div", "legal-catalog-workspace");
  workspace.append(instrument.form, profile.form, published);
  container.replaceChildren(status, workspace);

  let instrumentDraft = null;
  let profileDraft = null;
  const availableSources = new Map();
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
    status.setAttribute("aria-live", error ? "assertive" : "polite");
  };
  const setBusy = (control, busy) => {
    control.disabled = busy;
    control.setAttribute("aria-busy", String(busy));
  };
  const addAvailableSource = (source) => {
    if (!source?.id || availableSources.has(source.id)) return;
    availableSources.set(source.id, source);
    const item = node("div", "legal-catalog-version");
    item.append(node("code", "", source.id), node("span", "", `${source.documentType || ""} ${source.documentNumber || source.title || ""}`.trim()));
    const add = button("Thêm vào hồ sơ", "btn btn-outline btn-sm");
    add.addEventListener("click", () => {
      const existing = profile.ids.input.value.trim();
      const ids = existing ? existing.split(/\r?\n/u).map((value) => value.trim()) : [];
      if (!ids.includes(source.id)) profile.ids.input.value = [...ids.filter(Boolean), source.id].join("\n");
      profile.ids.input.focus();
      setStatus(`Đã thêm ${source.id} vào cuối thứ tự nguồn của hồ sơ.`);
    });
    item.appendChild(add);
    instrument.form.appendChild(item);
  };
  const renderProfiles = (profiles) => {
    profileList.replaceChildren();
    if (!profiles.length) {
      profileList.appendChild(node("p", "text-muted", "Chưa có hồ sơ pháp lý nào được xuất bản."));
      return;
    }
    profiles.forEach((item) => {
      const article = node("article", "legal-catalog-profile");
      article.append(
        node("h4", "", `${item.displayName} · v${item.versionNo}`),
        node("p", "", `Hiệu lực: ${item.effectiveFrom}${item.effectiveTo ? ` – ${item.effectiveTo}` : " trở đi"} · ưu tiên ${item.priority}`),
        node("code", "", `Profile ID: ${item.id}`),
        node("code", "", `Manifest SHA-256: ${item.manifestHash}`),
      );
      if (item.manualReviewRequired) article.appendChild(node("span", "badge badge-warning", "Cần rà soát thủ công"));
      const sourcesButton = button("Xem nguồn chính xác", "btn btn-outline btn-sm");
      const sources = node("div", "legal-catalog-source-list");
      sourcesButton.addEventListener("click", async () => {
        setBusy(sourcesButton, true);
        setStatus("Đang kiểm tra hash và tải nguồn chính xác…");
        try {
          const payload = await read(`/api/legal-versioning/profiles/${encodeURIComponent(item.id)}/sources`, { retries: 0 });
          sources.replaceChildren(...(payload.sources || []).map(exactSourceArticle));
          (payload.sources || []).forEach(addAvailableSource);
          setStatus(`Đã tải và xác minh ${payload.sources?.length || 0} nguồn của hồ sơ ${item.displayName}.`);
        } catch (error) {
          setStatus(error?.message || "Không thể tải nguồn chính xác.", true);
        } finally {
          setBusy(sourcesButton, false);
        }
      });
      article.append(sourcesButton, sources);
      profileList.appendChild(article);
    });
  };
  const refresh = async () => {
    try {
      const profiles = await read("/api/legal-versioning/profiles", { retries: 0 });
      renderProfiles(Array.isArray(profiles) ? profiles : []);
      card.hidden = false;
      setStatus(`Đã tải ${Array.isArray(profiles) ? profiles.length : 0} hồ sơ pháp lý đã xuất bản.`);
      return true;
    } catch (error) {
      if (error?.status === 404) {
        card.hidden = true;
        return false;
      }
      card.hidden = false;
      setStatus(error?.message || "Không thể tải danh mục pháp lý.", true);
      return false;
    }
  };

  instrument.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(instrument.create, true);
    setStatus("Đang tạo bản nháp văn bản…");
    try {
      const value = valuesFrom(instrument.form, [
        "legal-instrument-stable-code", "legal-instrument-title", "legal-instrument-document-type",
        "legal-instrument-document-number", "legal-instrument-source-uri", "legal-instrument-issued-date",
        "legal-instrument-effective-from", "legal-instrument-effective-to", "legal-instrument-source-content",
        "legal-instrument-relations",
      ]);
      instrumentDraft = await write("/api/legal-versioning/instruments", {
        stableCode: value["legal-instrument-stable-code"], title: value["legal-instrument-title"],
        documentType: value["legal-instrument-document-type"], documentNumber: value["legal-instrument-document-number"],
        sourceUri: value["legal-instrument-source-uri"], sourceContent: value["legal-instrument-source-content"],
        issuedDate: value["legal-instrument-issued-date"], effectiveFrom: value["legal-instrument-effective-from"],
        effectiveTo: value["legal-instrument-effective-to"] || null,
        relations: parseRelations(value["legal-instrument-relations"]),
      });
      instrument.publish.disabled = false;
      setStatus(`Đã tạo draft ${instrumentDraft.id} revision ${instrumentDraft.draftRevision}. Kiểm tra rồi xuất bản.`);
    } catch (error) {
      setStatus(error?.message || "Không thể tạo bản nháp văn bản.", true);
    } finally {
      setBusy(instrument.create, false);
    }
  });
  instrument.publish.addEventListener("click", async () => {
    if (!instrumentDraft) return;
    setBusy(instrument.publish, true);
    setStatus("Đang xuất bản phiên bản văn bản bất biến…");
    try {
      const source = await write(`/api/legal-versioning/instrument-drafts/${encodeURIComponent(instrumentDraft.id)}/publish`, {
        expectedDraftRevision: Number(instrumentDraft.draftRevision),
      });
      addAvailableSource(source);
      instrumentDraft = null;
      setStatus(`Đã xuất bản ${source.id}. SHA-256: ${source.contentSha256}`);
    } catch (error) {
      if (error?.status === 409) {
        instrumentDraft = null;
        setStatus("Draft văn bản đã thay đổi hoặc đã được xuất bản ở phiên khác. Hãy tạo draft mới từ dữ liệu đã kiểm tra.", true);
      } else {
        setStatus(error?.message || "Không thể xuất bản văn bản.", true);
      }
    } finally {
      instrument.publish.disabled = !instrumentDraft;
      instrument.publish.removeAttribute("aria-busy");
    }
  });
  profile.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(profile.create, true);
    setStatus("Đang tạo bản nháp hồ sơ pháp lý…");
    try {
      const value = valuesFrom(profile.form, [
        "legal-profile-stable-code", "legal-profile-display-name", "legal-profile-effective-from",
        "legal-profile-effective-to", "legal-profile-priority", "legal-profile-instrument-version-ids",
      ]);
      profileDraft = await write("/api/legal-versioning/profiles", {
        stableCode: value["legal-profile-stable-code"], displayName: value["legal-profile-display-name"],
        effectiveFrom: value["legal-profile-effective-from"], effectiveTo: value["legal-profile-effective-to"] || null,
        priority: Number(value["legal-profile-priority"] || 0), manualReviewRequired: profile.review.checked,
        instrumentVersionIds: orderedIds(value["legal-profile-instrument-version-ids"]),
      });
      profile.publish.disabled = false;
      setStatus(`Đã tạo draft hồ sơ ${profileDraft.id} revision ${profileDraft.draftRevision}.`);
    } catch (error) {
      setStatus(error?.message || "Không thể tạo bản nháp hồ sơ.", true);
    } finally {
      setBusy(profile.create, false);
    }
  });
  profile.publish.addEventListener("click", async () => {
    if (!profileDraft) return;
    setBusy(profile.publish, true);
    setStatus("Đang xuất bản hồ sơ nguồn bất biến…");
    try {
      const result = await write(`/api/legal-versioning/profile-drafts/${encodeURIComponent(profileDraft.id)}/publish`, {
        expectedDraftRevision: Number(profileDraft.draftRevision),
      });
      profileDraft = null;
      setStatus(`Đã xuất bản hồ sơ ${result.id}. Đang tải lại danh mục…`);
      await refresh();
    } catch (error) {
      if (error?.status === 409) {
        profileDraft = null;
        await refresh();
        setStatus("Draft hồ sơ đã thay đổi hoặc đã được xuất bản ở phiên khác. Danh mục đã được tải lại; hãy tạo draft mới nếu cần.", true);
      } else {
        setStatus(error?.message || "Không thể xuất bản hồ sơ.", true);
      }
    } finally {
      profile.publish.disabled = !profileDraft;
      profile.publish.removeAttribute("aria-busy");
    }
  });

  const controller = { refresh };
  container.__legalCatalogAdmin = controller;
  await refresh();
  return controller;
}
