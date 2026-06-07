已采用这种方式。

我在 src/modules/sidebar/index.ts:34 加了开发调试字段类型：

`__zcpLastPrompt`
`__zcpLastPromptContext`

并在发送给 Codex 前保存快照：`src/modules/sidebar/index.ts:499`

```ts
const promptContext = await this.contextGateway.getPromptContext(
  this.activeReader,
);
const prompt = buildPaperQuestionPrompt(value, promptContext);
this.storePromptDebugSnapshot(prompt, promptContext);
```

使用方式：

1. 保持 npm start 运行。
2. 在 Zotero PDF reader 里打开一篇论文。
3. 从 reader toolbar 打开 Zotero Copilot。
4. 提问一次。
5. 打开 Tools -> Developer -> Run JavaScript，执行：

`__zcpLastPrompt`

或：

`__zcpLastPromptContext`

如果直接变量取不到，就用主窗口访问：

`Zotero.getMainWindow().__zcpLastPrompt`

`Zotero.getMainWindow().__zcpLastPromptContext`

验证已完成：

`npm run build`
`npm run lint:check`
`npm test`

全部通过。npm test 打印 1 passed 后照旧不自动退出，我只清理了本次 .scaffold/test 测试进程，没有动你当前运行中的 zotero-plugin serve 开发实例。
