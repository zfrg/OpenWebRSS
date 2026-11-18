// 设置完整对象后优先使用此配置；设为 null 时读取配置文件。
const JS_CONFIG = null;
// 可选配置文件地址；留空时读取同目录下的 config.json。
const CONFIG_FILE_URL = "";
const DEFAULT_SETTINGS = {
  feeds: [
    { title: "Solidot", url: "https://www.solidot.org/index.rss" },
    { title: "Hacker News", url: "https://hnrss.org/frontpage" },
    { title: "BBC 中文", url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml" },
  ],
  storageKey: "openwebrss-reader-read-v1",
  corsProxy: "",
  requestTimeoutMs: 15000,
  maxReadArticles: 1500,
  dateLocale: "zh-CN",
};
const ALLOWED_TAGS = new Set([
  "A", "ABBR", "AUDIO", "B", "BDI", "BDO", "BLOCKQUOTE", "BR", "CAPTION",
  "CITE", "CODE", "COL", "COLGROUP", "DD", "DEL", "DETAILS", "DFN", "DIV",
  "DL", "DT", "EM", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5",
  "H6", "HR", "I", "IMG", "INS", "KBD", "LI", "MARK", "OL", "P", "PRE",
  "PICTURE", "Q", "S", "SAMP", "SOURCE", "SPAN", "STRONG", "SUB", "SUMMARY", "SUP",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL", "VAR",
  "TRACK", "VIDEO", "WBR",
]);
const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "TEMPLATE"]);
const elements = {
  feeds: document.querySelector("#feed-list"),
  articles: document.querySelector("#article-list"),
  status: document.querySelector("#status"),
  refresh: document.querySelector("#refresh-button"),
  reader: document.querySelector("#reader"),
  readerMeta: document.querySelector("#reader-meta"),
  readerTitle: document.querySelector("#reader-title"),
  readerContent: document.querySelector("#reader-content"),
  readerLink: document.querySelector("#reader-link"),
};

const feeds = [];
const LEGACY_STORAGE_KEY = "yuyue-reader-read-v1";
let invalidFeedCount = 0;
let settings;
let settingsWarning = "";
let readArticles = new Set();
let articles = [];
let selectedFeedId = null;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function loadReadArticles(storageKey) {
  try {
    let storedValue = localStorage.getItem(storageKey);
    if (storedValue === null && storageKey !== LEGACY_STORAGE_KEY) {
      storedValue = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (storedValue !== null) localStorage.setItem(storageKey, storedValue);
    }
    const stored = JSON.parse(storedValue || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch (error) {
    console.warn("无法读取已读状态。", error);
    return new Set();
  }
}

function saveReadArticles() {
  try {
    localStorage.setItem(settings.storageKey, JSON.stringify([...readArticles].slice(-settings.maxReadArticles)));
  } catch (error) {
    console.warn("无法保存已读状态。", error);
  }
}

function validateSettings(config, source) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${source} 顶层必须是 JSON 对象。`);
  }
  if (!Array.isArray(config.feeds)) throw new Error(`${source} 的 feeds 必须是数组。`);
  if (typeof config.storageKey !== "string" || !config.storageKey.trim()) {
    throw new Error(`${source} 的 storageKey 必须是非空字符串。`);
  }
  if (typeof config.corsProxy !== "string"
    || (config.corsProxy.trim() && !isHttpUrl(`${config.corsProxy.trim()}https://example.com`))) {
    throw new Error(`${source} 的 corsProxy 必须为空或有效的 HTTP(S) 代理地址前缀。`);
  }
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) {
    throw new Error(`${source} 的 requestTimeoutMs 必须是正整数。`);
  }
  if (!Number.isInteger(config.maxReadArticles) || config.maxReadArticles <= 0) {
    throw new Error(`${source} 的 maxReadArticles 必须是正整数。`);
  }
  if (typeof config.dateLocale !== "string" || !config.dateLocale.trim()) {
    throw new Error(`${source} 的 dateLocale 必须是非空字符串。`);
  }
  try {
    new Intl.DateTimeFormat(config.dateLocale);
  } catch {
    throw new Error(`${source} 的 dateLocale 不是有效的区域设置。`);
  }
  return { ...config, corsProxy: config.corsProxy.trim() };
}

async function fetchSettings(url, source) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const config = await response.json();
  return validateSettings(config, source);
}

