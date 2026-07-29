# Journal Lens

Journal Lens 是一款面向科研阅读的浏览器扩展。它会识别论文页面中的期刊、DOI、PMID 等信息，在文章标题、推荐文章和参考文献附近显示期刊指标，并提供明确、可控的文献检索与导出入口。

扩展不会改写论文标题链接，也不会自动提交文献求助。所有检索、导出和求助操作都由用户主动触发。

## 主要功能

- 在论文页面显示新锐分区、中科院分区、JCR 分区、影响因子及年份。
- 为推荐文章和参考文献逐条识别期刊，并按设置选择点击加载、自动加载或关闭。
- 支持通过期刊名或 ISSN 匹配本地导入的 CSV/JSON 数据。
- 可从 ShowJCR 加载公开的 JCR、新锐和中科院分区数据。
- 可选接入 EasyScholar API，使用本地数据优先、API 补充或纯 API 查询模式。
- 可通过 Google Scholar、DOI、OpenAlex 或自定义 URL 模板检索文献。
- 可将当前文章导出为 BibTeX 或 RIS；没有 DOI 时仍保留已识别的题名、期刊和页面地址。
- 可搜索、安装或导入 CSL 样式，并按默认样式复制包含作者、年份、卷期页码和 DOI 的格式化题录。
- 可选提供科研通 DOI 填写辅助；扩展不会读取密码，也不会点击最终发布按钮。
- 支持右键检索选中的文字。

## 支持的网站

Journal Lens 支持常见学术出版与检索网站，包括：

- ACS、ScienceDirect、Springer、Nature、Wiley、RSC
- Oxford Academic、Taylor & Francis、SAGE、IEEE、ACM
- PubMed、MDPI、Frontiers、PLOS
- arXiv、bioRxiv、medRxiv
- Science、IOP、AIP、Cambridge、Cell、The Lancet

网站页面结构可能随时调整；如果某个页面没有正确识别，可通过 GitHub Issues 提交页面地址和问题描述，请勿附带账号、Cookie、API Key 或其他敏感信息。

## 安装

### Chrome 或 Edge

1. 下载或克隆本仓库。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择仓库中的 `extension/` 目录。

更新源码后，需要在扩展管理页点击“重新加载”，并刷新已经打开的论文页面。

## 使用方法

### 查看期刊指标

打开支持的论文页面后，Journal Lens 会识别文章元数据，并在标题附近显示指标入口。推荐文章和参考文献是否自动显示指标，可在设置页调整。

当网页打开 Cite 等模态对话框时，页面内的 Journal Lens 指标组件会暂时隐藏，并在对话框关闭后自动恢复，避免遮挡网站原有操作。

点击浏览器工具栏中的 Journal Lens 图标，可以查看当前文章信息、打开检索入口，或导出 BibTeX/RIS。

### 复制格式化文献题录

1. 打开设置页的“文献题录格式”区域。
2. 输入期刊名称、样式名称或 ISSN，从官方 CSL `v1.0.2` 样式索引中选择候选项并安装；也可以导入本地 `.csl` 文件。
3. 在已安装样式中预览并设置默认样式。dependent style 会自动下载并缓存其 `independent-parent`。
4. 打开单篇论文并点击扩展图标。弹窗会显示默认样式和题录预览。
5. 点击“复制题录”。支持的浏览器会同时写入 `text/plain` 和 `text/html`，因此粘贴到 Word 等富文本编辑器时可保留斜体、粗体和上下标；不支持富文本剪贴板时自动回退到纯文本。

扩展内置 APA、Elsevier Vancouver 和 American Chemical Society 样式以及 `en-US`、`zh-CN` locale，可离线使用。样式搜索索引、已安装样式、父样式、locale 和 DOI 元数据分别缓存在扩展本地。点击“刷新元数据”可绕过 30 天 DOI 元数据缓存。

首期只支持单篇文献和 CSL，不解析 EndNote `.ens` 文件。

### 配置指标数据

在扩展设置页选择所需的数据来源：

- **本地数据**：仅使用导入的 CSV/JSON 或 ShowJCR 数据。
- **本地优先 + EasyScholar 补充**：保留本地核心指标，并由 EasyScholar 补充缺失字段。
- **EasyScholar API**：页面指标以 EasyScholar 返回结果为准。

ShowJCR 的新锐与中科院分区会保留对应的大类名称，例如显示为“新锐 农林科学2区”和“中科院 农林科学3区”；不展示来源年份和期刊位次。新锐分区只比较大类候选，不会用排名更高的小类分区覆盖大类结果。

