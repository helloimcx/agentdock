---
name: stock-monitor
description: 股票行情与量化盯盘自动化技能。支持 A 股、港股、美股实时行情与技术/基本面指标监控（如周线布林带、动态股息率、股债利差 ERP、涨跌幅预警），并提供自动化的条件触发与分析。
allowed-tools: Bash(lac monitor:*)
triggers:
  - 股票监控
  - 盯盘
  - 股票提醒
  - 行情预警
  - 布林带
  - 股息率
  - 股债利差
  - stock.quote
---

# Stock Monitor (股票行情与量化盯盘技能)

用于为用户配置基于真实行情的股票自动化盯盘、量化指标预警与智能分析任务。

## 1. 支持的市场与代码格式

- **美股 (US)**: 标准 Ticker 代码，如 `AAPL`, `NVDA`, `TSLA`, `MSFT`, `BABA`
- **港股 (HK)**: 5 位标准代码，如 `00700` (腾讯控股), `09988` (阿里巴巴), `03690` (美团)
- **A 股 (CN)**: 6 位数字代码或附带交易所前缀，如 `600519` (贵州茅台), `000001` (平安银行), `sh600519`, `sz000001`

---

## 2. 监控指标字典 (Metrics)

### 基础价格与波动指标
- `latestPrice`: 最新成交价格
- `change_percent`: 当日涨跌幅百分比（如 `3.5` 代表 +3.5%，`-2.0` 代表 -2%）
- `abs_change_percent`: 当日涨跌幅绝对值百分比（如 `5.0`）

### 周线布林线指标 (Weekly Bollinger Bands)
基于 20 周均线与 2 倍标准差计算，适合中长线估值与周期波段判断：
- `boll_lower`: 周线布林下轨价格（超跌支撑位）
- `boll_middle`: 周线布林中轨价格（20 周均线）
- `boll_upper`: 周线布林上轨价格（超买压力位）
- `boll_percent_b`: %b 相对位置指标（`0.0` 为触及下轨，`1.0` 为触及上轨，`< 0` 超跌跌破下轨，`> 1` 超买突破上轨）
- `boll_distance_to_lower`: 距周线下轨的百分比距离
- `boll_distance_to_upper`: 距周线上轨的百分比距离
- `boll_signal`: 布林带信号状态（`buy` / `sell` / `hold`）

### 价值与红利估值指标 (Dividend Yield & ERP)
- `dividend_yield`: 动态年化股息率（%）
- `annual_dividend`: 过去 12 个月每股累计分红金额
- `erp_spread`: 股债利差（%）= 股息率 - 10 年期国债收益率（衡量权益资产相对无风险利率的吸引力）
- `dividend_signal`: 股息估值信号（`undervalued` / `fair` / `overvalued`）

---

## 3. 经典量化策略与条件表达式 (Conditions)

| 策略类型 | 条件表达式 (`--condition`) | 策略逻辑说明 |
| :--- | :--- | :--- |
| **周线下轨超跌买点** | `latestPrice <= boll_lower` 或 `boll_percent_b <= 0.05` | 股价回落至周线布林下轨，中长期性价比凸显 |
| **周线上轨止盈卖点** | `latestPrice >= boll_upper` 或 `boll_percent_b >= 0.95` | 股价冲高至周线布林上轨，阶段性超买防范回调 |
| **高红利配置买点** | `dividend_yield >= 5.0` 或 `erp_spread >= 2.5` | 股息率达标或股债利差处于历史高位，适合防御配置 |
| **双重共振策略** | `latestPrice <= boll_lower && dividend_yield >= 4.0` | **技术面（周线下轨）与基本面（高股息）**共振高胜率买点 |
| **大幅异动预警** | `abs_change_percent >= 5.0` | 日内行情波动超过 5% 时触发即时分析 |

---

## 4. CLI 命令操作规范 (使用 Bash 工具)

### 创建股票监控任务
```bash
lac monitor add \
  --title "<任务简短标题>" \
  --source stock.quote \
  --symbol "<标的代码>" \
  --condition "<条件表达式>" \
  --message "<触发时发给 Agent 执行的详细分析 Prompt>" \
  --cooldown 15m \
  --execution-mode side-thread
```
> **最佳实践**：
> - 推荐使用 `--execution-mode side-thread`，触发分析时在后台侧边线程执行，不中断当前对话。
> - 推荐指定 `--cooldown 15m`（或 `30m`、`1h`），避免同一天内行情在临界点反复震荡造成消息风暴。

### 查看与管理监控任务
```bash
# 列出当前所有监控任务
lac monitor list

# 查看单条监控详情及最新行情快照
lac monitor info <monitor-id>

# 手动立即试运行一次
lac monitor run <monitor-id>

# 编辑监控条件或 Prompt
lac monitor edit <monitor-id> [--title "<新标题>"] [--condition "<新条件>"] [--message "<新Prompt>"]

# 删除监控任务
lac monitor del <monitor-id>
```

---

## 5. Agent 交互引导 SOP

当用户提出股票盯盘相关需求时，请按以下步骤主动引导：
1. **明确标的**：若用户未指定完整代码（如“帮我盯腾讯”），主动确认代码为 `00700`。
2. **推荐适配策略**：根据标的属性（科技成长股推荐“周线布林超跌买点/上轨止盈”，红利高股息股推荐“股息率/双重共振”），主动给出 2~3 个精选条件表达式供用户选择。
3. **一键自动化创建**：用户确认后，直接调用 `lac monitor add` 创建监控，并向用户展示创建结果（Monitor ID、监控标的、触发条件及冷却时间）。
