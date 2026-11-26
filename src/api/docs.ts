function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function renderHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Senku API documentation</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 960px; padding: 2rem 1.25rem 4rem; }
    h1, h2, h3 { line-height: 1.2; }
    h1 { margin-bottom: .35rem; }
    .muted, .hint { color: #777; }
    form { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; margin: 1.5rem 0; }
    label { display: grid; gap: .35rem; flex: 1 1 22rem; }
    input, button { font: inherit; padding: .65rem .8rem; }
    input { min-width: 0; }
    button { cursor: pointer; }
    a { color: #63a9ff; }
    #status { min-height: 1.5em; }
    .operation { border: 1px solid #7777; border-radius: .5rem; margin: .8rem 0; padding: .2rem 1rem 1rem; }
    .operation h3 code { overflow-wrap: anywhere; }
    .method { display: inline-block; min-width: 4.5rem; font-size: .8rem; font-weight: 700; }
    details { margin: .6rem 0; }
    summary { cursor: pointer; }
    pre { background: #7772; border-radius: .3rem; overflow: auto; padding: .8rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    #download { display: inline-block; margin: .5rem 0 1rem; }
    @media (max-width: 520px) { body { padding: 1.25rem .8rem 3rem; } }
  </style>
</head>
<body>
  <header>
    <h1>Senku API</h1>
    <p class="muted">Browse the API contract for your machine identity. The specification is generated from the same profile contracts used by the service.</p>
  </header>
  <form id="token-form">
    <label for="bearer-token">Senku bearer token
      <input id="bearer-token" name="token" type="password" autocomplete="off" spellcheck="false" required>
    </label>
    <button type="submit">Load API documentation</button>
  </form>
  <p class="hint">The token is sent only to this Senku origin to retrieve your permission-filtered specification. It is not placed in the URL or saved in browser storage.</p>
  <p id="status" role="status" aria-live="polite">Enter a machine token to load the endpoints and schemas available to that identity.</p>
  <main id="documentation" hidden>
    <h2 id="api-title"></h2>
    <p id="api-description"></p>
    <a id="download-spec" download="openapi.json">Download OpenAPI JSON</a>
    <h2>Operations</h2>
    <div id="operations"></div>
    <details>
      <summary>Schema components</summary>
      <div id="schemas"></div>
    </details>
    <details>
      <summary>Security schemes</summary>
      <div id="security-schemes"></div>
    </details>
  </main>
  <script nonce="${nonce}">
    const form = document.getElementById("token-form");
    const tokenInput = document.getElementById("bearer-token");
    const status = document.getElementById("status");
    const documentation = document.getElementById("documentation");
    const operations = document.getElementById("operations");
    const schemas = document.getElementById("schemas");
    const securitySchemes = document.getElementById("security-schemes");
    const download = document.getElementById("download-spec");
    let downloadUrl = "";

    function addText(parent, tagName, value, className) {
      const node = document.createElement(tagName);
      node.textContent = value == null ? "" : String(value);
      if (className) node.className = className;
      parent.appendChild(node);
      return node;
    }

    function addJsonDetails(parent, label, value) {
      const details = document.createElement("details");
      const summary = addText(details, "summary", label);
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(value, null, 2);
      details.append(summary, pre);
      parent.appendChild(details);
    }

    function addContentDetails(parent, label, content) {
      Object.keys(content || {}).forEach(function (mediaType) {
        addJsonDetails(parent, label + " — " + mediaType, content[mediaType]);
      });
    }

    function renderSpec(spec) {
      document.getElementById("api-title").textContent = spec.info && spec.info.title || "Senku API";
      document.getElementById("api-description").textContent = spec.info && spec.info.description || "";
      operations.replaceChildren();
      schemas.replaceChildren();
      securitySchemes.replaceChildren();

      const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
      Object.keys(spec.paths || {}).forEach(function (path) {
        const pathItem = spec.paths[path] || {};
        Object.keys(pathItem).filter(function (key) { return methods.has(key.toLowerCase()); }).forEach(function (method) {
          const operation = pathItem[method] || {};
          const article = document.createElement("article");
          article.className = "operation";
          const heading = document.createElement("h3");
          addText(heading, "span", method.toUpperCase(), "method");
          addText(heading, "code", path);
          article.appendChild(heading);
          if (operation.summary) addText(article, "p", operation.summary);
          if (operation.description) addText(article, "p", operation.description);

          const operationSecurity = Object.prototype.hasOwnProperty.call(operation, "security") ? operation.security : spec.security;
          addText(article, "p", operationSecurity && operationSecurity.length ? "Authentication required" : "Public endpoint", "muted");
          if (operation.parameters) addJsonDetails(article, "Parameters", operation.parameters);
          if (operation.requestBody) {
            const body = operation.requestBody;
            addText(article, "p", body.description || "Request body");
            addContentDetails(article, "Request", body.content);
          }

          const responseList = document.createElement("div");
          Object.keys(operation.responses || {}).forEach(function (code) {
            const response = operation.responses[code] || {};
            const responseSection = document.createElement("section");
            addText(responseSection, "h4", code + " — " + (response.description || "Response"));
            addContentDetails(responseSection, "Response", response.content);
            if (response.headers) addJsonDetails(responseSection, "Headers", response.headers);
            responseList.appendChild(responseSection);
          });
          article.appendChild(responseList);
          operations.appendChild(article);
        });
      });

      Object.keys(spec.components && spec.components.schemas || {}).forEach(function (name) {
        addJsonDetails(schemas, name, spec.components.schemas[name]);
      });
      Object.keys(spec.components && spec.components.securitySchemes || {}).forEach(function (name) {
        addJsonDetails(securitySchemes, name, spec.components.securitySchemes[name]);
      });

      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
      download.href = downloadUrl;
      documentation.hidden = false;
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const token = tokenInput.value.trim();
      tokenInput.value = "";
      status.textContent = "Loading your permission-filtered API contract…";
      documentation.hidden = true;
      try {
        const response = await fetch("/openapi.json", {
          method: "GET",
          headers: { Authorization: "Bearer " + token },
          credentials: "omit",
          cache: "no-store"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const spec = await response.json();
        renderSpec(spec);
        status.textContent = "Documentation loaded. The bearer token has been cleared from the input.";
      } catch (error) {
        status.textContent = "Could not load the specification. Check the token and service configuration, then try again.";
      }
    });
  </script>
</body>
</html>`;
}

export function apiDocsResponse(): Response {
  const nonce = createNonce();
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(renderHtml(nonce), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": contentSecurityPolicy,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export function apiDocsRedirectResponse(): Response {
  return new Response(null, {
    status: 308,
    headers: {
      location: "/docs/",
      "cache-control": "no-store",
    },
  });
}
