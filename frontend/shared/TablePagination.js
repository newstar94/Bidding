import { trustedHTML } from "./trustedTypes.js";

export const TABLE_PAGE_SIZE = 10;
let generatedPaginationTableId = 0;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function tablePaginationPages(currentPage, totalPages, maxVisiblePages = 5) {
  const safeTotal = positiveInteger(totalPages, 1);
  const safeCurrent = Math.min(safeTotal, positiveInteger(currentPage, 1));
  const visibleCount = Math.min(safeTotal, positiveInteger(maxVisiblePages, 5));
  let start = Math.max(1, safeCurrent - Math.floor(visibleCount / 2));
  const end = Math.min(safeTotal, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function paginateTableItems(items, currentPage = 1, pageSize = TABLE_PAGE_SIZE) {
  const records = Array.isArray(items) ? items : [];
  const safePageSize = positiveInteger(pageSize, TABLE_PAGE_SIZE);
  const totalItems = records.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const page = Math.min(totalPages, positiveInteger(currentPage, 1));
  const startIndex = (page - 1) * safePageSize;
  return {
    items: records.slice(startIndex, startIndex + safePageSize),
    page,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    startIndex,
    startDisplay: totalItems === 0 ? 0 : startIndex + 1,
    endDisplay: Math.min(startIndex + safePageSize, totalItems),
  };
}

export function getTablePage(owner, key) {
  return positiveInteger(owner?._tablePaginationPages?.[key], 1);
}

export function setTablePage(owner, key, page) {
  if (!owner || !key) return 1;
  owner._tablePaginationPages ||= Object.create(null);
  owner._tablePaginationPages[key] = positiveInteger(page, 1);
  return owner._tablePaginationPages[key];
}

export function paginateOwnedTable(owner, key, items, pageSize = TABLE_PAGE_SIZE) {
  const result = paginateTableItems(items, getTablePage(owner, key), pageSize);
  setTablePage(owner, key, result.page);
  return result;
}

export function buildTablePaginationMarkup(pagination) {
  if (!pagination || pagination.totalItems <= pagination.pageSize) return "";
  const { page, totalPages, startDisplay, endDisplay, totalItems } = pagination;
  const pageButtons = tablePaginationPages(page, totalPages)
    .map((pageNumber) => `<button type="button" class="pagination-btn ${pageNumber === page ? "active" : ""}" data-table-page="${pageNumber}" ${pageNumber === page ? 'aria-current="page"' : ""} aria-label="Trang ${pageNumber}">${pageNumber}</button>`)
    .join("");
  return `<span class="pagination-info">Hiển thị <strong>${startDisplay}-${endDisplay}</strong> trên tổng số <strong>${totalItems}</strong> bản ghi</span><div class="pagination-buttons">
    <button type="button" class="pagination-btn" data-table-page="1" title="Trang đầu" aria-label="Trang đầu" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevrons-left" aria-hidden="true"></i></button>
    <button type="button" class="pagination-btn" data-table-page="${Math.max(1, page - 1)}" title="Trang trước" aria-label="Trang trước" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button>
    ${pageButtons}
    <button type="button" class="pagination-btn" data-table-page="${Math.min(totalPages, page + 1)}" title="Trang sau" aria-label="Trang sau" ${page >= totalPages ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>
    <button type="button" class="pagination-btn" data-table-page="${totalPages}" title="Trang cuối" aria-label="Trang cuối" ${page >= totalPages ? "disabled" : ""}><i data-lucide="chevrons-right" aria-hidden="true"></i></button>
  </div>`;
}

export function renderTablePagination(container, pagination, onPageChange) {
  if (!container) return;
  const markup = buildTablePaginationMarkup(pagination);
  container.innerHTML = trustedHTML(markup);
  container.hidden = !markup;
  if (!markup) return;
  container.querySelectorAll("[data-table-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = positiveInteger(button.dataset.tablePage, pagination.page);
      if (page !== pagination.page) onPageChange?.(page);
    });
  });
  globalThis.lucide?.createIcons?.({ root: container });
}

export function paginateTableRows(owner, key, tableBody, container, pageSize = TABLE_PAGE_SIZE) {
  if (!tableBody) return paginateTableItems([], 1, pageSize);
  const rows = Array.from(tableBody.children).filter((row) => (
    !row.dataset.tableState
    && (!row.hidden || row.dataset.paginationHidden === "true")
  ));
  const pagination = paginateOwnedTable(owner, key, rows, pageSize);
  rows.forEach((row, index) => {
    const outsidePage = index < pagination.startIndex || index >= pagination.startIndex + pagination.pageSize;
    row.hidden = outsidePage;
    if (outsidePage) row.dataset.paginationHidden = "true";
    else delete row.dataset.paginationHidden;
  });
  renderTablePagination(container, pagination, (page) => {
    setTablePage(owner, key, page);
    paginateTableRows(owner, key, tableBody, container, pageSize);
  });
  return pagination;
}

export function enhanceTableRowPagination(table, {
  pageSize = TABLE_PAGE_SIZE,
  showLastPage = false,
} = {}) {
  const tableBody = table?.tBodies?.[0] || table?.querySelector?.("tbody");
  if (!table || !tableBody) return paginateTableItems([], 1, pageSize);
  if (!table.id) table.id = `bf-row-pagination-${++generatedPaginationTableId}`;
  const key = table.dataset.rowPaginationKey || "rows";
  const anchor = table.parentElement?.matches?.(".table-container, .table-responsive, .package-table-frame")
    ? table.parentElement
    : table;
  let container = table.__bfRowPaginationContainer;
  if (!container?.isConnected) {
    const sibling = anchor.nextElementSibling;
    container = sibling?.dataset?.tablePaginationFor === table.id ? sibling : null;
  }
  if (!container && table.ownerDocument?.createElement) {
    container = table.ownerDocument.createElement("nav");
    container.className = "pagination-container table-row-pagination";
    container.dataset.tablePaginationFor = table.id;
    container.setAttribute("aria-label", `Phân trang ${table.getAttribute("aria-label") || "bảng dữ liệu"}`);
    anchor.insertAdjacentElement?.("afterend", container);
  }
  table.__bfRowPaginationContainer = container || null;
  if (showLastPage) {
    const eligibleRows = Array.from(tableBody.children).filter((row) => (
      !row.dataset.tableState
      && (!row.hidden || row.dataset.paginationHidden === "true")
    ));
    setTablePage(table, key, Math.max(1, Math.ceil(eligibleRows.length / pageSize)));
  }
  const pagination = paginateTableRows(table, key, tableBody, container, pageSize);
  anchor.classList?.toggle("has-row-pagination", pagination.totalItems > pagination.pageSize);
  return pagination;
}
