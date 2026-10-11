# KingCRM Node.js 后端重写计划

本目录是独立项目 KingCRM，工程目录 `KingCRM`。Java 项目在同级目录，两边共用同一套 MySQL（库名 `kingcrm`）。表结构继续由 Java 项目里已发布的 Flyway 脚本负责，Node 侧不新建库、不改那些脚本。

当前规模：98 个 Controller、约 804 个接口。一次替换不现实，按下面阶段替换，前端协议保持不变。

## 目标

- 运行时：Node.js 20+、TypeScript。
- 默认端口 `8083`，与 Java `8081` 并行，方便对照。
- 响应信封、登录加密、密码摘要、请求头与现有 Vue 前端兼容。
- 后台所有页面布局保持不变：不改 `frontend/` 的菜单、表格列、表单、样式和路由。Node 只补接口，返回字段沿用页面已经绑定的结构。
- 分层对齐 MeEdu / Laravel MVC：路由只登记地址，Controller 做协议转换，Service 做业务，Model 做数据访问。

## 与现有前端的协议

| 项 | 约定 |
|---|---|
| 成功 | HTTP 200，`{ code: 100200, message, messageDetail, data }` |
| 校验失败 | HTTP 400，`code: 100400` |
| 未登录 | HTTP 401，`code: 401`，响应头 `Authentication-Status: invalid` |
| 无权限 | HTTP 403，`code: 403` |
| 未迁移接口 | 已登录时 HTTP 404，`code: 100404` |
| 登录加密 | `GET /get-key` 返回 1024 位 RSA 公钥（X.509 SPKI Base64），前端 JSEncrypt 用 PKCS#1 加密用户名和密码 |
| 密码 | 库内仍是 UTF-8 MD5 小写十六进制，与 `CodingUtils.md5` 一致 |
| 会话 | 请求头 `X-AUTH-TOKEN`、`CSRF-TOKEN`；组织用 `Organization-Id` |
| 匿名接口 | `GET /get-key`、`POST /login`、`GET /logout`、`GET /is-login`、`GET /health` |

写操作在已登录后校验 CSRF。会话先放进程内存，多实例时再换 Redis。

## 目录（MVC）

```
src/
  routes/                 路由登记，对应 MeEdu routes/api.php
  http/controllers/       入参、出参，不写 SQL
  http/requests/          Zod 校验，对应 FormRequest
  http/middleware/        登录、CSRF、后续权限
  services/               事务和业务规则
  models/                 只访问现有表
  support/                响应信封、异常、RSA、MD5、会话、连接池
```

新增一个业务时按这个顺序：Model SQL → Service → Request → Controller 方法 → 在 `routes` 里挂上。Controller 不调用别的领域的 Model。

依赖方向：`routes → controllers → services → models`。`support` 可以被各层使用，不能反向依赖某个业务。

## 阶段

每阶段完成的标志：该阶段接口与 Java 对同一条数据的请求体、响应 `data` 字段一致，并有成功、校验失败、未登录三类测试。Java 代码在该阶段验收前不删。

### 阶段 0：骨架与登录（本轮已开始）

已实现：

- Fastify 应用、统一响应、全局异常
- `GET /health`
- `GET /get-key`、`POST /login`、`GET /logout`、`GET /is-login`、`GET /get-auth`
- 密码 MD5、默认密码标记（管理员默认 `KingCRM`，员工为手机号后 6 位）
- 组织、部门、角色、权限点写入会话
- 登录日志 `sys_login_log`
- `POST /locale-language/change`
- `GET /system/version`
- `GET /navigation/list`
- 未迁移路径返回 100404

尚未做：SSO、API Key 签名、文件访问 Cookie、Redis 会话、Shiro 会话互通。Node 登录态和 Java 登录态互相不认，切换时前端要重新登录。

### 阶段 1：系统管理（组织、用户、角色、模块设置、日志）

已实现，路径和权限点与 Java 管理页一致。管理员账号跳过权限点校验。

组织与员工：

- 部门树、新增、重命名、负责人、删除校验、删除、同级排序
- 员工列表、详情、新增、编辑、批量编辑、启用禁用、重置密码、改名、删除校验和删除
- 员工下拉、管理员下拉、角色下拉、部门成员树
- 第三方同步检查固定返回 `false`（未接第三方组织）

角色：

- 列表、详情、新增、编辑、删除、权限目录
- 成员分页、关联、移除、批量移除
- 部门树、部门用户树、角色用户树、可选用户

