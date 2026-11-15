# KingCRM

**KingCRM** is an open-source, self-hosted **CRM** (Customer Relationship Management) system for sales teams.  
It covers the full sales pipeline: **leads → accounts → opportunities → quotes → contracts → orders**, plus **tickets**, **dashboard**, **RBAC**, and an **AI chat / agent** module.

**KingCRM** 是一套可独立部署的开源 CRM / 客户关系管理系统，适合销售跟进、客户管理、商机报价、合同订单与工单服务。技术栈为 **Vue 3 + TypeScript + Vite + Naive UI**（PC / 移动端）与 **Node.js + Fastify + MySQL**（后端）。

| | |
| --- | --- |
| License | [MIT](./LICENSE) |
| Stack | Vue 3 · TypeScript · Vite · Node.js 20+ · Fastify · MySQL |
| Repo | https://github.com/lvmengstruggle-a11y/KingCRM |
| Docs | [项目介绍](./项目介绍.md) · [PLAN](./PLAN.md) |

---

## Why KingCRM / 为什么选 KingCRM

- **Open source CRM / 开源可商用**：MIT 协议，可自建、二次开发、私有化部署。
- **Full sales CRM / 完整销售闭环**：线索池、客户公海、商机阶段、报价、合同回款发票、订单汇总。
- **Ticket / 工单**：客户问题受理、分配、回复与部门视角。
- **PC + Mobile**：同一套 `lib-shared` API，桌面端与移动端共用协议。
- **Self-hosted**：数据在你自己的 MySQL，不强制 SaaS。
- **Modern TypeScript stack**：前后端均为 TypeScript，接口用 Zod 校验，分层清晰（Route → Controller → Service → Model）。

如果你在搜索：**开源 CRM**、**自建 CRM**、**Vue CRM**、**Node.js CRM**、**销售管理系统**、**客户管理软件**、**线索商机合同订单**、**open source CRM Vue**、**self-hosted CRM Node**，KingCRM 就是面向这些场景的项目。

---

## Features / 功能一览

### Sales pipeline / 销售管道

| Module | 中文 | What you can do |
| --- | --- | --- |
| Lead | 线索 / 线索池 | 新建、导入、跟进、转入客户 |
| Account | 客户 / 公海 / 联系人 | 我的客户、协作客户、公海回收 |
| Opportunity | 商机 / 报价 | 阶段、金额、赢单统计 |
| Product | 产品 / 价格表 | 产品目录与定价 |
| Contract | 合同 / 回款 / 发票 | 回款计划、记录、工商抬头 |
| Order | 订单 | 关联客户与合同，金额汇总 |
| Ticket | 工单 | 发布、分配、部门与抄送视图 |
| Workbench / Dashboard | 工作台 / 仪表板 | 今日本周本月汇总与跟进统计 |
| System | 组织 / 角色 / 模块 | RBAC、模块开关、审批、日志 |
| Agent | 智能体 / AI 对话 | 业务侧 AI Chat 能力 |

