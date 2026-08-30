import assert from "node:assert/strict";
import test from "node:test";

import {
  isWordPublicationTeamWarning,
  runWordPublicationExportJob,
} from "../../frontend/documents/WordPublicationJob.js";

test("Word publication job creates once, polls status and downloads the returned result URL", async () => {
  const requests = [];
  const downloads = [];
  const progress = [];
  const waits = [];
  const statusResponses = [
    {
      jobId: "job-a",
      status: "processing",
      phase: "rendering",
      completedItems: 0,
      totalItems: 2,
      downloadUrl: null,
    },
    { jobId: "job-a", status: "completed", downloadUrl: "/api/document-jobs/job-a/result" },
  ];
  const request = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "POST") {
      return {
        jobId: "job-a",
        status: "pending",
        statusUrl: "/api/document-jobs/job-a/status",
        downloadUrl: "/api/document-jobs/job-a/download",
      };
    }
    return statusResponses.shift();
  };

  const result = await runWordPublicationExportJob({
    createJobUrl: "/api/document-jobs/package-report/package-a?type=evaluation",
    filename: "bao-cao.zip",
    onProgress: async (stage, message) => progress.push({ stage, message }),
  }, {
    request,
    download: async (url, filename) => downloads.push({ url, filename }),
    wait: async (milliseconds) => waits.push(milliseconds),
    pollIntervalMs: 17,
  });

  assert.deepEqual(requests.map(({ url, options }) => ({
    url,
    method: options.method,
    retries: options.retries,
  })), [
    {
      url: "/api/document-jobs/package-report/package-a?type=evaluation",
      method: "POST",
      retries: 0,
    },
    { url: "/api/document-jobs/job-a/status", method: "GET", retries: 1 },
    { url: "/api/document-jobs/job-a/status", method: "GET", retries: 1 },
  ]);
  assert.deepEqual(waits, [17]);
  assert.deepEqual(downloads, [{
    url: "/api/document-jobs/job-a/result",
    filename: "bao-cao.zip",
  }]);
  assert.deepEqual(progress.map((item) => item.stage), ["render", "render", "download"]);
  assert.equal(progress.some((item) => /chờ xử lý/u.test(item.message)), true);
  assert.equal(progress.some((item) => /2 tài liệu Word/u.test(item.message)), true);
  assert.deepEqual(result, {
    jobId: "job-a",
    status: "completed",
    downloadUrl: "/api/document-jobs/job-a/result",
  });
});

test("Word publication job surfaces a failed background job without downloading", async () => {
  let downloaded = false;
  const request = async (_url, options) => (
    options.method === "POST"
      ? {
        jobId: "job-b",
        status: "pending",
        statusUrl: "/api/document-jobs/job-b",
        downloadUrl: "/api/document-jobs/job-b/download",
      }
      : {
        jobId: "job-b",
        status: "failed",
        errorCode: "DOCUMENT_JOB_CANCELLED",
      }
  );

  await assert.rejects(
    runWordPublicationExportJob({
      createJobUrl: "/api/document-jobs/plan/plan-a",
      filename: "ke-hoach.docx",
    }, {
      request,
      download: async () => { downloaded = true; },
      wait: async () => {},
    }),
    /đã bị hủy/u,
  );
  assert.equal(downloaded, false);
});

test("Word publication job rejects a create response without a server status URL", async () => {
  await assert.rejects(
    runWordPublicationExportJob({
      createJobUrl: "/api/document-jobs/plan/plan-a",
      filename: "ke-hoach.docx",
    }, {
      request: async () => ({
        jobId: "job-c",
        status: "pending",
        downloadUrl: "/api/document-jobs/job-c/download",
      }),
    }),
    /đường dẫn theo dõi/u,
  );
});

test("Word publication job resumes polling the same durable job after a transient request failure", async () => {
  let polls = 0;
  let creates = 0;
  const result = await runWordPublicationExportJob({
    createJobUrl: "/api/document-jobs/plan/plan-a",
    filename: "ke-hoach.docx",
  }, {
    request: async (_url, options) => {
      if (options.method === "POST") {
        creates += 1;
        return { jobId: "job-retry", status: "pending", statusUrl: "/jobs/job-retry" };
      }
      polls += 1;
      if (polls === 1) throw new Error("temporary network failure");
      return { jobId: "job-retry", status: "completed", downloadUrl: "/jobs/job-retry/download" };
    },
    download: async () => {},
    wait: async () => {},
  });

  assert.equal(creates, 1);
  assert.equal(polls, 2);
  assert.equal(result.jobId, "job-retry");
});

test("Word publication job translates a server policy code into an actionable message", async () => {
  await assert.rejects(
    runWordPublicationExportJob({
      createJobUrl: "/api/document-jobs/plan/plan-a",
      filename: "ke-hoach.docx",
    }, {
      request: async () => {
        throw { data: { code: "DOCUMENT_EXPORT_SOURCE_CHANGED" } };
      },
    }),
    /Dữ liệu nguồn đã thay đổi/u,
  );
});

test("Word publication job preserves template-aware team warnings for the UI", async () => {
  let warning;
  try {
    await runWordPublicationExportJob({
      createJobUrl: "/api/document-jobs/package-report/package-a",
      filename: "bao-cao.docx",
    }, {
      request: async () => {
        throw { data: { code: "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED" } };
      },
    });
  } catch (error) {
    warning = error;
  }

  assert.equal(isWordPublicationTeamWarning(warning), true);
  assert.equal(warning.code, "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED");
  assert.match(warning.message, /Tổ chuyên gia/u);
});