async function loadSettings() {
  if (JS_CONFIG !== null) return validateSettings(JS_CONFIG, "app.js 中的 JS_CONFIG");

  let customConfigError = "";
  if (CONFIG_FILE_URL) {
    try {
      return await fetchSettings(CONFIG_FILE_URL, CONFIG_FILE_URL);
    } catch (error) {
      customConfigError = `指定配置文件加载失败：${error.message}`;
    }
  }

  try {
    const config = await fetchSettings("./config.json", "config.json");
    if (customConfigError) settingsWarning = `${customConfigError}；已改用同目录 config.json。`;
    return config;
  } catch (error) {
    const localConfigError = `同目录 config.json 加载失败：${error.message}`;
    settingsWarning = [customConfigError, localConfigError, "已使用内置默认设置。"].filter(Boolean).join("；");
    console.warn(settingsWarning);
    return DEFAULT_SETTINGS;
  }
}

function configureFeeds(configuredFeeds) {
  feeds.length = 0;
  invalidFeedCount = 0;
  for (const [index, feed] of configuredFeeds.entries()) {
    if (!feed || typeof feed.title !== "string" || !feed.title.trim() || !isHttpUrl(feed.url)) {
      invalidFeedCount += 1;
      continue;
    }
    feeds.push({ ...feed, id: `feed-${index}` });
  }
}

