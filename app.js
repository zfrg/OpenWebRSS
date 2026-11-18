// 部署时在这里维护 RSS / Atom 订阅源。
const FEEDS = [
  { title: "Solidot", url: "https://www.solidot.org/index.rss" },
  { title: "Hacker News", url: "https://hnrss.org/frontpage" },
  { title: "BBC 中文", url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml" },
];

const STORAGE_KEY = "yuyue-reader-read-v1";
const CORS_PROXY = "https://api.allorigins.win/raw?url=";
const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "EM", "H1", "H2", "H3",
  "HR", "I", "LI", "OL", "P", "PRE", "STRONG", "UL",
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
let invalidFeedCount = 0;
for (const [index, feed] of FEEDS.entries()) {
  if (!feed || typeof feed.title !== "string" || !feed.title.trim() || !isHttpUrl(feed.url)) {
    invalidFeedCount += 1;
    continue;
  }
  feeds.push({ ...feed, id: `feed-${index}` });
}
const readArticles = loadReadArticles();
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

function loadReadArticles() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch (error) {
    console.warn("无法读取已读状态。", error);
    return new Set();
  }
}

function saveReadArticles() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readArticles].slice(-1500)));
  } catch (error) {
    console.warn("无法保存已读状态。", error);
  }
}

function textFrom(parent, selectors) {
  for (const selector of selectors) {
    const value = parent.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
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
    const rawContent = textFrom(item, ["content\\:encoded", "content", "description", "summary"]);
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
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    try {
      response = await fetch(feed.url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      response = await fetch(`${CORS_PROXY}${encodeURIComponent(feed.url)}`, {
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
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(timestamp));
}

function makeSafeContent(raw) {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const fragment = document.createDocumentFragment();

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
      if (child.tagName === "A") {
        const href = safeUrl(child.getAttribute("href"), window.location.href);
        if (href) {
          element.href = href;
          element.target = "_blank";
          element.rel = "noopener noreferrer";
        }
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
    empty.textContent = feeds.length ? "暂时没有文章。" : "请在 app.js 中配置 RSS 订阅源。";
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

function openArticle(article, titleButton) {
  elements.readerMeta.textContent = [article.feedTitle, formatDate(article.date)].filter(Boolean).join(" · ");
  elements.readerTitle.textContent = article.title;
  elements.readerContent.replaceChildren();
  if (article.body) elements.readerContent.append(makeSafeContent(article.body));
  if (!elements.readerContent.textContent.trim()) {
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
  if (!feeds.length) {
    elements.status.textContent = invalidFeedCount
      ? "订阅源配置无效，请检查 app.js 中的标题和 http(s) 地址。"
      : "请在 app.js 中配置 RSS 订阅源。";
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
  const errors = invalidFeedCount
    ? [`${invalidFeedCount} 个订阅源配置无效，请检查 app.js 中的标题和 http(s) 地址`]
    : [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "fulfilled") {
      articles = articles.filter((article) => article.feedId !== result.value.feed.id);
      articles.push(...result.value.articles);
    } else {
      errors.push(`${feeds[index].title}：${result.reason.message}`);
    }
  }
  articles = [...new Map(articles.map((article) => [article.id, article])).values()]
    .sort((a, b) => b.date - a.date);
  elements.refresh.disabled = false;
  elements.refresh.textContent = "刷新";
  if (errors.length) {
    elements.status.textContent = `部分订阅源加载失败：${errors.join("；")}`;
    elements.status.hidden = false;
  }
  renderArticles(selectedFeedId
    ? articles.filter((article) => article.feedId === selectedFeedId)
    : articles);
}

document.querySelector("#refresh-button").addEventListener("click", refreshFeeds);
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
