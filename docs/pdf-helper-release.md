# PDF Helper 构建与发布

PDF Helper 是独立于 Zotero 插件的原生发布物，但两者使用一致的命令约定：

| 发布物      | 构建                       | 发布                         |
| ----------- | -------------------------- | ---------------------------- |
| Zotero 插件 | `npm run build`            | `npm run release`            |
| PDF Helper  | `npm run build:pdf-helper` | `npm run release:pdf-helper` |

## 本地构建

```bash
npm run build:pdf-helper
```

该命令自动识别当前宿主平台。PyInstaller 产物不能跨平台构建，因此本地只生成
当前平台的 ZIP 和 artifact metadata；正式发布由 GitHub Actions 在 macOS
ARM64、macOS x64 和 Windows x64 runner 上并行构建。

如需测试构建和安装协议：

```bash
npm run test:pdf-helper
```

## 发布

交互式选择版本：

```bash
npm run release:pdf-helper
```

也可以指定 semver 或相对版本：

```bash
npm run release:pdf-helper -- 0.3.0
npm run release:pdf-helper -- patch
```

发布命令使用 `bumpp` 执行以下操作：

1. 检查 Git 工作树；
2. 更新 `helpers/pdf-helper/package.json`；
3. 运行 PDF Helper 测试；
4. 创建 `chore(pdf-helper): release vX.Y.Z` 提交；
5. 创建 `pdf-helper-vX.Y.Z` tag；
6. push 提交和 tag。

tag 会触发 `.github/workflows/pdf-helper.yml`。工作流首先验证 tag 与
`helpers/pdf-helper/package.json` 中的版本完全一致，然后在三个原生 runner
上调用相同的 `npm run build:pdf-helper`，校验 metadata 和 checksum，最后在
CI 模式调用相同的 `npm run release:pdf-helper` 创建 GitHub Release。

`helpers/pdf-helper/package.json` 是 PDF Helper 名称和版本的唯一来源。不要在
TypeScript、Python 或 GitHub Actions 中维护第二份版本号。
