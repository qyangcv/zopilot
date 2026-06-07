可以。你现在这个 Browser Toolbox 就能定位，而且建议按 **DOM id** 找，不要靠鼠标慢慢点边界。

**1. Zotero Copilot 自己的宽度调节 UI**

在 Inspector 左上搜索框里搜：

```text
#zotero-copilot-sidebar-splitter
```

这是 Copilot 左侧那条 splitter。对应代码：

- 创建位置：[src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:200)
- splitter 属性：[src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:211)
- Copilot pane 本体：`#zotero-copilot-sidebar-shell`，创建位置：[src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:223)
- 样式位置：[addon/content/zoteroPane.css](/Users/yang/code/zotero/zotero-copilot/addon/content/zoteroPane.css:48)

也可以在 Console 里直接跑：

```js
document.getElementById("zotero-copilot-sidebar-splitter");
document.getElementById("zotero-copilot-sidebar-shell");
```

**2. Zotero 内置 content / item panel 的 UI**

如果你是在 PDF reader 里，也就是截图里说的 center PDF panel 右边，那么误触的主要是 reader context pane，不是普通 library item pane。搜：

```text
#zotero-context-splitter
#zotero-context-pane
#zotero-context-pane-sidenav
```

对应 Zotero 安装包里的代码：

```text
/Applications/Zotero.app/Contents/Resources/app/omni.ja
  chrome/content/zotero/zoteroPane.xhtml
```

关键 DOM 在 `zoteroPane.xhtml` 里：

```xml
<splitter id="zotero-context-splitter" ... />
<box id="zotero-context-pane" ...>
  <context-pane id="zotero-context-pane-inner" ... />
  <item-pane-sidenav id="zotero-context-pane-sidenav" ... />
</box>
```

真正“呼出/折叠 panel”的按钮在：

```text
chrome/content/zotero/elements/itemPaneSidenav.js
```

里面是：

```js
<toolbarbutton class="btn" data-action="toggle-pane" />
```

并且事件逻辑是：

```js
if (action === "toggle-pane") {
  button.addEventListener("command", () => {
    this._collapsed = !this._collapsed;
  });
}
```

如果你切回 library tab，那对应的是另一组：

```text
#zotero-items-splitter
#zotero-item-pane
#zotero-view-item-sidenav
```

它们也用同一个 `itemPaneSidenav.js` 组件。

最实用的定位流程是：

1. Inspector 搜 `#zotero-copilot-sidebar-splitter`，看 Copilot 拖拽线。
2. 再搜 `#zotero-context-pane-sidenav`，看 Zotero 原生右侧 sidenav。
3. 展开 `#zotero-context-pane-sidenav`，找里面的 `toolbarbutton.btn[data-action="toggle-pane"]`。
4. 对比两者在 DOM 里的相邻关系，就能直接验证为什么拖 Copilot 时容易误触原生 panel toggle。
