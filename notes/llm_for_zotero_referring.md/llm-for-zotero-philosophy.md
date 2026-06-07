我重新拉了 `yilewang/llm-for-zotero` 当前源码，最新浅克隆 commit 是 `27c25386dcd2bc132a0d909e71064fb147e6e199`，版本 `3.8.14`。它的实现路线可以概括为：

```text
Zotero UI
  -> runtime selector / conversation store
  -> Codex app-server process
  -> persistent Codex thread
  -> Zotero MCP server
  -> Zotero library / PDF / note / write tools
```

**核心实现**

它不是把 ChatGPT/Codex 网页嵌进 Zotero，而是推荐用户安装并登录 Codex CLI，然后通过 `codex app-server` 使用 ChatGPT Plus 下的 Codex 能力。README 明确把 **Codex App Server** 作为新用户推荐路径，legacy direct backend 作为旧路径保留：[README.md](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/README.md#L347-L409)。

Codex 进程层做得比较完整：用 Zotero/Firefox `Subprocess` 启动 app-server，走 JSON-RPC，初始化时启用 `experimentalApi`，并维护 request timeout、stderr diagnostic buffer、notification/request handler、turn 串行队列：[codexAppServerProcess.ts](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/utils/codexAppServerProcess.ts#L119-L220)、[L309-L525](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/utils/codexAppServerProcess.ts#L309-L525)。

Zotero 能力通过本地 MCP endpoint 暴露：`/llm-for-zotero/mcp`，带 `Authorization` bearer token 和 `X-LLM-For-Zotero-Scope` scope header。它区分 read tools 和 write tools，read-only annotations、destructive annotations、scope TTL、read dedupe cache 都有：[server.ts](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/mcp/server.ts#L41-L109)、[L653-L708](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/mcp/server.ts#L653-L708)。

Codex thread config 里会关闭 shell tool，并把 Zotero MCP server 注入进去：[mcpSetup.ts](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/codexAppServer/mcpSetup.ts#L528-L548)。这是一个很值得借鉴的安全边界。

它的 `paper_read` 是一个语义 facade，不是简单正则：支持 `overview / targeted / visual / capture` 四种模式；overview 优先 MinerU markdown，然后 raw PDF text，最后 fallback 到 Zotero metadata/abstract；targeted 走 retrieval；显式 pages 走 page text；visual/capture 走 PDF page capture：[paperRead.ts](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L421-L717)。retrieval 层会使用 query plan、embedding 可用性、PDF chunks、cache：[retrievalService.ts](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/services/retrievalService.ts#L70-L178)。

**优点**

1. 架构边界正确：Codex 负责 agent reasoning，Zotero MCP tools 负责受控读取 Zotero 数据。
2. 比裸传 PDF path 稳定：PDF 读取、缓存、fallback、source label 都在 Zotero 侧可观测。
3. scope 设计成熟：每个 turn 绑定 library / paper / conversation / profile，降低模型读错 paper 或越权读库的概率。
4. 工具语义较好：`paper_read`、`library_search`、`library_read`、`library_retrieve` 比底层 `read_pdf_chunk` 更适合模型调用。
5. 安全意识强：MCP auth、tool annotations、写操作 confirmation、shell tool disable、destructive 标记都有。
6. 有上下文生命周期：persistent thread、resume、full/delta/thin context injection，能减少重复塞上下文。

**缺点**

1. 复杂度非常高。它已经不是“Zotero Copilot sidebar”，而是一个完整 agent platform：多 runtime、skills、conversation registry、trace store、write tools、MinerU、Claude Code、WebChat 等。
2. app-server 仍依赖 experimental API。它自己也写了很多 fallback，例如 `developerInstructions` unsupported、`thread/inject_items` unsupported，这说明协议漂移风险是真实存在的。
3. UI/trace 成本高。它把 reasoning、tool call、pending action、agent trace 都做成一等 UI；对你想做的“高密度、少噪音 sidebar”不一定合适。
4. 初版开放 write tools 风险大。`library_delete`、`run_command`、`file_io`、`zotero_script` 都很强，安全和 UX 成本远超 read-only paper QA。
5. 它的 license 是 `AGPL-3.0-or-later`：[package.json](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/package.json#L22)、[LICENSE](https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/LICENSE#L1-L13)。直接复制或改写其代码可能带来强 copyleft 合规义务。

**应用到本项目**

我建议只借鉴这四个设计，不复刻它的系统：

当前阶段只实现 PDF reader 内的单篇论文 QA：用户已经打开一篇 PDF 后，zotero-copilot 围绕该 reader 当前 paper 工作。主窗口 zotero-copilot 入口预留给未来 library 级别文献 QA / 全库对话；因此下面的 `library_*` 设计只作为后续方向，不进入当前 Step 4/5 实现范围。

1. `ZoteroContextGateway`
   负责 PDF reader 当前 item、parent item、当前 PDF attachment、reader selection、Zotero full-text、metadata、scope。不要让 `CodexBridge` 直接碰 Zotero 数据，也不要在当前阶段读取 Zotero 主窗口文献列表 selection。

2. read-only MCP first
   第一批只做：

   ```text
   get_active_paper
   get_paper_metadata
   get_paper_text_status
   read_selected_text
   paper_search
   paper_read
   ```

   暂时不要做 `note_write`、`library_delete`、`run_command`、`file_io`、`zotero_script`。

3. `paper_read` 采用语义模式，而不是正则 section parser
   推荐：

   ```text
   paper_read({ mode: "overview" })
   paper_read({ mode: "targeted", query, sections?, pages? })
   paper_read({ mode: "page", pages, neighborPages? })
   ```

   返回必须带 `source`、`locator`、`confidence`、`warnings`、`snippets`。正则最多作为 heading hint，不作为唯一判断。

4. Codex thread config 注入 MCP，并关闭 shell
   本项目现在已有 `src/codex/bridge.ts`，下一步应扩展为：
   ```text
   thread/start:
     config.features.shell_tool = false
     config.mcp_servers.zotero_copilot = { url, headers, enabled_tools }
   ```
   这比传 PDF path 更稳。

**不要搬的东西**

不要照搬它的 `nativeClient`、conversation DB schema、agent trace UI、tool registry 命名体系、MCP server 文件结构、CSS class、skills 文案、测试用例。它的复杂度是多年功能累积后的结果，不适合本项目当前阶段。

本项目更合适的路线是：

```text
当前 CodexBridge
  -> 加 reader-only ZoteroContextGateway
  -> 加本地 read-only MCP server
  -> promptBuilder 变成 thin router
  -> sidebar 默认只显示最终答案 + 证据/来源
  -> raw tool result / trace 放 diagnostics drawer
```

**避免代码抄袭的边界**

可以借鉴“思想、架构模式、公开协议用法”：app-server、MCP、scope token、read-only tools、tool annotations、preflight、diagnostics。

不要复制“表达性实现”：具体函数、类名、文件组织、schema 文案、prompt/skill 文案、CSS、SQL schema、测试代码、错误文案。如果确实需要参考某个实现细节，先写自己的 spec，再关掉原仓库，按 spec 独立实现。仓库文档里可以写一条简短 attribution：本项目的 Codex/MCP integration 设计参考了 `llm-for-zotero` 的公开实现思路，但代码为独立实现。
另外，因为它是 AGPL，若要复制或改写代码，应先明确项目 license 策略；否则最稳妥就是 clean-room 独立实现。
