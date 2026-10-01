export async function withRouteFixtureNavigation(page, {
  url, html, headers, navigation = "goto",
}, measure) {
  if (!["goto", "reload", "back"].includes(navigation)) throw new Error("Unsupported fixture navigation");
  // Fragments belong to browser navigation/scroll, not the HTTP request URL.
  const documentURL = new URL(url);
  documentURL.hash = "";
  const requestURL = documentURL.href;
  const session = await page.context().newCDPSession(page);
  const pausedRequests = [];
  let interceptionError;
  session.on("Fetch.requestPaused", (event) => {
    pausedRequests.push({ url: event.request.url, resourceType: event.resourceType });
    if (event.resourceType !== "Document" || event.request.url !== requestURL) {
      interceptionError = new Error("Route fixture intercepted a non-target request");
      void session.send("Fetch.failRequest", {
        requestId: event.requestId, errorReason: "Aborted",
      }).catch(() => {});
      return;
    }
    void session.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 200,
      responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: Buffer.from(html).toString("base64"),
    }).catch((error) => {
      interceptionError = error;
      void session.send("Fetch.failRequest", {
        requestId: event.requestId, errorReason: "Failed",
      }).catch(() => {});
    });
  });
  try {
    await session.send("Network.enable");
    await session.send("Network.setBlockedURLs", { urls: ["http://local.adguard.org/*"] });
    // Only the document is isolated from host HTTP injection. Subresources use
    // ordinary same-origin HTTP requests and Chromium's native cache.
    await session.send("Fetch.enable", { patterns: [{
      urlPattern: requestURL, resourceType: "Document", requestStage: "Request",
    }] });
    if (navigation === "reload") await page.reload({ waitUntil: "domcontentloaded" });
    else if (navigation === "back") await page.goBack({ waitUntil: "domcontentloaded" });
    else await page.goto(url, { waitUntil: "domcontentloaded" });
    if (interceptionError) throw interceptionError;
    const result = await measure({ pausedRequests });
    if (interceptionError) throw interceptionError;
    return result;
  } finally {
    await session.detach();
  }
}
