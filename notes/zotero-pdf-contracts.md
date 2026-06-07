核心结论：Zotero 已经做了“全文文本抽取 + 索引 + annotation 数据管理”，但它没有提供“章节结构化解析”。所以 `paper_search` 可以建立在 Zotero 的全文文本上；`paper_read(section="abstract")` 仍然需要你自己做 chunking/retrieval/弱结构识别，不能指望 Zotero 直接给出 Abstract、Introduction 的边界。

当前 `zotero-copilot` Step 4/5 的实现范围只覆盖 PDF reader 场景：用户已经点击打开了一篇文献，插件只围绕该 reader 当前 PDF 工作。下面提到的主窗口 selected item、library 搜索、annotation 能力属于 Zotero 可提供的原材料或未来扩展方向，不进入当前阶段实现范围。

**打开 PDF 时 Zotero 大致做什么**

1. PDF 作为 attachment item 存在
   Zotero 里论文通常是一个 regular item，PDF 是它的 child attachment。当前阶段从 PDF reader 的当前 attachment item 出发，回溯到 parent regular item；不从 Zotero 主窗口文献列表 selection 出发，也不从 regular item 反向猜主 PDF。

2. Zotero 会为 PDF/plain text attachment 建 full-text index
   官方文档说 Zotero 会抽取 PDF 全文用于 Quick Search 的 “Everything” 和 Advanced Search 的 “Attachment Content”。PDF 工具来自 Xpdf，并且早已随 Zotero 捆绑。索引有上限，默认最多 500,000 characters，长文可能 partial indexed。来源：[PDF Full-Text Indexing](https://www.zotero.org/support/pdf_fulltext_indexing)、[Search Preferences](https://www.zotero.org/support/preferences/search)。

3. 打开 PDF reader 不等于稳定触发“完整解析”
   公开文档能确认的是 Zotero 有 full-text indexing；但“用户打开 PDF 的那一刻一定完成全文抽取/重建索引”不是公开 contract。你的 tool 不应该依赖 open event，而应该显式检查 indexed state / fulltext 是否可用，并处理 empty / partial / unindexed。

4. Zotero annotations 不写回原 PDF，而是存在 Zotero database
   Zotero 自己创建的 highlight、note、image annotation 等存在数据库里；外部 PDF annotation 可以在 reader 中显示，也可以导入。官方说明 annotations 可被插件和 Web API 访问。来源：[Annotations in Database](https://www.zotero.org/support/kb/annotations_in_database)。

**公开/半公开接口**

1. 插件内 JavaScript API，最适合 `zotero-copilot`
   官方 JS API 虽然承认文档不完整，但给了直接例子：

   ```js
   var item = ZoteroPane.getSelectedItems()[0];
   let attachmentIDs = item.getAttachments();
   let attachment = Zotero.Items.get(id);
   fulltext.push(await attachment.attachmentText);
   ```

   也就是说，插件内可以直接读 PDF/HTML attachment 的 plain text。来源：[Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api)。

   你能拿到：
   - 当前选中 item：`Zotero.getActiveZoteroPane().getSelectedItems()`，但这属于主窗口文献列表 selection，当前 Step 4/5 不使用。
   - parent item metadata：`item.getField("title")`、`item.getField("abstractNote")`、creators 等
   - child attachments：`item.getAttachments()`
   - PDF 判断：`attachment.isPDFAttachment()`、`attachment.attachmentContentType`
   - PDF 路径：`attachment.getFilePathAsync()`
   - 抽取文本：`await attachment.attachmentText`
   - annotations：`attachment.getAnnotations()`，annotation item 上有 `annotationText`、`annotationComment`、`annotationPosition`、`annotationPageLabel`、`annotationColor`、`annotationSortIndex`

2. Reader event API，适合 reader UI 和选中文本场景
   Zotero 7 官方提供 `Zotero.Reader.registerEventListener(type, handler, pluginID)`，包括：
   - `renderTextSelectionPopup`
   - `renderToolbar`
   - `createAnnotationContextMenu`
   - `createViewContextMenu`
   - `createThumbnailContextMenu`

   `renderTextSelectionPopup` 的 event 里能拿到 selection/annotation 相关参数；适合做 `read_selected_text` 或 “解释选中片段”。来源：[Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)。

3. Web API / local API 风格接口，适合外部进程
   Web API v3 公开了 full-text endpoint：

   ```text
   GET <userOrGroupPrefix>/items/<attachmentKey>/fulltext
   ```

   返回类似：

   ```json
   {
     "content": "...",
     "indexedPages": 50,
     "totalPages": 50
   }
   ```

   也支持 `/fulltext?since=<version>` 查询哪些 fulltext 更新了。来源：[Web API Full-Text Content Requests](https://www.zotero.org/support/dev/web_api/v3/fulltext_content)。

   搜索方面，items endpoint 的 `qmode=everything` 会包含 full-text content。来源：[Web API Basics](https://www.zotero.org/support/dev/web_api/v3/basics)。

**对 tool 设计的含义**

`paper_search`：可行。第一版应优先用 `attachment.attachmentText` 读取全文，然后自己 chunk + query match / embedding / rerank。不要只依赖 Zotero search，因为 API search 适合找 item，不适合返回高质量 snippet。

`paper_read(pageRange)`：中等可行。Zotero fulltext endpoint 有 `indexedPages/totalPages`，但 `attachmentText` 本身通常是纯文本，不保证保留可靠 page boundary。要精准 page text，后续可能仍需 PDF.js/PyMuPDF。

`paper_read(section)`：不能完全依赖 Zotero。Zotero 不提供 section tree。Abstract/Introduction/Methods 的边界要由你自己的 retrieval/heading heuristic/LLM 判断，并返回 confidence/warning。

`read_selected_text`：最稳。当前阶段只考虑用户在 PDF reader 里选中的文本；annotation 读取留到后续阶段。Reader event 可以给你明确的局部上下文。

所以 Step 4/5 的底层假设应改成：Zotero 提供“reader 当前 PDF attachment、parent metadata、全文纯文本、reader selection”的原材料；`zotero-copilot` 负责把这些原材料做成可追踪的 retrieval tools，而不是让正则假装 Zotero 已经给了结构化论文。主窗口 selection、library 搜索和 annotation 读取留到未来扩展。
