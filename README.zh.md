# dsh-bib-lint

[English](README.md)

用于 DeepSeek Harness 的只读文献工具：检查 BibTeX、核对 Crossref DOI 元数据、排版参考文献和比较修订。

## 安装

需要 Node.js 24.9 以上、DSH 0.2.2-rc.1。本版本在 DSH 0.2.2-rc.1 上验证。

在 DSH 的 **插件 → 添加插件** 中粘贴：

```text
https://github.com/DengyiGu/dsh-bib-lint
```

也可通过命令行安装到 web profile：

```sh
dsh plugin --profile web add github:DengyiGu/dsh-bib-lint#v0.1.0
```

源码已是可执行 JavaScript，无需编译或执行安装脚本。插件没有额外运行时依赖，两个宿主包由 DSH 提供。只填写包名需要另行发布 npm；公开 GitHub 仓库不会自动进入第三方市场的搜索列表。

## 工具

| 工具 | 参数 | 功能 |
|---|---|---|
| `bib_audit` | `path`, `verify?`, `limit?`, `titleThreshold?` | 必填字段、重复项、格式、解析错误和可选 Crossref 核验 |
| `bib_format` | `path`, `style?`, `keys?` | 输出 `gbt7714`、`apa`、`ieee` 或 `vancouver` 参考文献表 |
| `bib_diff` | `before`, `after` | 新增、删除的引用键及类型、字段变化 |
| `bib_lookup` | `doi` | 查询 Crossref 并返回可复制的 BibTeX |

请优先使用绝对路径；相对路径基于 DSH 进程工作目录。所有工具仅返回结果，不修改文件。

安装后可在对话中要求：

- 用 `bib_audit` 离线检查 `C:/papers/references.bib`，设置 `verify: "none"`。
- 用 `bib_format` 按 `ieee` 格式输出这份文献表。
- 用 `bib_diff` 比较 `C:/papers/submitted.bib` 和 `C:/papers/revised.bib`。
- 用 `bib_lookup` 查询 DOI `10.1038/nature14539`。

审计检查不同类型的必填字段、重复键、重复作品、年份、DOI、页码、空字段、未知类型和缩略作者列表。联网核对标题、年份、第一作者姓氏、发表载体及已有撤稿记录；容许出版年份相差一年，未来年份警告容许提前一年。

排版和比较遇到解析错误或重复键会停止，防止输出不完整结果。排版指定不存在的键会报错，缺少标题的条目会列入跳过列表。

## 配置

可在插件设置中配置，也可覆盖 profile 中的 `bib-lint` 行：

| 设置 | 默认值 | 含义 |
|---|---|---|
| `defaultStyle` | `apa` | 默认排版风格 |
| `verifyLimit` | `20` | 每次审计的 Crossref 查询上限，`0` 关闭审计联网 |
| `maxIssues` | `200` | 展示问题数量上限，统计仍包含省略的问题 |
| `requestTimeoutMs` | `8000` | 单次请求超时 |
| `crossrefMailto` | 空 | 发送给 Crossref 的可选联系邮箱 |

```yaml
- id: bib-lint
  config:
    defaultStyle: gbt7714
    verifyLimit: 10
```

补丁会替换整个 `config` 对象，需重新填写想保留的设置。

`bib_audit` 默认使用 `verify: "crossref"`；`verify: "none"` 完全离线。调用参数 `limit` 只能降低配置的查询上限，`titleThreshold` 默认 `0.9`。`bib_lookup` 始终联网。请求仅将 DOI 和可选邮箱发给 `api.crossref.org`，其他文献字段留在本地。查询按顺序执行并响应取消；插件不启动后台服务或遥测。

## 限制

- 排版是实用近似实现，未覆盖完整风格手册，投稿前需人工校对。
- 解析器支持嵌套字段、引号、注释、`@string`、拼接和月份宏；不支持 crossref 继承、`@set` 或任意 LaTeX 展开。
- Crossref 数据可能缺失或不完整；查不到不代表论文虚构。撤稿检查读取 `updated-by`、`is-retracted-by` 和同 DOI 的撤稿更新，未发现通知不等于证明未撤稿。
- 标题采用字符二元组相似度，译名、副标题和期刊缩写可能需人工判断。
- DOI 查询保留已有作者姓名、出版信息和类型，上游记录缺失的字段仍需补充。

## 开发

```sh
npm test
npm run check
npm run verify
npm pack
```

测试使用 Node 内置 runner，无需联网或安装宿主；适配层测试替换两个宿主导入。测试及样例不进入安装包。真实宿主兼容性另行验证，替身测试通过不能单独证明兼容。

## 许可

[MIT](LICENSE)。与 DeepSeek、Crossref 及各风格规范机构无隶属关系。