function textFrom(parent, selectors) {
  for (const selector of selectors) {
    const value = parent.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

function contentFrom(item) {
  const elements = [...item.getElementsByTagName("*")];
  const content = elements.find((element) =>
    element.localName === "encoded" || element.tagName === "content:encoded")
    || elements.find((element) => element.localName === "content")
    || elements.find((element) => element.localName === "description" || element.localName === "summary");
  if (!content) return "";
  if (![...content.childNodes].some((node) => node.nodeType === Node.ELEMENT_NODE)) {
    return content.textContent.trim();
  }
  return [...content.childNodes].map((node) => (
    node.nodeType === Node.ELEMENT_NODE ? new XMLSerializer().serializeToString(node) : node.textContent
  )).join("").trim();
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function safeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function itemLink(item, feedUrl) {
  const link = [...item.querySelectorAll("link")].find((node) => {
    const rel = node.getAttribute("rel");
    return !rel || rel === "alternate";
  });
  return safeUrl(
    link?.getAttribute("href") || link?.textContent?.trim() || textFrom(item, ["guid", "id"]),
    feedUrl,
  );
}

function parseFeed(xml, feed) {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.querySelector("parsererror")) throw new Error("订阅内容不是有效的 RSS 或 Atom XML。");

  const items = [...document.querySelectorAll("item, feed > entry, entry")];
  if (!items.length) throw new Error("没有找到文章，请检查订阅地址。");

  return items.map((item, index) => {
    const title = cleanText(textFrom(item, ["title"])) || "无标题";
    const link = itemLink(item, feed.url);
    const guid = textFrom(item, ["guid", "id"]);
    const rawContent = contentFrom(item);
    const rawSummary = textFrom(item, ["description", "summary"]) || rawContent;
    const summaryDocument = new DOMParser().parseFromString(rawSummary, "text/html");
    const dateText = textFrom(item, ["pubDate", "published", "updated", "dc\\:date"]);
    const timestamp = Date.parse(dateText);
    return {
      id: `${feed.url}:${link || guid || `${title}:${index}`}`,
      feedId: feed.id,
      feedTitle: feed.title,
      title,
      link,
      body: rawContent,
      summary: cleanText(summaryDocument.body.textContent || "").slice(0, 240),
      date: Number.isNaN(timestamp) ? 0 : timestamp,
    };
  }).filter((article) => article.link);
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  try {
    let response;
    try {
      response = await fetch(feed.url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (!settings.corsProxy) {
        throw new Error(`直接请求失败，且未配置跨域代理：${error.message}`);
      }
      response = await fetch(`${settings.corsProxy}${encodeURIComponent(feed.url)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`跨域代理返回 HTTP ${response.status}`);
    }
    return parseFeed(await response.text(), feed);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超时，请稍后重试。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(settings.dateLocale, { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(timestamp));
}

function makeSafeContent(raw, baseUrl) {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const fragment = document.createDocumentFragment();

  function copyDimension(source, target, name) {
    const value = source.getAttribute(name);
    if (value && /^\d{1,4}$/.test(value) && Number(value) > 0) {
      target.setAttribute(name, value);
    }
  }

  function copySafeStyles(source, target) {
    const allowed = {
      "text-align": /^(left|right|center|justify|start|end)$/i,
      "font-weight": /^(normal|bold|[1-9]00)$/i,
      "font-style": /^(normal|italic|oblique)$/i,
      "text-decoration": /^(none|underline|line-through|overline)$/i,
      "vertical-align": /^(baseline|sub|super|top|middle|bottom)$/i,
      "white-space": /^(normal|pre|pre-wrap|pre-line|nowrap)$/i,
      float: /^(left|right|none)$/i,
    };
    const size = /^(?:\d+(?:\.\d+)?(?:px|em|rem|%)|auto)$/i;

    for (const declaration of source.getAttribute("style")?.split(";") || []) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (allowed[property]?.test(value)) {
        target.style.setProperty(property, value);
      } else if (["color", "background-color"].includes(property)
        && !/(url|var|attr|expression)\s*\(/i.test(value)
        && typeof CSS !== "undefined" && CSS.supports?.(property, value)) {
        target.style.setProperty(property, value);
      } else if (["width", "max-width", "height", "max-height"].includes(property)
        && size.test(value) && (value === "auto" || parseFloat(value) <= 2000)) {
        target.style.setProperty(property, value);
      } else if (property === "font-size"
        && (/^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(value)
          || (/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i.test(value) && parseFloat(value) <= 100))) {
        target.style.setProperty(property, value);
      }
    }
  }

  function copyChildren(source, target) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.textContent));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || BLOCKED_TAGS.has(child.tagName)) continue;
      if (!ALLOWED_TAGS.has(child.tagName)) {
        copyChildren(child, target);
        continue;
      }
      const element = document.createElement(child.tagName.toLowerCase());
      copySafeStyles(child, element);
      if (child.tagName === "A") {
        const href = safeUrl(child.getAttribute("href"), baseUrl);
        if (href) {
          element.href = href;
          element.target = "_blank";
          element.rel = "noopener noreferrer";
        }
      } else if (child.tagName === "IMG") {
        const src = safeUrl(child.getAttribute("src"), baseUrl);
        if (!src) continue;
        element.src = src;
        element.alt = child.getAttribute("alt") || "";
        element.loading = "lazy";
        element.decoding = "async";
        copyDimension(child, element, "width");
        copyDimension(child, element, "height");
      } else if (child.tagName === "AUDIO" || child.tagName === "VIDEO") {
        element.controls = true;
        element.preload = "none";
        const src = safeUrl(child.getAttribute("src"), baseUrl);
        if (src) element.src = src;
        if (child.tagName === "VIDEO") {
          const poster = safeUrl(child.getAttribute("poster"), baseUrl);
          if (poster) element.poster = poster;
        }
        copyDimension(child, element, "width");
        copyDimension(child, element, "height");
      } else if (child.tagName === "SOURCE") {
        const src = safeUrl(child.getAttribute("src"), baseUrl);
        if (!src) continue;
        element.src = src;
      } else if (child.tagName === "TRACK") {
        const src = safeUrl(child.getAttribute("src"), baseUrl);
        if (!src) continue;
        element.src = src;
        const kind = child.getAttribute("kind");
        if (["subtitles", "captions", "descriptions", "chapters", "metadata"].includes(kind)) {
          element.kind = kind;
        }
        const language = child.getAttribute("srclang");
        if (language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) {
          element.srclang = language;
        }
        const label = child.getAttribute("label");
        if (label) element.label = label;
        if (child.hasAttribute("default")) element.default = true;
      } else if (child.tagName === "TD" || child.tagName === "TH") {
        for (const name of ["colspan", "rowspan"]) copyDimension(child, element, name);
        if (child.tagName === "TH" && ["row", "col", "rowgroup", "colgroup"].includes(child.getAttribute("scope"))) {
          element.scope = child.getAttribute("scope");
        }
      } else if (child.tagName === "ABBR" || child.tagName === "Q") {
        const title = child.getAttribute("title");
        if (title) element.title = title;
      }
      copyChildren(child, element);
      target.append(element);
    }
  }

  copyChildren(parsed.body, fragment);
  return fragment;
}

function renderFeeds() {
  elements.feeds.replaceChildren();
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `feed-button${selectedFeedId === null ? " is-active" : ""}`;
  allButton.textContent = "全部";
  allButton.setAttribute("aria-pressed", String(selectedFeedId === null));
  allButton.addEventListener("click", () => {
    selectedFeedId = null;
    renderFeeds();
    renderArticles(articles);
  });
  elements.feeds.append(allButton);

  for (const feed of feeds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `feed-button${selectedFeedId === feed.id ? " is-active" : ""}`;
    button.textContent = feed.title;
    button.setAttribute("aria-pressed", String(selectedFeedId === feed.id));
    button.addEventListener("click", () => {
      selectedFeedId = feed.id;
      renderFeeds();
      renderArticles(articles.filter((article) => article.feedId === feed.id));
    });
    elements.feeds.append(button);
  }
}

function renderArticles(list) {
  elements.articles.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = feeds.length ? "暂时没有文章。" : "当前没有可用订阅源。";
    elements.articles.append(empty);
    return;
  }

  for (const article of list) {
    const card = document.createElement("article");
    card.className = "article-card";
    const meta = document.createElement("p");
    meta.className = "article-meta";
    meta.textContent = [article.feedTitle, formatDate(article.date)].filter(Boolean).join(" · ");
    const title = document.createElement("button");
    title.type = "button";
    title.className = `article-title${readArticles.has(article.id) ? " is-read" : ""}`;
    title.textContent = article.title;
    title.addEventListener("click", () => openArticle(article, title));
    card.append(meta, title);
    if (article.summary) {
      const summary = document.createElement("p");
      summary.className = "article-summary";
      summary.textContent = article.summary;
      card.append(summary);
    }
    elements.articles.append(card);
  }
}

function renderLoading(message) {
  const loading = document.createElement("p");
  loading.className = "empty";
  loading.setAttribute("role", "status");
  loading.textContent = message;
  elements.articles.replaceChildren(loading);
}

function openArticle(article, titleButton) {
  elements.readerMeta.textContent = [article.feedTitle, formatDate(article.date)].filter(Boolean).join(" · ");
  elements.readerTitle.textContent = article.title;
  elements.readerContent.replaceChildren();
  if (article.body) elements.readerContent.append(makeSafeContent(article.body, article.link));
  const hasText = elements.readerContent.textContent.trim();
  const hasMedia = elements.readerContent.querySelector("img, video, audio, table");
  if (!hasText && !hasMedia) {
    const note = document.createElement("p");
    note.textContent = "订阅源没有提供正文，请查看原文。";
    elements.readerContent.append(note);
  }
  elements.readerLink.href = article.link;
  readArticles.add(article.id);
  saveReadArticles();
  titleButton.classList.add("is-read");
  elements.reader.hidden = false;
  document.querySelector("#close-reader").focus();
}

async function refreshFeeds() {
  if (!articles.length) {
    renderLoading(settings ? "正在加载订阅源…" : "正在加载配置和订阅源…");
  }

  if (!settings) {
    try {
      settings = await loadSettings();
      configureFeeds(settings.feeds);
      readArticles = loadReadArticles(settings.storageKey);
      renderFeeds();
    } catch (error) {
      elements.status.textContent = `配置加载失败：${error.message}`;
      elements.status.hidden = false;
      renderArticles([]);
      return;
    }
  }

  if (!feeds.length) {
    const feedMessage = invalidFeedCount
      ? "订阅源配置无效，请检查标题和 HTTP(S) 地址。"
      : "当前配置中没有订阅源。";
    elements.status.textContent = [settingsWarning, feedMessage].filter(Boolean).join("；");
    elements.status.hidden = false;
    renderArticles([]);
    return;
  }

  elements.refresh.disabled = true;
  elements.refresh.textContent = "加载中…";
  elements.status.hidden = true;
  const results = await Promise.allSettled(feeds.map(async (feed) => ({
    feed,
    articles: await fetchFeed(feed),
  })));
  const feedErrors = invalidFeedCount
    ? [`${invalidFeedCount} 个订阅源配置无效，请检查标题和 HTTP(S) 地址`]
    : [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "fulfilled") {
      articles = articles.filter((article) => article.feedId !== result.value.feed.id);
      articles.push(...result.value.articles);
    } else {
      feedErrors.push(`${feeds[index].title}：${result.reason.message}`);
    }
  }
  articles = [...new Map(articles.map((article) => [article.id, article])).values()]
    .sort((a, b) => b.date - a.date);
  elements.refresh.disabled = false;
  elements.refresh.textContent = "刷新";
  if (settingsWarning || feedErrors.length) {
    const feedErrorMessage = feedErrors.length
      ? `部分订阅源加载失败：${feedErrors.join("；")}`
      : "";
    elements.status.textContent = [settingsWarning, feedErrorMessage].filter(Boolean).join("；");
    elements.status.hidden = false;
  }
  renderArticles(selectedFeedId
    ? articles.filter((article) => article.feedId === selectedFeedId)
    : articles);
}

elements.refresh.addEventListener("click", refreshFeeds);
document.querySelector("#close-reader").addEventListener("click", () => {
  elements.reader.hidden = true;
});
elements.reader.addEventListener("click", (event) => {
  if (event.target === elements.reader) elements.reader.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") elements.reader.hidden = true;
});

renderFeeds();
refreshFeeds();
