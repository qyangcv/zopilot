## Release 流程

npm run lint:check
npm run test:unit
npm run build
npm run release

npm run build:pdf-helper
npm run release:pdf-helper

## PDF helper

开发环境与生产分发使用两条独立路径：

- `npm run start` 会自动创建或复用
  `.scaffold/pdf-helper-development/venv`，并直接运行
  `helpers/pdf-helper/zopilot_pdf_helper.py`。修改 helper 源码不需要构建、
  改版本或发布运行时归档；只有 `requirements.txt` 变化时才会重建 venv。
- 生产 XPI 只使用 profile 中已安装的版本化 helper。helper 的输出契约或实现
  发生需要用户更新的变化时，必须使用新的不可变版本，构建三个平台的归档并发布
  manifest；不要覆盖同版本的远程资产。

## Commit message 写法

Release body 会根据上一个 tag 到当前 tag 之间的 conventional commits 自动生成。
release 提交本身会被过滤；不符合 conventional commit 格式的提交不会进入分组。

常用类型按优先参考顺序：

- `fix: ...` 修复用户可感知的 bug，会列入 Fixes。
- `feat: ...` 新增用户可感知的功能，会列入 Enhancements。
- `docs: ...` 文档、说明、README 或开发笔记变更，会列入 Documentation。
- `refactor: ...` 重构内部实现，但不改变用户可见行为，会列入 Refactors。
- `perf: ...` 优化运行性能、启动速度或资源占用，会列入 Performance。
- `test: ...` 新增或调整测试，不改变运行时代码，会列入 Tests。
- `build: ...` 构建、打包、依赖或发布流程变更，会列入 Build。
- `ci: ...` GitHub Actions 或其他 CI 配置变更，会列入 CI。
- `types: ...` TypeScript 类型、声明文件或类型约束变更，会列入 Types。
- `style: ...` 代码格式、空白、排序等不影响行为的样式变更，会列入 Styles。
- `chore: ...` 维护性杂项；能归入以上类型时优先使用更具体的类型，会列入 Chore。
- `examples: ...` 示例、demo 或样例配置变更，会列入 Examples。

可选写法：

- `type(scope): ...` 标明模块归属，例如 `fix(sidebar): restore resize`。
- `type!: ...` 标明破坏性变更。
- 如果 release note 需要链接 issue 或 PR，在 subject 中加入 `#123`。
