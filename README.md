# Journal Lens

Journal Lens 是一个 Manifest V3 Chrome 插件，用于在常见学术出版网站上显示期刊指标，并提供不改写论文标题链接的检索按钮。

当前源码默认保留 Debug 能力；发布版通过 `tools/build.ps1` 生成。release 包会隐藏设置页 Debug 开关，并强制关闭参考文献调试弹窗与科研通安全诊断入口；debug 包保留这些入口用于后续迭代。

## 项目目录

```text
Journal Lens/
├── extension/       浏览器扩展源码，可直接作为“已解压的扩展”加载
├── tests/           离线及浏览器烟雾测试
├── tools/           构建与开发工具
├── external-data/   开发测试使用的外部数据，不进入发布包
├── releases/        已生成的构建目录和压缩包
├── docs/            隐私政策等项目文档
└── README.md        项目说明
```

## 已实现

- 在文章页读取 `citation_*`、Dublin Core、Open Graph、JSON-LD 和 URL 中的 DOI/期刊元数据。
- 在标题附近插入独立的 Journal Lens 徽标，显示导入数据里的新锐分区、JCR 分区、影响因子和年份。
- PubMed 检索结果按每条论文独立识别，不在列表页显示伪造的页面级期刊组件。
- Recommended Articles、References 和常见论文列表会逐条显示指标入口；可在设置中选择点击加载、自动加载或关闭。
- ScienceDirect References 按每条编号与正文成对解析；没有 DOI、只有 Google Scholar 链接的参考文献也会按期刊名显示指标入口。
- ScienceDirect 直接从题录中的期刊、卷号和年份识别指标，不依赖延迟出现的外链；参考文献区的外链不会再触发重复组件。
- Nature References 使用独立题录解析器识别斜体期刊名，组件嵌入题录内部的独立行，不会挤压原文布局。
- Wiley Recommended 直接读取每条记录的来源期刊；Wiley References 支持折叠区手动展开和无 DOI 链接的题录。
- PubMed 通过 PMID 补全期刊全名和 ISSN，其他 DOI 文献可通过 OpenAlex 补全来源期刊，补全结果会缓存 30 天。
- 在 ACS、ScienceDirect、Springer、Nature、Wiley、RSC、OUP、Taylor & Francis、SAGE、IEEE、ACM、PubMed、MDPI、Frontiers、PLOS、arXiv、bioRxiv、medRxiv、Science、IOP、AIP、Cambridge、Cell、Lancet 等站点启用。
- 支持 CSV/JSON 导入期刊数据，导入后用 ISSN 优先、期刊名兜底匹配。
- 支持从 `hitfyd/ShowJCR` 一键加载 JCR2025、XR2026 和中科院升级版 2025 CSV 元数据。
- 支持 EasyScholar 期刊等级 API，可选择 API 独立查询，或以本地数据优先并由 API 补充缺失及扩展指标。
- EasyScholar SecretKey 只保存在 Chrome 扩展本地存储中，请求由后台 service worker 发起；内容脚本和 Debug JSON 不接收密钥。
- EasyScholar 请求按每秒不超过 2 次限速，同一期刊结果缓存 30 天；测试按钮会绕过缓存验证当前 SecretKey。
- 文章及逐条参考文献在存在 DOI 时显示蓝色 `?` 求助图标；点击后会打开科研通求助页并通过扩展后台临时传递 DOI，不把 DOI 暴露在跳转 URL 中。
- 科研通表单辅助只填写 DOI，并可选触发网站自己的元数据查询；不会读取登录密码，也不会点击最终“发布/提交”按钮。
- 科研通求助页优先适配 `#onekey` 输入框与 `.onekey-search` 智能提取按钮。
- 支持 Google Scholar、DOI、OpenAlex 和自定义合法检索 URL 模板。
- 可选使用 OpenAlex 补充开放指标，例如 2-year mean citedness。
- 右键菜单支持检索选中文本。
- 弹窗可将当前文章导出为 BibTeX 或 RIS 文件；缺少 DOI 时仍会保留已识别的题名、期刊和页面 URL。
- 所有页面增强都在插件自己的 Shadow DOM 中渲染，不监听或覆盖论文标题点击事件。

## 为什么没有内置 Sci-Hub

Sci-Hub 常用于绕过出版商授权获取论文全文。这个插件不内置、不推荐、也不自动化 Sci-Hub 跳转。默认检索入口是 Google Scholar，也可以切换到 DOI 或 OpenAlex；如果你所在机构有图书馆代理、馆藏发现系统、LibKey、OpenAthens 或其他合规入口，可以在设置页配置自定义 URL 模板。

## 安装测试

1. 打开 Chrome 的 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目下的 `extension/` 目录。
5. 打开支持的网站论文页，点击浏览器工具栏里的 Journal Lens，或查看文章标题附近的徽标。

修改或升级插件后，需要在扩展管理页点击“重新加载”，并刷新已经打开的论文页面。
## 发布构建

在 PowerShell 中运行以下命令生成商店上传包：

```powershell
.\tools\build.ps1 -Channel release -Browser edge
.\tools\build.ps1 -Channel release -Browser firefox -FirefoxId "journal-lens@lyusai.local"
```

