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

点击浏览器工具栏中的 Journal Lens 图标，可以查看当前文章信息、打开检索入口，或导出 BibTeX/RIS。

### 配置指标数据

在扩展设置页选择所需的数据来源：

- **本地数据**：仅使用导入的 CSV/JSON 或 ShowJCR 数据。
- **本地优先 + EasyScholar 补充**：保留本地核心指标，并由 EasyScholar 补充缺失字段。
- **EasyScholar API**：页面指标以 EasyScholar 返回结果为准。

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

扩展只在实现页面识别、指标查询、数据缓存和用户主动操作所需的范围内使用浏览器权限。API Key、导入数据和设置保存在浏览器本地；调用外部数据服务时，仅发送完成相应查询所需的信息。

完整说明请参阅[隐私政策](PRIVACY.md)。

## 从源码构建

仓库中的 `extension/` 可以直接作为未打包扩展加载。需要生成发布 ZIP 时，请在 PowerShell 7 中运行：

```powershell
.\tools\build.ps1 -Channel release -Browser edge
.\tools\build.ps1 -Channel release -Browser firefox -FirefoxId "your-extension-id@example.com"
```

构建产物会生成到本地 `releases/` 目录，该目录不会提交到仓库。

## 数据来源与致谢

Journal Lens 可使用 ShowJCR、EasyScholar、OpenAlex 和 NCBI 等外部数据服务。各服务的数据、可用性和使用规则由相应提供方负责。

## 许可证

本项目使用 [Mozilla Public License 2.0](LICENSE)。
