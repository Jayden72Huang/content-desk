# Content Desk

**把想法，做成你的内容系统。**

[产品官网](https://content-desk-jayden.vercel.app) · [下载 Community](https://github.com/Jayden72Huang/content-desk/releases/latest)

开源的本地内容创作工作台。自己搭模块、设计内容模板，连接 Codex 或 Claude Code 生成内容，再进入文章编辑器检查排版并同步微信公众号草稿。

## Community 0.1

- DIY 内容结构：正文、小标题、引用、列表、图片引用、事实依据、署名。
- 内容模板与视觉模板分开管理，示例文案不会污染正式文章。
- 使用自己的 Codex / Claude Code CLI 账号，生成模块、模板、文章；可取消，失败和中断有明确提示。
- 生成结果先预览、手动接受，再入库；保存为不可变版本。
- JSON 导入导出与自动化 CLI。
- 独立文章编辑器：图文排版、图片替换裁切、版本历史、审核和公众号草稿同步。
- 本地文章、系列、自建模板不限数量。

模型服务费用由用户自己的 CLI 账号承担。本软件不是模型订阅服务。

## 安装与运行

需要 Bun 1.3+。先从 https://bun.sh 安装 Bun。Agent 生成还需要已安装并登录的 Codex CLI 或 Claude Code；手动编辑无需 Agent。

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

打开 **http://127.0.0.1:8787**。服务只监听本机，Ctrl+C 退出。内容默认保存在 `~/.content-desk/`，退出、升级不会删除。备份这个目录即可备份所有本地内容；它可能含未发布文章，勿上传公开仓库。

临时开发环境建议用监管器：

```sh
dev-idle-run --port 8787 --idle 3600 --cwd "$PWD" -- bun server.ts --port 8787
```

使用 `WORKBENCH_DATA_DIR=/绝对路径` 更改数据目录。`bun server.ts --port 8788` 更改端口，端口冲突会报错，不自动换端口。

## 第一次创作

1. 在创作室选择“内容模板”，写下读者、风格和结构要求，选择已登录的 CLI。
2. 点击“交给 Agent”，检查结果，手动调整模块、顺序和要求，保存到素材库。
3. 选择“完整文章”和刚保存的内容模板，提供选题与可靠资料，生成文章。
4. 确认预览，点击“进入文章编辑器”。生成的基础封面可在编辑器内替换。
5. 人工核对事实、来源、图片与排版后，保存或同步公众号草稿。

缺少图片时 Agent 不会伪造图片文件。图片模块中的素材 ID 不能是本机路径或网络 URL；当前版本不导入未解析图片引用，请在文章编辑器插图。

## 本地 Coding Agent / 脚本操作

运行中的工作台提供本机接口和 CLI，不需要共享公众号密钥给 Agent。

```sh
bun cli.ts doctor
bun cli.ts schema > artifact.schema.json
bun cli.ts generate --provider codex --type template --prompt-file brief.txt
bun cli.ts job <返回的任务ID>
bun cli.ts import my-template.json
```

支持 `--provider claude`。任务 `ready` 表示通过结构校验，仍需人工确认；`accepted` 表示已保存到素材库。非零退出、超时、中断不会显示为生成成功。

Codex 适配器使用只读沙箱并跳过用户项目配置；Claude 适配器禁用工具、项目设置和 MCP，生成返回结构化数据。任务提示包含用户填写的要求和选中模板；不会主动读取个人文章库或公众号配置。CLI 仍按其供应商协议处理输入。

## 公众号配置

通过启动环境提供 `WECHAT_CONFIG_PATH`（本地 JSON，含 `appid`、`appsecret` 和可选 `author`），或 `WECHAT_MP_APPID` / `WECHAT_MP_SECRET`。不要将配置提交到版本库。公众号需具备接口权限并配置出口 IP 白名单。

同步只创建/更新草稿，不群发、不发布；通过 `draft/get` 回读核对后才记录成功。接口响应不确定时阻止盲目重复创建。真实微信手机端视觉仍需人工预览。

## 版本计划

Community 当前免费开源。Pro 设计聚焦批量生产、定时工作流、多品牌/多公众号、高级模板包、版本对比和优先支持。Pro 尚未开放购买，未实现权益不计入当前版本。详见 [版本与权益](product/EDITIONS.md)。

## 验证

```sh
bun run build
bun run typecheck
bun test
```

自动化微信测试使用模拟响应，不代表真实发布。完整手动验收记录见 [RELEASE-CHECKS](product/RELEASE-CHECKS.md)。

MIT © 2026 Jayden Huang。第三方依赖保留各自许可证，见 [THIRD-PARTY](THIRD-PARTY.md)。
