(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const build = window.JournalLensBuild || {};
  const ADAPTER_VERSION = build.version || "0.4.2";
  const FORM_WAIT_MS = 30000;
  const SUCCESS_NOTICE_MS = 4500;
  const WARNING_NOTICE_MS = 8000;
  const state = {
    request: null,
    requestId: "",
    autoLookup: true,
    debugMode: false,
    completed: false,
    deadline: 0,
    observer: null,
    retryTimer: 0,
    dismissTimer: 0,
    bannerHost: null,
    statusText: "",
    statusTone: "info",
    copyStatus: ""
  };

  if (window.__journalLensAbleSciInjected) return;
  window.__journalLensAbleSciInjected = true;
  init();

  function debugFeaturesAvailable() {
    return build.enableDebug !== false;
  }

  async function init() {
    state.requestId = requestIdFromHash();
    const response = await getPendingRequest();
    if (!response || !response.ok || response.disabled || !response.request) return;

    state.request = response.request;
    state.requestId = response.request.requestId;
    state.autoLookup = response.autoLookup !== false;
    state.debugMode = debugFeaturesAvailable() && Boolean(response.debugMode);

    if (isLoginPage()) {
      renderBanner("请先登录科研通；登录完成后将继续填写 DOI。", "info");
      sendStatus("login-required");
      return;
    }

    if (!isAssistCreatePage()) {
      renderBanner("正在打开科研通文献求助表单…", "info");
      window.setTimeout(() => {
        const suffix = `#journal-lens=${encodeURIComponent(state.requestId)}`;
        location.assign(`https://www.ablesci.com/assist/create${suffix}`);
      }, 350);
      return;
    }

    removeRequestFragment();
    state.deadline = Date.now() + FORM_WAIT_MS;
    renderBanner("正在识别科研通 DOI 查询表单…", "info");
    startFormAdapter();
  }

  async function getPendingRequest() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "JournalLens:getAbleSciPending",
          requestId: state.requestId
        });
        if (response && (response.request || response.disabled)) return response;
      } catch (_error) {
        // The service worker can take a moment to wake after the new tab opens.
      }
      await wait(220 * (attempt + 1));
    }
    return null;
  }

  function startFormAdapter() {
    attemptFormFill();
    state.observer = new MutationObserver(() => scheduleAttempt(120));
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "disabled", "hidden", "placeholder", "style"],
      childList: true,
      subtree: true
    });
    scheduleAttempt(450);
  }

  function scheduleAttempt(delay) {
    if (state.completed) return;
    window.clearTimeout(state.retryTimer);
    state.retryTimer = window.setTimeout(attemptFormFill, delay);
  }

  function attemptFormFill() {
    if (state.completed || !state.request) return;
    const scope = findAssistScope();
    const doiInput = findDoiInput(scope);
    if (!doiInput) {
      if (Date.now() >= state.deadline) {
        finishWaiting();
        return;
      }
      scheduleAttempt(500);
      return;
    }

    sendStatus("form-detected");
    const doi = shared.normalizeDoi(state.request.record && state.request.record.doi);
    const currentValue = shared.collapseWhitespace(doiInput.value);
    const currentDoi = shared.normalizeDoi(currentValue);
    if (currentValue && currentDoi !== doi) {
      completeAdapter("DOI 输入框已有其他内容，Journal Lens 未进行覆盖。", "warning");
      return;
    }

    if (currentDoi !== doi) setNativeValue(doiInput, doi);
    doiInput.focus({ preventScroll: true });
    doiInput.dispatchEvent(new Event("blur", { bubbles: true }));
    sendStatus("doi-filled");

    if (!state.autoLookup) {
      completeAdapter("已填入 DOI；请在科研通页面查询并核对后手动发布。", "success");
      return;
    }

    const queryButton = findQueryButton(scope || doiInput.closest("form") || document);
    if (!queryButton) {
      completeAdapter("已填入 DOI；未识别到自动查询按钮，请手动点击查询。", "warning");
      return;
    }

    window.setTimeout(() => {
      if (!queryButton.isConnected || isDisabled(queryButton)) {
        completeAdapter("已填入 DOI；查询按钮当前不可用，请手动继续。", "warning");
        return;
      }
      queryButton.click();
      sendStatus("lookup-triggered");
      completeAdapter("已填入 DOI 并触发元数据查询；请核对后手动发布。", "success");
    }, 180);
  }

  function finishWaiting() {
    completeAdapter(debugFeaturesAvailable()
      ? "未识别当前发布表单；请手动填写 DOI。Debug 模式可复制安全诊断。"
      : "未识别当前发布表单；请手动填写 DOI。", "warning");
  }

  function completeAdapter(message, tone) {
    state.completed = true;
    window.clearTimeout(state.retryTimer);
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    renderBanner(message, tone);
    scheduleBannerDismiss(tone === "success" ? SUCCESS_NOTICE_MS : WARNING_NOTICE_MS);
  }

  function scheduleBannerDismiss(delay) {
    window.clearTimeout(state.dismissTimer);
    state.dismissTimer = window.setTimeout(() => dismissBanner("auto-dismissed"), delay);
  }

  function dismissBanner(status) {
    window.clearTimeout(state.dismissTimer);
    state.dismissTimer = 0;
    if (!state.bannerHost) return;
    if (status) sendStatus(status);
    state.bannerHost.remove();
    state.bannerHost = null;
  }

  function findAssistScope() {
    const candidates = [...document.querySelectorAll([
      "form",
      "main",
      "[role='dialog']",
      "[class*='modal' i]",
      "[class*='assist' i]",
      "[class*='create' i]",
      "[class*='publish' i]"
    ].join(","))];
    let best = null;
    let bestScore = 0;
    candidates.forEach((node) => {
      if (node.closest(".journal-lens-ablesci-host")) return;
      const text = shared.collapseWhitespace(node.innerText || node.textContent).slice(0, 3000);
      let score = 0;
      if (/发布文献求助|文献求助/.test(text)) score += 12;
      if (/自动查询|智能查询|文献识别/.test(text)) score += 10;
      if (/一键发布|立即发布|发布求助/.test(text)) score += 5;
      if (node.matches("form")) score += 4;
      if (node.querySelector("input,textarea")) score += 2;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return best || document.querySelector("main") || document.body;
  }

  function findDoiInput(scope) {
    const roots = [...new Set([scope, document].filter(Boolean))];
    const candidates = roots.flatMap((root) => [...root.querySelectorAll("input,textarea")])
      .filter((node, index, all) => all.indexOf(node) === index)
      .filter((node) => !["password", "hidden", "file", "checkbox", "radio"].includes(String(node.type).toLowerCase()))
      .filter(isVisible);
    let best = null;
    let bestScore = 0;
    candidates.forEach((node) => {
      const attributes = [
        node.name,
        node.id,
        node.placeholder,
        node.getAttribute("aria-label"),
        node.getAttribute("data-field"),
        labelFor(node)
      ].map(shared.collapseWhitespace).join(" ");
      let score = 0;
      if (node.id === "onekey" || node.name === "onekey") score += 40;
      if (/\bdoi\b/i.test(attributes)) score += 20;
      if (/doi/i.test(attributes)) score += 12;
      if (/doi.*(?:标题|title|pmid)|(?:标题|title|pmid).*doi/i.test(attributes)) score += 7;
      if (/文献.*(?:信息|编号|标识)|论文.*(?:信息|编号)/i.test(attributes)) score += 3;
      if (node.closest("form") && /求助|assist|create|publish/i.test(node.closest("form").className || "")) score += 2;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return bestScore >= 7 ? best : null;
  }

  function findQueryButton(scope) {
    const roots = [...new Set([scope, document].filter(Boolean))];
    const buttons = roots.flatMap((root) => [
      ...root.querySelectorAll("button,input[type='button'],input[type='submit'],[role='button']")
    ])
      .filter((node, index, all) => all.indexOf(node) === index)
      .filter((node) => !node.closest(".journal-lens-ablesci-host"))
      .filter(isVisible);
    let best = null;
    let bestScore = 0;
    buttons.forEach((node) => {
      const text = buttonText(node);
      const attributes = shared.collapseWhitespace([
        node.className,
        node.id,
        node.title,
        node.getAttribute("aria-label")
      ].join(" "));
      const compactText = text.replace(/\s+/g, "");
      const compactAttributes = attributes.replace(/\s+/g, "");
      const type = String(node.type || "").toLowerCase();
      if (!text || type === "submit") return;
      if (/发布|提交|求助|登录|注册|上传/.test(`${compactText} ${compactAttributes}`)) return;
      if (/\b(?:submit|publish|post|request|login|sign\s*in|register|upload)\b/i.test(`${text} ${attributes}`)) return;
      let score = 0;
      if (node.classList.contains("onekey-search")) score += 60;
      if (/查询该doi的论文信息/i.test(compactAttributes)) score += 45;
      if (/智能提取文献信息/.test(compactText)) score += 40;
      if (/^自动查询$/.test(compactText)) score += 30;
      if (/自动.*(?:查询|识别|获取|提取)/.test(compactText)) score += 22;
      if (/智能.*(?:查询|识别|获取|提取)/.test(compactText)) score += 18;
      if (/查询文献|文献查询|识别文献|获取文献信息|提取文献信息/.test(compactText)) score += 16;
      if (/查询|识别|检索|提取/.test(compactText)) score += 8;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return bestScore >= 8 ? best : null;
  }

  function setNativeValue(node, value) {
    const prototype = node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(node, value);
    else node.value = value;
    node.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: "insertText"
    }));
    node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function isLoginPage() {
    return /\/site\/(?:login|signin)/i.test(location.pathname)
      || Boolean(document.querySelector("input[type='password']"));
  }

  function isAssistCreatePage() {
    return /\/assist\/create\/?$/i.test(location.pathname);
  }

  function requestIdFromHash() {
    return shared.collapseWhitespace(new URLSearchParams(location.hash.slice(1)).get("journal-lens"));
  }

  function removeRequestFragment() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("journal-lens")) return;
    params.delete("journal-lens");
    const nextHash = params.toString() ? `#${params.toString()}` : "";
    history.replaceState(history.state, "", `${location.pathname}${location.search}${nextHash}`);
  }

  function renderBanner(message, tone) {
    state.statusText = message;
    state.statusTone = tone || "info";
    if (!state.bannerHost || !state.bannerHost.isConnected) {
      state.bannerHost = document.createElement("div");
      state.bannerHost.className = "journal-lens-ablesci-host";
      state.bannerHost.attachShadow({ mode: "open" });
      (document.body || document.documentElement).append(state.bannerHost);
    }
    const doi = shared.normalizeDoi(state.request && state.request.record && state.request.record.doi);
    const shadow = state.bannerHost.shadowRoot;
    replaceShadowMarkup(shadow, `
      <style>
        :host { all:initial; position:fixed; right:18px; top:18px; z-index:2147483647; }
        .notice { background:#fff; border:1px solid #cbd5e1; border-left:4px solid #2563eb; border-radius:7px; box-shadow:0 16px 36px rgba(15,23,42,.2); box-sizing:border-box; color:#0f172a; font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; max-width:calc(100vw - 36px); padding:11px 40px 11px 12px; position:relative; width:390px; }
        .notice.success { border-left-color:#0f766e; }
        .notice.warning { border-left-color:#d97706; }
        .heading { align-items:center; display:flex; font-size:13px; font-weight:800; gap:7px; }
        .mark { align-items:center; background:#0f766e; border-radius:4px; color:#fff; display:inline-flex; font-size:10px; height:19px; justify-content:center; min-width:22px; }
        p { color:#334155; font-size:12px; line-height:1.45; margin:7px 0 0; }
        code { background:#f1f5f9; border-radius:4px; color:#334155; display:block; font-family:Consolas,"SFMono-Regular",monospace; font-size:11px; margin-top:7px; overflow:hidden; padding:4px 6px; text-overflow:ellipsis; white-space:nowrap; }
        .close { appearance:none; background:transparent; border:0; color:#64748b; cursor:pointer; font-size:21px; height:30px; line-height:1; position:absolute; right:5px; top:5px; width:30px; }
        .debug { appearance:none; background:#fff; border:1px solid #94a3b8; border-radius:5px; color:#334155; cursor:pointer; font-size:11px; font-weight:750; margin-top:8px; min-height:27px; padding:0 8px; }
        .copy-status { color:#047857; font-size:11px; margin-left:8px; }
        button:focus-visible { outline:2px solid #38bdf8; outline-offset:2px; }
      </style>
      <section class="notice ${escapeAttribute(state.statusTone)}" role="status" aria-live="polite">
        <button type="button" class="close" title="关闭" aria-label="关闭">×</button>
        <div class="heading"><span class="mark">JL</span><span>文献求助辅助</span></div>
        <p>${escapeHtml(state.statusText)}</p>
        ${doi ? `<code title="${escapeAttribute(doi)}">${escapeHtml(doi)}</code>` : ""}
        ${state.debugMode
          ? `<button type="button" class="debug">复制安全诊断</button><span class="copy-status">${escapeHtml(state.copyStatus)}</span>`
          : ""}
      </section>`);
    shadow.querySelector(".close").addEventListener("click", () => {
      dismissBanner("dismissed");
    });
    const debugButton = shadow.querySelector(".debug");
    if (debugButton) debugButton.addEventListener("click", async () => {
      const copied = await copyText(JSON.stringify(buildSafeDiagnostic(), null, 2));
      state.copyStatus = copied ? "已复制" : "复制失败";
      renderBanner(state.statusText, state.statusTone);
    });
  }

  function replaceShadowMarkup(shadow, markup) {
    const range = document.createRange();
    range.selectNode(document.body || document.documentElement);
    shadow.replaceChildren(range.createContextualFragment(markup));
  }

  function buildSafeDiagnostic() {
    const scope = findAssistScope();
    return {
      adapterVersion: ADAPTER_VERSION,
      capturedAt: new Date().toISOString(),
      page: {
        origin: location.origin,
        pathname: location.pathname,
        title: document.title
      },
      state: {
        autoLookup: state.autoLookup,
        completed: state.completed,
        status: state.statusText
      },
      request: {
        doi: shared.normalizeDoi(state.request && state.request.record && state.request.record.doi)
      },
      scope: elementDescriptor(scope),
      inputs: [...document.querySelectorAll("input,textarea,select")]
        .filter((node) => String(node.type).toLowerCase() !== "password")
        .slice(0, 120)
        .map((node) => ({
          ...elementDescriptor(node),
          type: node.type || "",
          name: node.name || "",
          placeholder: node.placeholder || "",
          ariaLabel: node.getAttribute("aria-label") || "",
          label: labelFor(node),
          hasValue: Boolean(node.value)
        })),
      buttons: [...document.querySelectorAll("button,input[type='button'],input[type='submit'],[role='button']")]
        .filter((node) => !node.closest(".journal-lens-ablesci-host"))
        .slice(0, 120)
        .map((node) => ({ ...elementDescriptor(node), text: buttonText(node), type: node.type || "" }))
    };
  }

  function elementDescriptor(node) {
    if (!node) return null;
    return {
      tag: node.tagName || "",
      id: node.id || "",
      className: typeof node.className === "string" ? node.className.slice(0, 400) : ""
    };
  }

  function labelFor(node) {
    const labels = [];
    if (node.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
        if (explicit) labels.push(explicit.textContent);
      } catch (_error) {
        // Ignore malformed publisher-generated IDs.
      }
    }
    const wrapping = node.closest("label");
    if (wrapping) labels.push(wrapping.textContent);
    const parent = node.parentElement;
    if (parent) {
      const nearby = parent.querySelector(":scope > label,:scope > .label,:scope > [class*='label' i]");
      if (nearby && nearby !== wrapping) labels.push(nearby.textContent);
    }
    return shared.collapseWhitespace(labels.join(" ")).slice(0, 300);
  }

  function buttonText(node) {
    return shared.collapseWhitespace(node.value || node.innerText || node.textContent || node.getAttribute("aria-label"));
  }

  function isVisible(node) {
    if (!node || node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isDisabled(node) {
    return Boolean(node.disabled || node.getAttribute("aria-disabled") === "true");
  }

  function sendStatus(status) {
    chrome.runtime.sendMessage({
      type: "JournalLens:updateAbleSciPending",
      requestId: state.requestId,
      status
    }).catch(() => undefined);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
      } catch (_fallbackError) {
        return false;
      }
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();