模块与字典：

- 模块列表、开关、排序、表单键列表、高级搜索开关
- 字典查询、新增、编辑、删除、开关、排序、配置
- 顶导列表和排序
- 部门树、部门用户树、角色树（表单设计用）

日志与个人中心：

- 登录日志、操作日志列表和详情（按操作人、时间、类型、模块筛选）
- 个人资料、修改手机邮箱、修改密码
- API Key 列表（含密钥）、新增（最多 5 个）、更新有效期、启用、禁用、删除

仍不能用：

- 员工 Excel 导入和模板下载
- 第三方组织同步、邮件验证码
- 公告、消息中心、组织邮件和三方登录配置、许可证
- 表单设计器的保存和字段配置（`/module/form/save`、`/module/field/**`）
- 线索池、公海、库容、商机规则、审批流
- API Key 请求签名。密钥可以在个人中心维护，还不能拿来调用接口

员工列表里的高级筛选和组合搜索会返回「尚未迁移」。删除员工时只检查客户、线索、商机的负责人，不会级联删除合同和订单。

验收：用现有库登录后，系统设置里的组织架构、角色、模块开关、字典、导航排序、登录日志和操作日志、个人中心 API Key 可以操作。客户、线索等业务页仍返回 100404。

### 阶段 2：模块表单引擎

这是后面所有 CRM 对象的底座，优先于客户、线索。

- 模块、字段、表单、视图：`/module/**`、`/module/field/**`、`/module/form/**`
- 字段类型解析器（文本、数字、成员、部门、附件、数据源等）按 Java `resolver/field` 逐个迁
- 高级筛选、组合搜索、排序的 SQL 生成器
- 分页请求 `{ current, pageSize, keyword, viewId, sort, filters, combineSearch }`，`pageSize` 1～500

验收：某个业务列表能按视图和筛选查出与 Java 相同的行。

### 阶段 3：客户与线索

- 客户、公海、联系人、协作人、负责人历史、容量
- 线索、线索池及对应视图
- 跟进记录和跟进计划里与客户、线索直接相关的部分

约 200 个接口。先做分页、详情、新增、更新、删除，再做导入导出和批量转移。

### 阶段 4：商机、报价、合同、订单、产品

- 商机阶段、报价
- 合同、回款计划、回款记录、发票、工商抬头
- 订单阶段
- 产品与价格表

金额、阶段回退、统计接口与 Java 用同一组样例数据对账。

### 阶段 5：跟进、搜索、首页、仪表盘

- 通用跟进记录、计划、评论
- 全局搜索、高级搜索、字段脱敏配置
- 首页统计
- 仪表盘模块

### 阶段 6：审批

- 流程定义、待办、动作、资源绑定
- 状态机与 Java 审批记录表一致，不另起一套流程引擎

### 阶段 7：文件、导入导出、消息

- 附件与图片预览（补上文件访问 Cookie）
- 导出任务中心
- 站内信、公告、SSE `/sse/**`
- 消息任务

### 阶段 8：集成

- 钉钉、飞书、企业微信、GitHub OAuth
- MCP、公式、智能体
- License 校验

这些依赖外部系统和密钥，放在业务接口稳定之后。

### 阶段 9：切换

- 前端开发代理从 `8081` 改到 `8083`，或由网关按路径灰度
- Docker 镜像改为 Node 进程，MySQL / Redis 数据目录不变
- 对照 `backend/API.md` 逐组勾销
- Java 模块在对应组验收后停止发布，不在中途删除源码

## 数据与事务

- 时间字段继续用毫秒时间戳 `BIGINT`。
- 主键继续 `VARCHAR(32)`。Node 新记录用 16 字节随机十六进制，不占用 Java UID 的 `worker_node`。
- `BIT(1)` 在 Model 层转成 boolean。
- 多表写入放在 Service，用 `pool.getConnection()` + `beginTransaction()`。单表查询保持自动提交。
- 不把密码、Token、完整手机号打进日志。

## 本轮之后的下一刀

补齐阶段 1 剩余写接口：`POST /user/add`、`POST /user/update`、`GET /user/detail/:id`，以及角色的新增和授权。导入导出和第三方同步仍放在后面。

## 本地运行

```bash
cd KingCRM
cp .env.example .env
# 填入现有 MySQL 账号，库名 kingcrm
npm install
npm test
npm run dev
```

服务监听 `http://127.0.0.1:8083`。`GET /health` 不访问数据库；登录接口会查询 `sys_user`。
