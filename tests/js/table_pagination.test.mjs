import test from "node:test";
import assert from "node:assert/strict";

import {
  TABLE_PAGE_SIZE,
  buildTablePaginationMarkup,
  enhanceTableRowPagination,
  paginateOwnedTable,
  paginateTableRows,
  paginateTableItems,
  setTablePage,
  tablePaginationPages,
} from "../../frontend/shared/TablePagination.js";

test("table pagination uses ten rows per page and starts only above ten rows", () => {
  assert.equal(TABLE_PAGE_SIZE, 10);

  const tenRows = paginateTableItems(Array.from({ length: 10 }, (_, index) => index));
  assert.equal(tenRows.items.length, 10);
  assert.equal(tenRows.totalPages, 1);
  assert.equal(buildTablePaginationMarkup(tenRows), "");

  const elevenRows = paginateTableItems(Array.from({ length: 11 }, (_, index) => index));
  assert.deepEqual(elevenRows.items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(elevenRows.totalPages, 2);
  assert.match(buildTablePaginationMarkup(elevenRows), /1-10/u);
  assert.match(buildTablePaginationMarkup(elevenRows), /tổng số <strong>11<\/strong>/u);
});

test("table pagination preserves global offsets and clamps stale pages", () => {
  const records = Array.from({ length: 23 }, (_, index) => `row-${index + 1}`);
  const thirdPage = paginateTableItems(records, 3);
  assert.deepEqual(thirdPage.items, ["row-21", "row-22", "row-23"]);
  assert.equal(thirdPage.startDisplay, 21);
  assert.equal(thirdPage.endDisplay, 23);

  const owner = {};
  setTablePage(owner, "users", 9);
  const clamped = paginateOwnedTable(owner, "users", records.slice(0, 11));
  assert.equal(clamped.page, 2);
  assert.equal(owner._tablePaginationPages.users, 2);
});

test("table pagination centers a five-page navigation window", () => {
  assert.deepEqual(tablePaginationPages(1, 12), [1, 2, 3, 4, 5]);
  assert.deepEqual(tablePaginationPages(7, 12), [5, 6, 7, 8, 9]);
  assert.deepEqual(tablePaginationPages(12, 12), [8, 9, 10, 11, 12]);
});

test("DOM row pagination keeps every editable row mounted and only hides other pages", () => {
  const owner = {};
  const rows = Array.from({ length: 11 }, () => ({ dataset: {}, hidden: false }));
  const tableBody = { children: rows };

  paginateTableRows(owner, "matrix", tableBody, null);
  assert.equal(rows.filter((row) => !row.hidden).length, 10);
  assert.equal(rows[10].hidden, true);

  setTablePage(owner, "matrix", 2);
  paginateTableRows(owner, "matrix", tableBody, null);
  assert.equal(rows.filter((row) => !row.hidden).length, 1);
  assert.equal(rows[10].hidden, false);
  assert.equal(tableBody.children.length, 11);
});

test("automatic table pagination preserves rows hidden by business rules", () => {
  const businessHiddenRow = { dataset: {}, hidden: true };
  const dataRows = Array.from({ length: 11 }, () => ({ dataset: {}, hidden: false }));
  const tableBody = { children: [businessHiddenRow, ...dataRows] };
  const table = {
    id: "evaluation-table",
    dataset: {},
    tBodies: [tableBody],
    parentElement: null,
    ownerDocument: null,
  };

  const pagination = enhanceTableRowPagination(table);
  assert.equal(pagination.totalItems, 11);
  assert.equal(dataRows.filter((row) => !row.hidden).length, 10);
  assert.equal(businessHiddenRow.hidden, true);
  assert.equal(businessHiddenRow.dataset.paginationHidden, undefined);
});