如需保留调试能力用于后续开发，可生成调试包：

```powershell
.\tools\build.ps1 -Channel debug -Browser edge
```

构建产物位于 `releases/`。release 产物只复制 `extension/` 中运行所需的文件，不包含 `tests/`、`.git/`、开发截图或 `external-data/showjcr` 下载元数据；Firefox 产物会移除 Chromium 专属的 `minimum_chrome_version` / `version_name` 字段，并加入 `background.scripts` fallback、`browser_specific_settings.gecko.id` 和数据收集声明（`websiteContent`、`authenticationInfo`）。Firefox ID 发布后不宜更改。

仓库内存在 `external-data/showjcr` 三份本地 CSV 时，可运行 `node tests/local-showjcr-smoke.js` 离线验证期刊缩写匹配。`node tests/easyscholar-smoke.js` 可离线验证 API 返回结构的解析；测试不会使用 SecretKey，也不会联网调用 EasyScholar。`node tests/ablesci-smoke.js` 使用本地模拟页面验证 DOI 填写、查询触发和“绝不自动发布”的安全边界。

## 科研通求助辅助

1. 在设置页开启“科研通表单辅助”，并选择是否在填入 DOI 后自动触发元数据查询。
2. 在文章组件、参考文献组件或扩展弹窗中点击蓝色 `?` 图标。
3. 如尚未登录，请在科研通页面自行登录；插件不会读取或保存账号、密码和登录令牌。
4. 插件识别求助表单后填入 DOI，并按设置触发“查询/识别”类按钮。
5. 核对题名、期刊、求助类型、积分及其他字段后，由你手动点击最终发布。

待处理 DOI 在支持的浏览器中保存在 `chrome.storage.session`；Firefox 缺失该 API 时会回退到扩展本地存储，但仍绑定新打开的标签页，并在 20 分钟后或标签页关闭时清理。Debug 模式下科研通页可复制安全诊断，其中不包含表单值、密码、Cookie、令牌或完整 HTML。

Journal Lens 感谢 ShowJCR 提供公开期刊指标元数据、EasyScholar 提供期刊等级查询接口，以及科研通提供文献互助服务。Powered by Codex。

## 指标来源

设置页提供三种数据获取方式：导入 CSV/JSON、加载 ShowJCR 元数据、调用 EasyScholar API。前两种会写入同一份本地期刊数据集；页面查询方式可选：

- `本地数据`：仅使用导入的 CSV/JSON 或 ShowJCR 数据，不调用 EasyScholar。
- `本地优先 + EasyScholar 补充`：本地的新锐、中科院、JCR、IF 等核心字段优先，EasyScholar 补充本地空缺及 JCI、五年 IF、自定义等级等所选字段。
- `EasyScholar API`：页面指标仅采用 EasyScholar 返回值，本地数据只用于把题录中的期刊缩写解析为全称。

在设置页填写自己的 SecretKey，选择展示字段，并使用“测试接口”验证。SecretKey 不包含在项目文件中。

## 导入数据

设置页支持 CSV 或 JSON。CSV 表头可以使用中文或英文别名，推荐字段如下：

```csv
journal,issn,eissn,xinrui_partition,jcr_quartile,impact_factor,year,source,updated_at
```

也可以直接点击设置页里的“从 ShowJCR 加载”。插件会从 `https://github.com/hitfyd/ShowJCR` 下载这些 CSV，并合并为内部数据集：

- `JCR2025-UTF8.csv`
- `XR2026-UTF8.csv`
- `FQBJCR2025-UTF8.csv`

字段说明：

- `journal`：期刊名，必填项之一。
- `issn` / `eissn`：印刷版或电子版 ISSN，推荐至少提供一个。
- `xinrui_partition`：新锐分区。
- `jcr_quartile`：JCR 分区，例如 `Q1`。
- `impact_factor`：影响因子。
- `cas_partition`：中科院升级版分区，可选。
- `year`：数据年份。
- `source`：数据来源。
- `updated_at`：数据更新时间。

JSON 可以是数组，也可以是包含 `rows` 数组的对象：

```json
{
  "rows": [
    {
      "journal": "Example Journal",
      "issn": "0000-0000",
      "xinrui_partition": "1区",
      "jcr_quartile": "Q1",
      "impact_factor": "12.345",
      "year": "2026"
    }
  ]
}
```

## 自定义检索 URL

设置页的自定义模板支持这些占位符：

- `{doi}`：URL 编码后的 DOI。
- `{rawDoi}`：未编码 DOI。
- `{title}`：URL 编码后的文章标题。
- `{journal}`：URL 编码后的期刊名。
- `{url}`：URL 编码后的当前页面地址。
- `{query}`：由 DOI、标题和期刊名组成的 URL 编码查询词。

示例：

```text
https://your-library.example.edu/search?q={query}
```

## 后续可扩展

- 增加更多站点的专用 DOM 适配器。
- 增加机构代理解析模板预设。
- 增加列表页 DOI 批量复制和批量 BibTeX/RIS 导出。
- 增加本地数据集版本提醒。





