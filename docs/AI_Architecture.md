# AI Architecture v0.1

## 1. System Overview

AI English Companion 采用客户端、后端服务和 AI 模型三层结构：

```text
Electron Desktop App
        ↓
Backend API
        ↓
DeepSeek API
```

- Electron Desktop App 负责 macOS 本地交互、上下文采集和结果展示。
- Backend API 是客户端与 AI 服务之间的安全边界，负责鉴权、请求控制和 AI 服务调用。
- DeepSeek API 根据结构化输入生成单词解释，并返回结构化结果。

v0.1 的 AI 输出结构以 `docs/AI_Prompt_Spec.md` 为准。客户端不直接调用 DeepSeek API。

## 2. Client Side Responsibility

Electron 客户端负责：

- 在后台检测 macOS 系统剪贴板内容变化。
- 过滤输入，只处理符合规则的单个英文单词。
- 获取复制发生时的当前前台应用名称。
- 在鼠标附近创建或更新轻量悬浮窗口。
- 组织发送给 Backend API 的结构化输入，包括 `word`、`source_app` 和 `user_goal`。
- 展示基础单词信息、AI 返回结果、加载状态和可理解的错误状态。
- 对 Backend API 返回的数据进行结构校验，拒绝缺少字段或格式错误的响应。
- 管理请求生命周期，避免旧请求覆盖用户后来复制的新单词。
- 在 AI 不可用时保留单词原文和其他本地可用的基础信息。

Electron 客户端不负责保存 DeepSeek API Key，也不应直接信任或渲染未经校验的 AI 输出。

## 3. Backend Responsibility

Backend API 负责：

- 为客户端提供统一且稳定的 AI 请求接口。
- 验证客户端请求字段、类型、长度和允许的目标值。
- 在服务端安全保存 DeepSeek API Key，并代表客户端调用 DeepSeek API。
- 管理第一版 System Prompt、模型参数和输出格式要求。
- 解析并校验 DeepSeek 返回的结构化 JSON。
- 将 AI 服务错误转换为稳定、可识别的业务错误，避免向客户端暴露内部实现和敏感信息。
- 设置请求超时、取消策略、有限重试和并发控制。
- 执行速率限制、滥用防护、成本控制和必要的可观测性记录。
- 避免在日志中记录不必要的用户内容、完整 Prompt、API Key 或其他敏感数据。

后端应向客户端返回稳定的数据契约。未来即使更换 AI 服务商，客户端也不应因此改变主要交互逻辑。

## 4. AI Request Flow

完整请求流程：

```text
用户复制英文
    ↓
Electron 检测剪贴板变化并验证英文单词
    ↓
获取 App Context
    ↓
Electron 立即显示基础悬浮窗口
    ↓
请求 Backend API
    ↓
Backend 验证请求并调用 DeepSeek API
    ↓
DeepSeek 返回结构化 JSON
    ↓
Backend 校验并规范化结果
    ↓
Electron 校验响应
    ↓
更新现有悬浮窗口
```

建议的请求数据：

```json
{
  "word": "dependency",
  "source_app": "Cursor",
  "user_goal": "understand_in_context"
}
```

建议的响应数据由以下字段组成：

```json
{
  "word": "dependency",
  "phonetic": "/dɪˈpendənsi/",
  "translation": "依赖；依赖项",
  "general_meaning": "指对某人或某事物的依赖，也可以指完成某件事所需的条件。",
  "context_explanation": "在 Cursor 等开发工具中，它通常指项目运行所依赖的软件包、模块或库。",
  "example": "Install the project dependencies before running the app."
}
```

AI 请求不应阻塞基础悬浮窗口显示。如果用户在请求完成前复制了新单词，客户端必须忽略旧单词的迟到响应。

## 5. Security Considerations

DeepSeek API Key 不应该放在 Electron 客户端中。

Electron 应用运行在用户设备上。即使将 API Key 写入环境变量、打包文件、压缩资源或经过混淆的 JavaScript，用户或恶意程序仍然可以通过检查应用文件、进程内存或网络请求提取它。客户端中的共享 Key 无法被真正保密。

一旦 Key 被提取，攻击者可以绕过产品直接调用 DeepSeek API，造成：

- 未授权请求和费用损失。
- API 额度被耗尽，影响正常用户。
- 无法可靠实施单用户额度和速率限制。
- Key 泄露后需要紧急轮换并重新发布客户端。

因此，API Key 必须保存在 Backend API 的服务端环境中，并通过密钥管理或受保护的服务端环境变量提供。客户端只访问产品自己的 Backend API。

后端还应实施：

- 客户端身份验证或受控的匿名会话机制。
- 单位时间请求限制和异常使用检测。
- 输入长度和格式校验。
- 明确的超时、并发和额度限制。
- 日志脱敏和最小化数据保留。
- HTTPS 传输，避免请求内容在网络中明文暴露。

需要注意：后端代理可以保护第三方 API Key，但不能单独证明客户端一定可信。额度控制和滥用防护仍然需要在服务端完成。

## 6. Future Scalability

### 6.1 支持 OpenAI 和 Claude

- 在后端建立统一的 AI Provider 接口，而不是让 Electron 了解各服务商 SDK。
- 为 DeepSeek、OpenAI 和 Claude 分别实现适配器。
- 将统一输入转换为不同模型所需的请求格式。
- 把各模型返回结果规范化为同一个客户端响应 Schema。
- 根据可用性、成本、响应速度或产品策略选择模型，并保留故障切换能力。

### 6.2 支持用户系统

- 后端增加用户、设备和会话身份。
- Electron 仅保存可撤销的用户会话凭证，不保存第三方 AI Key。
- 用户数据与请求记录使用稳定的用户标识关联。
- 支持登录、登出、设备管理和会话撤销。
- 对涉及单词历史或个人偏好的数据提供明确的隐私和删除策略。

### 6.3 支持会员额度

- 在后端维护套餐、剩余额度、计费周期和使用记录。
- 在调用 AI 服务前执行原子化额度检查，避免并发请求超额。
- AI 请求成功或达到明确计费条件后记录用量。
- 向 Electron 返回稳定的额度不足错误，由客户端展示对应降级状态。
- 区分免费功能、会员 AI 增强功能和不同模型的成本策略。
- 支持服务端限流、配额重置、退款修正和后台审计。

通过以上边界，Electron 客户端可以保持轻量，AI 服务商、用户系统和会员规则的演进主要发生在 Backend API，而不需要频繁改变 macOS 核心交互。
