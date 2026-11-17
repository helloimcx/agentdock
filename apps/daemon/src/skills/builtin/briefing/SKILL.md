---
name: briefing
description: 个人每日简报自动化技能。将多源信息（RSS/Atom 订阅、Hacker News、GitHub Trending）聚合 → 已读去重 → 简报合成 → 定时投递。基于调度器 cron 任务实现"周期性多源聚合 → 摘要合成 → 渠道投递"的简报工作流。
allowed-tools: Bash(lac scheduler:*)
triggers:
  - 每日简报
  - 简报
  - 资讯聚合
  - 新闻聚合
  - 信息聚合
  - RSS
  - 订阅源
  - digest
  - briefing
---

# Briefing (个人每日简报技能)

为用户配置"多源聚合 → 已读去重 → 简报合成 → 定时投递"的每日简报自动化任务。

## 1. 定位与边界（Phase 1）

- **管什么**：免 key 公开来源的周期性聚合与简报投递——RSS/Atom 订阅、Hacker News、GitHub Trending。
- **不管什么**（Phase 2 / 后续阶段，不在本技能范围）：声明式编辑画像（profiles）、话题级向量去重（knowledge-api 相似度合并）、社区讨论 enrichment、付费或登录墙来源。

## 2. 支持的来源（Phase 1，全部免 API key）

| 来源 | 获取方式 | 说明 |
| :--- | :--- | :--- |
| RSS / Atom | `curl <feed-url>` | 用户提供的任意 RSS/Atom 订阅地址 |
| Hacker News | `curl https://hacker-news.firebaseio.com/v0/topstories.json`，再逐条 `curl https://hacker-news.firebaseio.com/v0/item/<id>.json` | 取榜单前 N 条的标题与链接 |
| GitHub Trending | `curl https://github.com/trending`（可追加 `/<language>`） | 按语言过滤的每日热门仓库，取仓库名与描述 |

## 3. 简报配置要素（对话中确认）

1. **来源清单**：具体 RSS 地址；是否包含 Hacker News；GitHub Trending 语言（如 `python`、`go`，留空为全语言）。
2. **每期上限**：默认 10 条，防止单一来源霸占整期简报。
3. **投递时间**：cron 表达式（如每天早上 08:30 → `30 8 * * *`），与用户确认时间偏好。
4. **摘要语言**：默认中文。

## 4. 已读去重状态（seen 状态）

- 简报已读状态落盘在工作区 `.agentdock/briefing/seen.json`：以条目 URL 为主键，记录 `title` 与 `firstSeenAt`。
- 生成简报前读取 seen 清单：URL 已存在 → 跳过；URL 相同或标题完全相同的条目只保留一条。
- 生成后把本期入选条目合并写入 seen 清单，并清理 `firstSeenAt` 超过 **30 天** 的旧条目，防止清单无限膨胀。

## 5. 创建每日简报任务（CLI 命令操作规范）

```bash
lac scheduler add \
  --cron "30 8 * * *" \
  --message "<简报生成 SOP，见第 6 节模板>" \
  --desc "每日简报" \
  --execution-mode side-thread
```

> **最佳实践**：
> - 推荐 `--execution-mode side-thread`，简报在专属调度线程生成，不打扰当前对话。
> - 简报消息正文必须内嵌完整的生成 SOP（第 6 节模板）——调度触发时任务侧只能看到这段 message。
> - `--message` 中明确列出每期条数上限与来源清单，避免每次生成时凭记忆变化。

## 6. 简报生成 SOP（--message 模板）

```
你是每日简报编辑，请严格按以下步骤执行：
1. 依次获取来源：逐个 curl 用户订阅的 RSS/Atom 地址；curl Hacker News API 获取榜单并逐条取 item 详情；curl GitHub Trending 页面解析前 N 个仓库（名称、描述、链接）。
2. 读取工作区 .agentdock/briefing/seen.json，剔除已投递过的条目；URL 重复或标题完全相同的条目只保留一条。
3. 若所有条目都已投递过，直接回复"今日无新增内容"，不要生成空简报。
4. 按每期上限 N 条筛选，输出简报：标题（日期 + 主题）、本期条目列表；每条格式为【来源 | 标题 | 链接 | 一句话中文摘要】。
5. 将本期入选条目的 URL、标题、时间合并写入 .agentdock/briefing/seen.json，并清理 firstSeenAt 超过 30 天的旧记录。
```

## 7. 管理简报任务

```bash
# 列出全部调度任务（含简报任务）
lac scheduler list

# 查看简报任务详情与最近运行状态
lac scheduler info <job-id>

# 立即试运行一次，验证简报效果与去重是否生效
lac scheduler run <job-id>

# 调整投递时间或简报内容
lac scheduler edit <job-id> --cron "0 9 * * *" --message "<新 SOP>"

# 删除简报任务
lac scheduler del <job-id>
```

## 8. Agent 交互引导 SOP

当用户提出每日简报、资讯聚合相关需求时，请按以下步骤主动引导：
1. **确认来源**：用户未给出具体 RSS 地址时，推荐"Hacker News + GitHub Trending"免 key 组合起步，或请用户提供订阅地址。
2. **确认参数**：投递时间（建议早上并与用户确认）、每期条数上限（默认 10）、摘要语言（默认中文）。
3. **一键创建**：用第 5 节命令创建任务，将第 6 节模板填入来源与上限后作为 `--message`，并向用户展示任务 ID、cron 与来源清单。
4. **试运行验证**：创建后立即 `lac scheduler run <job-id>` 生成一期，确认格式与去重生效后再交付；后续询问"简报内容/为什么没投递"时用 `lac scheduler info <job-id>` 排查最近运行状态。
