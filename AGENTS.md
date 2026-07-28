# Zopilot Agent Guide

本文件适用于整个仓库。Zopilot 目前处于早期开发阶段，首要目标是持续改善代码
库的规范性、可维护性和可扩展性。允许并鼓励在收益明确时进行跨文件、跨模块乃至
跨层的大规模重构；改动规模不应成为回避正确架构的理由。所有改动仍须目标清晰、
边界明确且可验证，设计原则用于辅助判断，而不是机械检查清单。

## 项目概览

Zopilot 是一个面向 Zotero 9 的 TypeScript/React AI 阅读助手，同时支持 Codex
CLI 和 OpenAI-compatible BYOK provider。运行环境包括 Zotero/Gecko、独立的
Node.js BYOK runtime，以及 React UI。

主要目录：

- `src/domain/`：领域类型、规则和与框架无关的逻辑。
- `src/application/`：用例编排、backend/provider 服务。
- `src/integrations/`：Codex、BYOK、MCP、Zotero 等外部系统适配。
- `src/features/`：侧边栏、设置页等面向用户的功能和 UI。
- `src/platform/`：Gecko 等宿主能力的受控入口。
- `src/runtime/`：通用运行时、持久化、进程和日志设施。
- `src/document/`：文档解析、检索和 PDF helper。
- `test/unit/`：与源码结构对应的单元测试。
- `test/scaffold/`：需要 Zotero 插件运行环境的集成测试。

## 工作方式

- 先阅读相关实现、测试和调用方，再修改代码；不要仅凭文件名推断行为。
- 从代码库整体而非单个文件评估问题。若局部修补会延续错误边界、重复逻辑或
  技术债，应扩大范围完成结构性修复。
- 可以移动、拆分、合并或重写现有模块，也可以调整内部 API 和目录结构。大规模
  重构必须有明确的目标架构，并一次完成调用方、测试和失效代码的迁移。
- 不因“保持 diff 小”而保留不合理设计，也不借重构之名改动与目标架构无关的
  产品功能。
- 内部实现和内部 API 不承担不必要的兼容负担。用户可见行为、持久化数据和外部
  协议若需改变，应作为有意识的设计决策，并同步更新契约、迁移策略、文档和测试。
- 优先修复根因。不要用吞掉异常、放宽类型或跳过校验来掩盖问题。
- 修改行为时同步更新或新增测试。修复 bug 时，尽量先用回归测试复现。
- 重构完成后删除被替代的实现、兼容壳和死代码，确保只有一套清晰的主路径。
- 不直接编辑生成目录，例如 `build/`、`dist/` 和 `.scaffold/`。
- 不提交密钥、token、用户路径、真实论文内容或其他隐私数据。

## Coding Philosophy

SOLID、KISS、DRY 和 YAGNI 可以同时使用，但它们不是同等优先、绝对适用的
规则。发生取舍时按以下顺序判断：

1. 正确性、安全性和明确的产品需求优先。
2. 长期一致的架构、可维护性、可测试性和已知扩展方向优先于局部改动成本与
   diff 大小；现有边界可以被重新设计。
3. 使用 SOLID 和 DRY 建立清晰职责、稳定契约和单一知识来源。
4. 使用 KISS 和 YAGNI 约束方案复杂度：只引入解决已知问题所需的抽象，不为
   未知需求搭建通用框架。
5. 可读的少量重复通常优于错误或过早的抽象；一旦相同业务规则需要多处同步
   修改，就应建立单一来源。

### SOLID

- **Single Responsibility**：模块应只有一个清晰的变化原因。按领域、编排、
  外部适配和 UI 职责拆分，但不要为了缩短文件而制造无意义的间接层。
- **Open/Closed**：对 provider、backend、host 等明确存在多实现或持续扩展的
  变化轴，建立稳定的接口、registry 或 adapter。必要时重构已有实现，使新增
  变体不必反复修改核心流程；不要把所有代码都设计成插件系统。
- **Liskov Substitution**：实现必须遵守其接口的输入、输出、错误、取消和流式
  事件语义；替换 backend/provider 后不应破坏调用方假设。
