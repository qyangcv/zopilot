**先建立心智模型**

这个 repo 不是普通网页项目。它是一个 Zotero 插件项目：

```text
你写 TypeScript
  -> npm start 调用 zotero-plugin-scaffold
  -> scaffold 构建成 JavaScript
  -> 启动 Zotero
  -> Zotero 加载插件
  -> 插件执行 hooks.ts 里的生命周期函数
```

你作为新手，先不用理解全部 npm 生态。先知道这几件事就够：

- `npm`：用来安装依赖、运行脚本。
- `TypeScript`：你主要写的源码，后缀 `.ts`。
- `JavaScript`：最终被 Zotero 执行的代码，后缀 `.js`。
- `zotero-plugin-scaffold`：帮你构建、启动 Zotero、热重载插件的开发工具。
- `.scaffold/build`：自动生成的构建结果，不要手动改。
- `node_modules`：依赖源码，不要手动改，除非只是为了学习。

**最应该理解的文件**

按这个顺序看：

1. [package.json](/Users/yang/code/zotero/zotero-copilot/package.json:23)

这里定义项目名字、依赖和 npm 命令。你要重点看：

```json
"scripts": {
  "start": "zotero-plugin serve",
  "build": "zotero-plugin build && tsc --noEmit"
}
```

新手理解：`npm start` 就是执行 `zotero-plugin serve`。

2. [.env](/Users/yang/code/zotero/zotero-copilot/.env:10)

这里告诉开发工具：

- Zotero 程序在哪里
- 用哪个 Zotero profile
- 用哪个 Zotero data directory

这不是插件业务代码，但它决定开发环境能不能跑起来。

3. [zotero-plugin.config.ts](/Users/yang/code/zotero/zotero-copilot/zotero-plugin.config.ts:4)

这是 scaffold 的配置文件。它告诉工具：

- 源码目录是 `src` 和 `addon`
- 输出目录是 `.scaffold/build`
- 插件 ID 是什么
- TypeScript 入口是 `src/index.ts`
- 构建后的 JS 输出到哪里

你暂时只需要能看懂，不急着改。

4. [addon/manifest.json](/Users/yang/code/zotero/zotero-copilot/addon/manifest.json:1)

这是插件元信息模板，比如插件名、版本、Zotero 插件 ID。里面的 `__addonName__`、`__addonID__` 是占位符，构建时会被替换。

5. [addon/bootstrap.js](/Users/yang/code/zotero/zotero-copilot/addon/bootstrap.js:12)

这是 Zotero 插件生命周期入口。Zotero 启动插件时会先执行它。

重点知道这些函数：

```js
startup();
onMainWindowLoad();
onMainWindowUnload();
shutdown();
```

但你通常不需要频繁改它。

6. [src/index.ts](/Users/yang/code/zotero/zotero-copilot/src/index.ts:1)

这是 TypeScript 入口。它创建插件对象，并挂到 Zotero 全局对象上：

```ts
Zotero.ZoteroCopilot = addon;
```

新手理解：这是“把你的插件注册到 Zotero 里”的地方。

7. [src/addon.ts](/Users/yang/code/zotero/zotero-copilot/src/addon.ts:6)

这里定义插件对象 `Addon`。它保存插件状态，例如：

```ts
alive;
config;
env;
initialized;
ztoolkit;
```

新手理解：这是插件的“状态容器”。

8. [src/hooks.ts](/Users/yang/code/zotero/zotero-copilot/src/hooks.ts:12)

这是你最应该重点理解的文件。插件启动后真正做什么，大多从这里开始。

重点函数：

```ts
onStartup();
onMainWindowLoad();
onMainWindowUnload();
onShutdown();
```

你以后加功能，通常会从这里接入。

9. [src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:1)

这里是当前第一个真实 UI 模块。你可以从这里看 sidebar 如何注册 toolbar button、reader button、右侧 pane 和基础交互。

后续加功能时，优先新建小模块再由 `index.ts` 编排，不要把所有逻辑继续塞进一个文件。

10. [src/utils/ztoolkit.ts](/Users/yang/code/zotero/zotero-copilot/src/utils/ztoolkit.ts:1)

这里创建 `zotero-plugin-toolkit` 的工具对象。你会经常通过 `ztoolkit` 操作 Zotero UI、日志、菜单等。

**暂时不要重点看的文件**

这些先不要深读：

- `node_modules/`
- `.scaffold/build/`
- `package-lock.json`
- `dist/*.mjs`
- `typings/`

它们要么是依赖，要么是自动生成结果，要么是类型辅助。新手一开始读它们容易迷路。

**你需要掌握的基础语法**

先掌握这些就能开始改插件：

```ts
const name = "Zotero Copilot";
let count = 0;
```

`const` 是不可重新赋值变量，`let` 是可变变量。

```ts
function hello() {
  console.log("hello");
}
```

普通函数。

```ts
async function onStartup() {
  await Zotero.initializationPromise;
}
```

异步函数。Zotero 很多 API 都要 `await`。

```ts
import hooks from "./hooks";
export default Addon;
```

模块导入和导出。TS/JS 项目用它来拆文件。

```ts
class Addon {
  constructor() {
    this.data = {};
  }
}
```

类。这个 repo 用 `Addon` 类保存插件状态。

```ts
const addon = {
  data: {
    alive: true,
  },
};
```

对象。JS/TS 里非常常见。

```ts
const windows = Zotero.getMainWindows();
windows.map((win) => onMainWindowLoad(win));
```

数组和箭头函数。

```ts
addon.data.dialog?.window?.close();
```

可选链。意思是：如果前面的值存在，就继续访问；不存在就跳过，避免报错。

```ts
function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void>;
```

TypeScript 类型标注。`: _ZoteroTypes.MainWindow` 表示参数类型，`: Promise<void>` 表示返回一个异步结果。

**Zotero 插件最重要的概念**

你要重点理解 lifecycle，也就是生命周期：

```text
Zotero 启动
  -> bootstrap.js startup()
  -> src/index.ts 创建插件对象
  -> hooks.onStartup()
  -> hooks.onMainWindowLoad()
```

关闭时：

```text
窗口关闭
  -> hooks.onMainWindowUnload()

插件关闭
  -> hooks.onShutdown()
```

所以实际开发时，你常做的是：

- 启动时注册功能：写在 `onStartup`
- 主窗口加载后修改 UI：写在 `onMainWindowLoad`
- 关闭时清理菜单、弹窗、事件：写在 `onShutdown` 或 `onMainWindowUnload`

**建议你的学习路线**

1. 先能跑通：

```bash
npm install
npm start
```

2. 只改 [src/hooks.ts](/Users/yang/code/zotero/zotero-copilot/src/hooks.ts:12)，加一行日志或弹窗，确认 Zotero 里有变化。

3. 再读 [src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:1)，看真实 sidebar 功能是怎么注册和挂载的。

4. 然后把 example 功能逐个删掉，替换成你自己的功能模块。

5. 最后才研究 `zotero-plugin-scaffold`、构建系统、发布 `.xpi`。

最短总结：新手优先理解 `package.json`、`.env`、`zotero-plugin.config.ts`、`addon/bootstrap.js`、`src/index.ts`、`src/addon.ts`、`src/hooks.ts`。真正写功能时，主要工作区是 `src/hooks.ts` 和 `src/modules/`。