ShowJCR 与 EasyScholar 共用“指标展示字段”设置。双方支持的字段使用同一开关，EasyScholar 独有字段会在设置页明确标注。EasyScholar 查询缓存默认保留 30 天，也可设置自定义天数或永久保留；EasyScholar 缓存与 DOI、OpenAlex、PubMed、CSL 索引等其他临时缓存可分别清除。

EasyScholar SecretKey 只保存在浏览器扩展的本地存储中，不包含在源码或导出文件里。

### 导入 CSV 或 JSON

CSV 推荐使用以下字段：

```csv
journal,issn,eissn,xinrui_partition,jcr_quartile,impact_factor,cas_partition,year,source,updated_at
```

其中 `journal`、`issn` 或 `eissn` 至少需要提供一种可用于匹配的标识。仓库中的 `extension/assets/journal-template.csv` 可作为模板。

JSON 可以直接使用数组，也可以使用包含 `rows` 数组的对象：

```json
{
  "rows": [
    {
      "journal": "Example Journal",
      "issn": "0000-0000",
      "jcr_quartile": "Q1",
      "impact_factor": "12.345",
      "year": "2026"
    }
  ]
}
```

### 自定义检索地址

自定义 URL 模板支持以下占位符：

- `{doi}`：URL 编码后的 DOI
- `{rawDoi}`：未编码 DOI
- `{title}`：URL 编码后的文章标题
- `{journal}`：URL 编码后的期刊名
- `{url}`：URL 编码后的当前页面地址
- `{query}`：由 DOI、标题和期刊名组成的查询词

示例：

```text
https://your-library.example.edu/search?q={query}
```

### 科研通求助辅助

开启该功能后，文章和参考文献旁会显示蓝色 `?` 图标。点击后，扩展会打开科研通求助页并填写 DOI；是否触发网站自身的元数据查询由设置决定。

请在页面中自行登录并核对题名、期刊、求助类型和积分。Journal Lens 不读取登录密码，也不会替你点击最终发布或提交按钮。

## 隐私与权限

扩展只在实现页面识别、指标查询、数据缓存和用户主动操作所需的范围内使用浏览器权限。API Key、导入数据、CSL 样式和题录元数据缓存保存在浏览器本地；调用外部数据服务时，仅发送完成相应查询所需的信息。

`clipboardWrite` 仅用于用户点击“复制题录”后写入纯文本和富文本题录；扩展不申请 `clipboardRead`。`https://doi.org/*` host permission 仅用于 DOI Content Negotiation 获取 CSL-JSON。样式和 locale 从 Citation Style Language Project 的 GitHub 仓库下载，远程 XML 始终作为数据解析，不会作为脚本执行。

完整说明请参阅[隐私政策](PRIVACY.md)。

## 从源码构建

仓库中的 `extension/` 可以直接作为未打包扩展加载。需要生成发布 ZIP 时，请在 PowerShell 7 中运行：

```powershell
.\tools\build.ps1 -Channel release -Browser edge
.\tools\build.ps1 -Channel release -Browser firefox -FirefoxId "your-extension-id@example.com"
```

构建产物会生成到本地 `releases/` 目录，该目录不会提交到仓库。

CSL 搜索索引在构建阶段从官方稳定分支生成：

```bash
node tools/generate-csl-style-index.js /path/to/styles-v1.0.2 /path/to/locales-v1.0.2 extension/assets/citation
node tools/vendor-citeproc.js
```

运行 `npm test` 可执行元数据、样式解析、dependent parent 缓存、三种 CSL 格式渲染以及设置页/弹窗浏览器测试。

## 数据来源与致谢

Journal Lens 可使用 ShowJCR、EasyScholar、OpenAlex、NCBI、DOI Content Negotiation 和 Citation Style Language Project 等外部数据服务。各服务的数据、可用性和使用规则由相应提供方负责。

题录渲染使用本地打包的 [citeproc-js](https://github.com/Juris-M/citeproc-js)。官方 CSL 样式和 locale 来自 [Citation Style Language Project](https://citationstyles.org/)，按 CC BY-SA 3.0 提供；文件中的作者与贡献者元数据保持不变。完整第三方许可见 `extension/THIRD_PARTY_NOTICES.md`。

## 许可证

本项目使用 [Mozilla Public License 2.0](LICENSE)。