- **Interface Segregation**：接口由使用方需要的能力驱动，保持小而专。不要让
  UI、domain 或测试依赖它们不使用的宿主能力。
- **Dependency Inversion**：高层策略通过稳定契约使用外部能力，把 Zotero、
  Gecko、Codex、网络和进程细节留在 adapter/integration 层。若现有依赖方向
  错误，应调整模块边界和组合入口；不要为了形式上的依赖注入而包装纯函数或
  稳定的内部实现。

优先组合而不是继承；TypeScript 类型和接口应表达真实契约，而不是未来可能
出现的层次结构。

### KISS

- 选择最直接、最容易阅读和测试的实现。
- 优先形成一套一致的状态管理、错误模型和抽象体系。现有模式合理时沿用，不合理
  时迁移并删除旧模式，避免新旧体系长期并存。
- 除非复杂度确有必要，不增加新的依赖、全局状态、反射、代码生成或隐式控制流。

### DRY

- 消除重复的业务规则、协议解析、持久化格式和兼容性知识。
- 相似的几行代码不一定表示同一概念。若它们可能因不同原因变化，允许分别保留。
- 提取共享代码时，应让命名和契约比重复代码更清楚，并给共享行为补充测试。

### YAGNI

- 不实现未经需求支持的产品功能、配置项或兼容分支。为完成目标架构所必需的
  基础重构、测试设施和迁移工作不属于“额外功能”。
- 不为假设中的 provider、平台或未来 API 提前泛化。
- 删除因本次改动而失效的代码；不要保留“以后可能有用”的死代码。

## 架构与边界

- 以职责和依赖方向组织代码。现有目录边界不合理时可以重组，但不得留下含义
  重叠的旧层级或临时转发层。
- 领域规则尽量保持纯净，不直接读取 DOM、Zotero/Gecko 全局对象、文件系统、
  网络或用户偏好。
- 外部输入（provider 响应、JSON-RPC、持久化数据、Zotero 数据）必须在边界
  校验，内部代码使用已收窄的类型。
- Zotero/Gecko 私有 API、host selector 和全局对象只能出现在现有兼容层允许
  的文件中。`scripts/check-api-boundaries.mjs` 和 `eslint.config.mjs` 是这些
  限制的事实来源。
- 保持 Codex 和 BYOK backend 的公共契约一致，尤其是错误、取消、tool call、
  trace 和 streaming 行为。
- UI 组件保持展示职责；会话、workspace、provider 和 turn 生命周期交给现有
  coordinator/store/service 管理。
- 持久化格式变更必须考虑旧数据读取，并为 codec/migration 行为添加测试。

## TypeScript 与 UI 约定

- 保持严格类型；避免新增 `any`、非必要的类型断言和非空断言。
- 对仅用于类型的导入使用 `import type`。
- 异步资源必须有明确的完成、失败和取消路径；避免未处理的 Promise。
- React 组件优先使用已有 primitives、hooks 和样式模式，不复制相同交互状态。
- 用户可见文案应走现有 localization/message 层；修改文案时同步相关资源和测试。
- 日志使用现有 logger，记录可操作的上下文，但不得记录 secret 或完整敏感内容。
- 格式遵循 Prettier 配置：2 空格、80 列、LF。

## 验证

根据改动范围运行最小但充分的验证：

```bash
# 相关单元测试；可将 glob 缩小到改动对应的测试文件
npm run test:unit

# 格式、ESLint 和 Zotero API 边界
npm run lint:check

# 插件构建和 TypeScript 检查
npm run build

# 需要真实 Zotero scaffold 的集成测试
npm test

# 当用户明确要求实机验收/测试时
npm run start
```

纯文档改动不要求运行完整构建。代码交付前至少运行相关测试；跨层、构建配置、
宿主兼容层或发布路径的改动应运行完整的 `npm run test:unit`、
`npm run lint:check` 和 `npm run build`；涉及 Zotero 生命周期或宿主交互时，
还应运行 `npm test`，用户明确要求实机验收时运行 `npm run start`。如果受环境
限制无法执行某项验证，明确说明未执行的命令和原因。