界面截图见 [项目介绍.md](./项目介绍.md#界面)。

---

## Tech stack / 技术栈

```text
Browser (Vue 3 + Pinia + Vue Router + Naive UI)
  → /front (Vite proxy or Nginx)
    → Fastify (TypeScript, Zod)
      → Service / Model
        → MySQL database `kingcrm`
```

| Layer | Technology |
| --- | --- |
| Web UI | Vue 3, TypeScript, Vite, Pinia, Naive UI |
| Mobile UI | Vue 3 package, shared `lib-shared` APIs |
| Backend | Node.js 20+, Fastify 5, TypeScript (ESM) |
| Database | MySQL (`kingcrm`) |
| Auth | RSA login encryption, session `X-AUTH-TOKEN`, CSRF |
| Validation | Zod request schemas |

架构与协议细节：[PLAN.md](./PLAN.md)、[项目介绍.md](./项目介绍.md)。

---

## Quick start / 快速开始

### Requirements

- Node.js **20+**
- MySQL（库名建议 `kingcrm`）
- 前端开发建议使用 **pnpm**

### Backend

```bash
git clone https://github.com/lvmengstruggle-a11y/KingCRM.git
cd KingCRM
cp .env.example .env
# 填写 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
npm install
npm test
npm run dev
```

Default API: `http://127.0.0.1:8083`  
Health check: `GET /health`

### Frontend (PC)

```bash
cd frontend
pnpm install
cd packages/web
pnpm exec vite --config ./config/vite.config.dev.ts --host 127.0.0.1 --port 5173
```

PC UI: `http://127.0.0.1:5173/#/login`

开发时代理前缀 `/front` 会转发到后端。更多启动说明见 [项目介绍.md](./项目介绍.md#2-怎么运行)。

> 本地默认管理员账号以你的数据库初始化数据为准；密码在库中为 UTF-8 小写 MD5。请勿把真实 `.env`、账号口令提交到 Git。

---

## Project structure / 目录结构

```text
KingCRM/
  src/                         Node.js backend (Fastify)
    routes/                    Route registration
    http/controllers/          HTTP adapters
    http/middleware/           Auth / CSRF
    services/                  Business logic
    models/                    MySQL access
    support/                   Envelope, RSA, session, pool
  frontend/
    packages/web/              PC CRM (Vue 3)
    packages/mobile/           Mobile CRM (Vue 3)
    packages/lib-shared/       Shared API modules & types
  docs/images/                 UI screenshots
  .env.example                 Backend env template
  LICENSE                      MIT
```

---

## Documentation / 文档

| Doc | Content |
| --- | --- |
| [项目介绍.md](./项目介绍.md) | Product overview, screenshots, runbook, DB notes |
| [PLAN.md](./PLAN.md) | Backend plan, response envelope, MVC layers |
| [LICENSE](./LICENSE) | MIT open-source license |

---

## Use cases / 适用场景

- 中小团队自建 **销售 CRM**，不想绑定国外 SaaS
- 需要 **私有化部署 / 内网 CRM** 的公司
- 基于 **Vue 3 + Node.js** 做 CRM 二次开发的团队
- 需要线索、客户公海、商机漏斗、合同回款、工单一体的开源方案
- 学习 **Fastify + Vue CRM** 全栈项目结构

Keywords for discovery: `KingCRM`, `open source CRM`, `self-hosted CRM`, `Vue 3 CRM`, `TypeScript CRM`, `Node.js Fastify CRM`, `MySQL CRM`, `sales pipeline CRM`, `lead management`, `opportunity management`, `contract CRM`, `ticket system`, `开源CRM`, `客户关系管理`, `销售管理系统`, `线索管理`, `商机管理`, `合同管理`, `工单系统`, `私有化CRM`.

---

## FAQ / 常见问题

### What is KingCRM?

KingCRM is an MIT-licensed, self-hosted CRM built with Vue 3 and Node.js. It manages leads, customers, opportunities, products, contracts, orders, tickets, and dashboards on top of MySQL.

### Is KingCRM free / open source?

Yes. The repository is public under the [MIT License](./LICENSE). You can use, modify, and distribute it, including for commercial projects, subject to the license terms.

### Does it support Chinese UI?

Yes. The product UI and docs are Chinese-first (`zh-CN`), with i18n support in the frontend packages.

### Can I deploy it privately?

Yes. Run the Node backend and serve the Vite build with Nginx (or similar), pointing `/front` to the API. Data stays in your MySQL instance.

### Where are the screenshots?

See [项目介绍.md — 界面](./项目介绍.md#界面) and files under `docs/images/`.

---

## Roadmap notes / 说明

- Backend follows an incremental API migration plan; see [PLAN.md](./PLAN.md).
- Session storage is in-process memory by default; use Redis when you need multi-instance.
- Do not commit `.env`, passwords, or private account notes.

---

## Contributing / 参与

Issues and pull requests are welcome.

1. Fork https://github.com/lvmengstruggle-a11y/KingCRM  
2. Create a feature branch  
3. Open a PR with a clear description  

Before contributing large features, skim [项目介绍.md](./项目介绍.md) and [PLAN.md](./PLAN.md) so API envelopes and MVC boundaries stay consistent.

---

## Star & share / 支持项目

If KingCRM helps your sales team or side project, please **Star** the repo so more people can find this open-source CRM on GitHub and Google.

**GitHub:** https://github.com/lvmengstruggle-a11y/KingCRM
