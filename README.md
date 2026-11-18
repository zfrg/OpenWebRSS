# WebRSS

一个无需构建工具、无需后端服务的静态 RSS 阅读器。将文件发布到任意静态网站托管服务即可使用。

## 配置

订阅源及阅读器设置支持以下优先顺序：

1. 在 [app.js](./app.js) 中将 `JS_CONFIG` 设为完整配置对象，直接使用该设置。
2. 在 [app.js](./app.js) 中填写 `CONFIG_FILE_URL`，从指定地址读取配置文件。
3. 自动读取与 `index.html` 同目录的 [config.json](./config.json)。
4. 如果配置文件不可用，则自动使用内置默认设置和 Solidot、Hacker News、BBC 中文订阅源，并在页面提示回退原因。

部署时建议遵循文件配置规则，直接维护同目录的 `config.json`，并保持 `JS_CONFIG` 为 `null`、`CONFIG_FILE_URL` 为空；只有需要覆盖设置或使用外部配置文件时，才修改这两个 JS 选项。

JSON 配置格式如下：

```json
{
  "feeds": [
    { "title": "示例站点", "url": "https://example.com/feed.xml" }
  ],
  "storageKey": "openwebrss-reader-read-v1",
  "corsProxy": "",
  "requestTimeoutMs": 15000,
  "maxReadArticles": 1500,
  "dateLocale": "zh-CN"
}
```

`feeds` 中每个订阅源需要设置 `title` 和 HTTP(S) `url`。`storageKey` 是浏览器本地已读状态的键名，`corsProxy` 是可选的跨域代理 URL 前缀；留空时只直连订阅源。如需代理，请由部署方提供并在部署配置中填写，不要将代理地址提交到仓库。`requestTimeoutMs` 是请求超时毫秒数，`maxReadArticles` 是保留的已读文章数量，`dateLocale` 是日期显示区域设置。

页面读取 RSS 2.0、RSS 1.0 和 Atom；点击文章标题可在站内查看订阅源提供的正文，若订阅源只提供摘要，可通过“查看原文”前往文章页面。已读状态保存在当前浏览器中。

页面适配手机屏幕，无需构建工具或运行时依赖。由于浏览器不允许网页通过 `file://` 读取 JSON，请通过任意 HTTP(S) 静态文件服务器或静态网站托管服务打开页面。

## 跨域说明

浏览器的同源策略会阻止网页直接读取许多 RSS 服务。阅读器先尝试直接请求订阅源；如果源站不允许跨域读取，可由部署方提供代理并配置 `corsProxy`。未配置代理时，页面会提示直连请求失败。订阅地址由浏览器直接请求，不会经过本项目的服务器。

文章正文会经过标签、属性、样式和 URL 白名单过滤后显示，支持常见排版、图片、表格及音视频；脚本、内嵌页面和不支持的内容会被移除。
