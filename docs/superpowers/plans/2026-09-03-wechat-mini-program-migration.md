# 美学身份卡微信小程序完整版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用四周将现有单文件网页 MVP 重构为可提审的微信原生小程序，完整提供照片分析、美学身份卡、挑战打卡、照片对比、提醒和分享闭环。

**Architecture:** 微信原生小程序负责交互和本地降级，CloudBase 云函数、数据库与存储负责身份和业务数据，微信云托管独立容器负责 68 点人脸关键点分析。分析原图成功后立即删除，异常情况下由删除队列保证 30 分钟内清除；挑战照片采用独立保存策略。

**Tech Stack:** 微信原生小程序 JavaScript/WXML/WXSS、CloudBase、微信云托管、Node.js 20、`node:test`、`@vladmandic/face-api` 1.7.15、TensorFlow.js Node 4.16.0、Canvas 2D。

## Global Constraints

- 使用微信原生小程序，不使用 `web-view` 套壳。
- 主体按个人主体准备；不得出现医疗诊断、疗效保证、颜值排行或容貌缺陷评价。
- 分析照片必须在用户单独同意后上传；正常立即删除，异常最长保留 30 分钟。
- 挑战照片与分析原图分开授权和存储；默认在挑战结束后保留 7 天。
- 页面主色固定为 `#F7F3EE`、`#FFFDF9`、`#C9A87C`、`#2C2420`、`#7A6B5A`、`#D4C4B0`、`#EDE5D8`。
- 用户拒绝照片、提醒、日历或相册权限后，其他核心功能仍可使用。
- 小程序同一时间只允许一个进行中的挑战。
- 第一版不包含支付、排行榜、社区、陌生人互动或会员体系。
- 每个任务结束都必须运行相关自动化测试并形成独立提交。

---

## 文件结构

```text
project.config.json                         微信开发者工具项目配置
package.json                                本地自动化测试入口
miniprogram/
  app.js                                    云环境初始化与全局错误处理
  app.json                                  页面、分包与底部导航
  app.wxss                                  全局视觉变量和可访问性规则
  config/env.js                             开发/生产云环境映射
  lib/face-style-core.js                    迁移后的比例、报告和挑战纯函数
  lib/contracts.js                          云端请求和返回对象校验
  services/cloud-client.js                  云函数调用、重试和错误归一化
  services/offline-checkins.js              离线打卡队列
  pages/home/*                              首页
  pages/consent/*                           人脸照片单独同意
  pages/photo-check/*                       选图、压缩和质量检查
  pages/analysis/*                          分析过程和恢复
  pages/report/*                            美学身份卡长报告
  pages/challenges/*                        挑战中心
  pages/challenge-create/*                  模板与自定义挑战
  pages/challenge-detail/*                  今日任务、打卡和照片
  pages/challenge-complete/*                复盘和海报
  pages/profile/*                           历史、隐私和数据管理
  components/identity-card/*                身份卡组件
  components/challenge-card/*               挑战卡组件
  components/privacy-consent/*              单独同意组件
  components/photo-pair/*                   前后照片组件
  components/error-state/*                  可恢复错误组件
shared/
  cloud-guards.js                           云函数共用的用户归属校验
cloudfunctions/
  bootstrapUser/*                           用户初始化
  challengeApi/*                            挑战命令和查询
  analysisApi/*                             分析任务创建、查询和回调
  reminderApi/*                             日历参数和订阅状态
  shareApi/*                                服务端小程序码生成
  accountApi/*                              数据导出与删除
  lifecycleJobs/*                           过期照片删除和提醒任务
cloudrun/face-analysis/
  Dockerfile                                分析容器
  package.json                              固定推理依赖
  src/server.js                             健康检查和任务接口
  src/inference.js                          68 点检测
  src/validate.js                           输入与任务凭证校验
tests/miniprogram/                          纯函数、协议和同步测试
tests/cloudfunctions/                       云函数权限和幂等测试
tests/cloudrun/                             推理契约和固定图片测试
docs/wechat/                                注册、云环境、隐私和提审文档
```

---

### Task 1: 建立可运行的小程序工程骨架

**Files:**
- Create: `package.json`
- Create: `project.config.json`
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/config/env.js`
- Create: `miniprogram/pages/home/home.js`
- Create: `miniprogram/pages/home/home.json`
- Create: `miniprogram/pages/home/home.wxml`
- Create: `miniprogram/pages/home/home.wxss`
- Create: `tests/miniprogram/project-structure.test.cjs`

**Interfaces:**
- Produces: `getCloudEnv(version: "develop" | "trial" | "release"): string`
- Produces: three tab routes: `/pages/home/home`, `/pages/challenges/challenges`, `/pages/profile/profile`

- [ ] **Step 1: 写工程结构失败测试**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("mini program declares the approved three tabs", () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../miniprogram/app.json"), "utf8"));
  assert.deepEqual(app.tabBar.list.map(item => item.pagePath), [
    "pages/home/home", "pages/challenges/challenges", "pages/profile/profile"
  ]);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/miniprogram/project-structure.test.cjs`
Expected: FAIL，提示 `miniprogram/app.json` 不存在。

- [ ] **Step 3: 创建最小原生小程序和测试命令**

```json
{
  "name": "face-style-notes-mini-program",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

`miniprogram/config/env.js`：

```js
const environments = require("./env.runtime");

function getCloudEnv(version) {
  return environments[version] || environments.develop;
}

module.exports = { getCloudEnv };
```

`env.runtime.js` 由执行者在第 1 天创建，三个值必须直接复制自已创建的 CloudBase 环境控制台；`develop` 和 `trial` 指向开发环境，`release` 指向独立生产环境。EnvId 不是密钥，可以进入仓库，但不得凭空编造。

`miniprogram/app.js`：

```js
const { getCloudEnv } = require("./config/env");

App({
  onLaunch() {
    const version = wx.getAccountInfoSync().miniProgram.envVersion;
    wx.cloud.init({ env: getCloudEnv(version), traceUser: true });
  }
});
```

- [ ] **Step 4: 运行结构测试和现有网页回归测试**

Run: `npm test`
Expected: 新结构测试 PASS，现有 `tests/face-style-core.test.cjs` 全部 PASS。

- [ ] **Step 5: 提交工程骨架**

```bash
git add package.json project.config.json miniprogram tests/miniprogram/project-structure.test.cjs
git commit -m "feat: scaffold native WeChat mini program"
```

---

### Task 2: 迁移视觉变量、三入口和首页状态

**Files:**
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/pages/home/home.js`
- Modify: `miniprogram/pages/home/home.wxml`
- Modify: `miniprogram/pages/home/home.wxss`
- Create: `miniprogram/pages/challenges/challenges.js`
- Create: `miniprogram/pages/challenges/challenges.json`
- Create: `miniprogram/pages/challenges/challenges.wxml`
- Create: `miniprogram/pages/challenges/challenges.wxss`
- Create: `miniprogram/pages/profile/profile.js`
- Create: `miniprogram/pages/profile/profile.json`
- Create: `miniprogram/pages/profile/profile.wxml`
- Create: `miniprogram/pages/profile/profile.wxss`
- Create: `tests/miniprogram/copy-and-theme.test.cjs`

**Interfaces:**
- Consumes: tab routes from Task 1.
- Produces: `homeState = { latestReport, activeChallenge }` and stable entry actions `startAnalysis`, `openChallenge`, `openLatestReport`.

- [ ] **Step 1: 写配色和禁用文案测试**

```js
test("mini program keeps the approved warm palette and safe copy", () => {
  const wxss = fs.readFileSync("miniprogram/app.wxss", "utf8");
  ["#F7F3EE", "#FFFDF9", "#C9A87C", "#2C2420", "#7A6B5A", "#D4C4B0", "#EDE5D8"]
    .forEach(color => assert.match(wxss.toUpperCase(), new RegExp(color.toUpperCase())));
  const source = fs.readFileSync("miniprogram/pages/home/home.wxml", "utf8");
  ["AI分析中", "扫描中", "颜值评分", "缺点"].forEach(text => assert.equal(source.includes(text), false));
});
```

- [ ] **Step 2: 运行测试并确认缺少主题变量**

Run: `node --test tests/miniprogram/copy-and-theme.test.cjs`
Expected: FAIL，指出批准色值尚未出现。

- [ ] **Step 3: 实现三入口和首页动态卡片**

```js
Page({
  data: { latestReport: null, activeChallenge: null },
  async onShow() {
    const { result } = await wx.cloud.callFunction({ name: "bootstrapUser" });
    this.setData({ latestReport: result.latestReport, activeChallenge: result.activeChallenge });
  },
  startAnalysis() { wx.navigateTo({ url: "/pages/consent/consent" }); },
  openChallenge() { wx.switchTab({ url: "/pages/challenges/challenges" }); },
  openLatestReport() { wx.navigateTo({ url: `/pages/report/report?id=${this.data.latestReport.id}` }); }
});
```

- [ ] **Step 4: 在开发者工具检查三入口和小屏布局**

Run: `npm test`
Expected: 所有测试 PASS；首页在 320px 模拟器中没有横向滚动，所有主要按钮高度不少于 44px。

- [ ] **Step 5: 提交首页与导航**

```bash
git add miniprogram tests/miniprogram/copy-and-theme.test.cjs
git commit -m "feat: add mini program navigation and home"
```

---

### Task 3: 建立微信身份、云调用和数据库安全边界

**Files:**
- Create: `miniprogram/services/cloud-client.js`
- Create: `miniprogram/lib/contracts.js`
- Create: `miniprogram/components/error-state/error-state.js`
- Create: `miniprogram/components/error-state/error-state.json`
- Create: `miniprogram/components/error-state/error-state.wxml`
- Create: `miniprogram/components/error-state/error-state.wxss`
- Create: `shared/cloud-guards.js`
- Create: `cloudfunctions/bootstrapUser/index.js`
- Create: `cloudfunctions/bootstrapUser/package.json`
- Create: `tests/miniprogram/contracts.test.cjs`
- Create: `tests/cloudfunctions/bootstrap-user.test.cjs`

**Interfaces:**
- Produces: `callCloud(name: string, data: object): Promise<object>`.
- Produces: `bootstrapUser(event, context): Promise<{ userId, latestReport, activeChallenge }>`.
- Produces: `assertOwnedRecord(record, openid): void` for all later cloud functions.

- [ ] **Step 1: 写协议与归属测试**

```js
test("owned records cannot be read by another openid", () => {
  assert.throws(() => assertOwnedRecord({ _openid: "A" }, "B"), /FORBIDDEN/);
  assert.doesNotThrow(() => assertOwnedRecord({ _openid: "A" }, "A"));
});
```

- [ ] **Step 2: 运行测试并确认接口不存在**

Run: `node --test tests/miniprogram/contracts.test.cjs tests/cloudfunctions/bootstrap-user.test.cjs`
Expected: FAIL，提示 `assertOwnedRecord` 尚未定义。

- [ ] **Step 3: 实现统一错误对象和用户初始化**

```js
// shared/cloud-guards.js
function assertOwnedRecord(record, openid) {
  if (!record || record._openid !== openid) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

module.exports = { assertOwnedRecord };

async function callCloud(name, data = {}) {
  try {
    const response = await wx.cloud.callFunction({ name, data });
    if (response.result?.error) throw Object.assign(new Error(response.result.error.message), response.result.error);
    return response.result;
  } catch (error) {
    throw { code: error.code || "NETWORK_ERROR", message: "暂时无法连接，请稍后重试" };
  }
}
```

- [ ] **Step 4: 验证云函数只返回当前用户数据**

Run: `npm test`
Expected: 协议和归属测试 PASS；伪造 `_openid` 的请求返回 `FORBIDDEN`。

- [ ] **Step 5: 提交身份与安全边界**

```bash
git add miniprogram/services miniprogram/lib/contracts.js cloudfunctions/bootstrapUser tests
git commit -m "feat: add cloud identity boundary"
```

---

### Task 4: 迁移并锁定挑战领域规则

**Files:**
- Create: `miniprogram/lib/face-style-core.js`
- Create: `tests/miniprogram/challenge-core.test.cjs`
- Modify: `tests/face-style-core.test.cjs`

**Interfaces:**
- Produces: `createChallenge`, `toggleChallengeCheckIn`, `getChallengeProgress`, `getChallengeOccurrenceDays`, `createChallengeHistoryEntry`.
- Produces: CommonJS module usable by pages and cloud functions.

- [ ] **Step 1: 用相同输入比较网页与小程序挑战结果**

```js
test("mini program challenge rules match the web MVP", () => {
  const web = loadWebCore();
  const mini = require("../../miniprogram/lib/face-style-core");
  const input = { title: "身体乳", durationDays: 7, frequency: "daily", reminderTime: "21:30" };
  const now = new Date("2026-09-03T12:00:00+08:00");
  assert.deepEqual(mini.createChallenge(input, now), web.createChallenge(input, now));
});
```

- [ ] **Step 2: 运行对等测试并确认模块尚不存在**

Run: `node --test tests/miniprogram/challenge-core.test.cjs`
Expected: FAIL，提示找不到 `miniprogram/lib/face-style-core.js`。

- [ ] **Step 3: 从 `#face-style-core` 迁移挑战纯函数并导出**

```js
module.exports = {
  CHALLENGE_TEMPLATES,
  createChallenge,
  toggleChallengeCheckIn,
  getChallengeProgress,
  getChallengeOccurrenceDays,
  createChallengeHistoryEntry
};
```

- [ ] **Step 4: 运行所有网页与小程序规则测试**

Run: `npm test`
Expected: 网页原有测试与小程序对等测试全部 PASS。

- [ ] **Step 5: 提交挑战规则迁移**

```bash
git add miniprogram/lib/face-style-core.js tests
git commit -m "feat: port challenge domain rules"
```

---

### Task 5: 实现云端挑战仓库和离线幂等同步

**Files:**
- Create: `cloudfunctions/challengeApi/index.js`
- Create: `cloudfunctions/challengeApi/package.json`
- Create: `miniprogram/services/offline-checkins.js`
- Create: `tests/cloudfunctions/challenge-api.test.cjs`
- Create: `tests/miniprogram/offline-checkins.test.cjs`

**Interfaces:**
- Consumes: challenge pure functions from Task 4 and `assertOwnedRecord` from Task 3.
- Produces: `challengeApi({ action, payload }, context)` actions `create`, `getActive`, `checkIn`, `undoCheckIn`, `finish`, `delete`.
- Produces: `enqueueCheckIn(command)` and `flushCheckIns(send)`.

- [ ] **Step 1: 写同日打卡幂等测试**

```js
test("replayed check-in command creates one dated record", async () => {
  const command = { id: "cmd-1", challengeId: "c1", date: "2026-09-03", completed: true };
  await api.checkIn(command, "openid-A");
  await api.checkIn(command, "openid-A");
  assert.equal(store.checkins.filter(item => item.challengeId === "c1").length, 1);
});
```

- [ ] **Step 2: 运行测试并确认幂等存储未实现**

Run: `node --test tests/cloudfunctions/challenge-api.test.cjs tests/miniprogram/offline-checkins.test.cjs`
Expected: FAIL，提示 `checkIn` 或 `flushCheckIns` 不存在。

- [ ] **Step 3: 使用 `challengeId + date` 唯一键保存打卡**

```js
const checkinId = `${openid}_${challengeId}_${date}`;
await db.collection("checkins").doc(checkinId).set({
  data: { _openid: openid, challengeId, date, completed, commandId, updatedAt: db.serverDate() }
});
```

- [ ] **Step 4: 验证断网重放不会重复计数**

Run: `npm test`
Expected: 重放两次仍只有一条当日记录；其他用户无法修改该挑战。

- [ ] **Step 5: 提交挑战仓库与离线同步**

```bash
git add cloudfunctions/challengeApi miniprogram/services/offline-checkins.js tests
git commit -m "feat: sync challenge check-ins safely"
```

---

### Task 6: 完成挑战创建、今日任务、照片节点和结营页面

**Files:**
- Modify: `miniprogram/pages/challenges/challenges.js`
- Modify: `miniprogram/pages/challenges/challenges.wxml`
- Modify: `miniprogram/pages/challenges/challenges.wxss`
- Create: `miniprogram/pages/challenge-create/challenge-create.js`
- Create: `miniprogram/pages/challenge-create/challenge-create.json`
- Create: `miniprogram/pages/challenge-create/challenge-create.wxml`
- Create: `miniprogram/pages/challenge-create/challenge-create.wxss`
- Create: `miniprogram/pages/challenge-detail/challenge-detail.js`
- Create: `miniprogram/pages/challenge-detail/challenge-detail.json`
- Create: `miniprogram/pages/challenge-detail/challenge-detail.wxml`
- Create: `miniprogram/pages/challenge-detail/challenge-detail.wxss`
- Create: `miniprogram/pages/challenge-complete/challenge-complete.js`
- Create: `miniprogram/pages/challenge-complete/challenge-complete.json`
- Create: `miniprogram/pages/challenge-complete/challenge-complete.wxml`
- Create: `miniprogram/pages/challenge-complete/challenge-complete.wxss`
- Create: `miniprogram/components/challenge-card/challenge-card.js`
- Create: `miniprogram/components/challenge-card/challenge-card.json`
- Create: `miniprogram/components/challenge-card/challenge-card.wxml`
- Create: `miniprogram/components/challenge-card/challenge-card.wxss`
- Create: `miniprogram/components/photo-pair/photo-pair.js`
- Create: `miniprogram/components/photo-pair/photo-pair.json`
- Create: `miniprogram/components/photo-pair/photo-pair.wxml`
- Create: `miniprogram/components/photo-pair/photo-pair.wxss`
- Create: `tests/miniprogram/challenge-pages.test.cjs`

**Interfaces:**
- Consumes: `challengeApi` and offline sync.
- Produces: stable page events `selectTemplate`, `submitChallenge`, `completeToday`, `undoToday`, `recordPhoto`, `finishChallenge`.

- [ ] **Step 1: 写页面主操作和范围测试**

```js
test("challenge detail exposes one primary daily action", () => {
  const wxml = fs.readFileSync("miniprogram/pages/challenge-detail/challenge-detail.wxml", "utf8");
  assert.equal((wxml.match(/class="[^"]*primary-action/g) || []).length, 1);
  assert.match(wxml, /完成今日打卡/);
  assert.match(wxml, /补记昨天/);
});
```

- [ ] **Step 2: 运行测试并确认页面尚不存在**

Run: `node --test tests/miniprogram/challenge-pages.test.cjs`
Expected: FAIL，提示挑战详情 WXML 不存在。

- [ ] **Step 3: 实现模板优先的四屏挑战闭环**

```xml
<button class="primary-action" bindtap="completeToday" disabled="{{!canCheckIn}}">
  {{checkedIn ? '今天已完成' : '完成今日打卡'}}
</button>
<button wx:if="{{checkedIn}}" class="text-action" bindtap="undoToday">撤销今天的打卡</button>
<button wx:if="{{canCheckInYesterday}}" class="text-action" bindtap="recordYesterday">补记昨天</button>
```

- [ ] **Step 4: 在模拟器完成模板创建到结营全流程**

Run: `npm test`
Expected: 页面测试 PASS；同一时间存在活动挑战时，创建第二个挑战会显示明确阻止提示。

- [ ] **Step 5: 提交挑战完整页面**

```bash
git add miniprogram/pages miniprogram/components tests/miniprogram/challenge-pages.test.cjs
git commit -m "feat: build complete challenge journey"
```

---

### Task 7: 实现人脸照片单独同意、选图和质量覆盖

**Files:**
- Create: `miniprogram/pages/consent/consent.js`
- Create: `miniprogram/pages/consent/consent.json`
- Create: `miniprogram/pages/consent/consent.wxml`
- Create: `miniprogram/pages/consent/consent.wxss`
- Create: `miniprogram/pages/photo-check/photo-check.js`
- Create: `miniprogram/pages/photo-check/photo-check.json`
- Create: `miniprogram/pages/photo-check/photo-check.wxml`
- Create: `miniprogram/pages/photo-check/photo-check.wxss`
- Create: `miniprogram/components/privacy-consent/privacy-consent.js`
- Create: `miniprogram/components/privacy-consent/privacy-consent.json`
- Create: `miniprogram/components/privacy-consent/privacy-consent.wxml`
- Create: `miniprogram/components/privacy-consent/privacy-consent.wxss`
- Create: `tests/miniprogram/photo-consent.test.cjs`
- Modify: `miniprogram/lib/face-style-core.js`

**Interfaces:**
- Produces: `consent = { type: "face-analysis", version: "2026-09-03", acceptedAt }`.
- Produces: `evaluatePhotoQuality(signals)` and `overridePhotoQuality(quality)`.
- Produces: compressed JPEG no larger than 1600px on its longest edge.

- [ ] **Step 1: 写未同意禁止上传和低质量可继续测试**

```js
test("analysis upload requires separate consent", () => {
  assert.throws(() => assertFaceConsent(null), /CONSENT_REQUIRED/);
});

test("low quality can be explicitly overridden", () => {
  const result = core.overridePhotoQuality({ accepted: false, level: "medium", issues: [{ id: "head_roll" }] });
  assert.equal(result.accepted, true);
  assert.equal(result.overridden, true);
});
```

- [ ] **Step 2: 运行测试并确认同意校验尚未实现**

Run: `node --test tests/miniprogram/photo-consent.test.cjs`
Expected: FAIL，提示 `assertFaceConsent` 不存在。

- [ ] **Step 3: 实现授权页和两个质量操作**

```xml
<privacy-consent bind:accept="choosePhoto" bind:decline="openChallenges" />
<button class="primary-action" bindtap="chooseAgain">重新拍一张</button>
<button class="secondary-action" bindtap="useAnyway">仍用这张照片分析</button>
```

- [ ] **Step 4: 验证拒绝、重拍和继续三条路径**

Run: `npm test`
Expected: 未同意不调用上传；拒绝后可进入挑战；质量覆盖结果带 `overridden: true`。

- [ ] **Step 5: 提交照片前置流程**

```bash
git add miniprogram/pages/consent miniprogram/pages/photo-check miniprogram/components/privacy-consent miniprogram/lib tests
git commit -m "feat: add consent and photo quality flow"
```

---

### Task 8: 建立分析任务协议、临时存储和状态查询

**Files:**
- Create: `cloudfunctions/analysisApi/index.js`
- Create: `cloudfunctions/analysisApi/package.json`
- Create: `miniprogram/pages/analysis/analysis.js`
- Create: `miniprogram/pages/analysis/analysis.json`
- Create: `miniprogram/pages/analysis/analysis.wxml`
- Create: `miniprogram/pages/analysis/analysis.wxss`
- Create: `tests/cloudfunctions/analysis-api.test.cjs`

**Interfaces:**
- Produces: `createAnalysis({ consentId, tempFileId, quality }): { jobId, status }`.
- Produces: `getAnalysis(jobId): { status, reportId?, error? }`.
- Produces analysis statuses: `queued | processing | complete | failed`.
- Produces source photo statuses: `pending | deleting | deleted | manual_review`.

- [ ] **Step 1: 写无同意、跨用户和重复创建测试**

```js
test("analysis job requires an owned active consent", async () => {
  await assert.rejects(() => api.createAnalysis({ consentId: "other", tempFileId: "f1" }, "openid-A"), /CONSENT_REQUIRED/);
});
```

- [ ] **Step 2: 运行测试并确认任务 API 不存在**

Run: `node --test tests/cloudfunctions/analysis-api.test.cjs`
Expected: FAIL，提示分析 API 模块不存在。

- [ ] **Step 3: 实现任务状态机和一次性容器凭证**

```js
const job = {
  _openid: openid,
  consentId,
  tempFileId,
  status: "queued",
  sourcePhotoStatus: "pending",
  deleteBy: new Date(Date.now() + 30 * 60 * 1000),
  createdAt: db.serverDate()
};
```

- [ ] **Step 4: 验证查询只能读取自己的任务**

Run: `npm test`
Expected: 状态转换合法；重复提交同一 `clientRequestId` 返回原任务；跨用户查询返回 `FORBIDDEN`。

- [ ] **Step 5: 提交分析任务管道**

```bash
git add cloudfunctions/analysisApi miniprogram/pages/analysis tests/cloudfunctions/analysis-api.test.cjs
git commit -m "feat: add secure analysis job pipeline"
```

---

### Task 9: 部署兼容 68 点输出的云托管分析容器

**Files:**
- Create: `cloudrun/face-analysis/package.json`
- Create: `cloudrun/face-analysis/package-lock.json`
- Create: `cloudrun/face-analysis/Dockerfile`
- Create: `cloudrun/face-analysis/src/server.js`
- Create: `cloudrun/face-analysis/src/inference.js`
- Create: `cloudrun/face-analysis/src/validate.js`
- Create: `tests/cloudrun/inference-contract.test.cjs`
- Create: `tests/cloudrun/fixtures/front-face.jpg`

**Interfaces:**
- Consumes: one-time `jobId`, signed photo URL and expected SHA-256.
- Produces: `{ jobId, detectionScore, points[68], faceBox, imageSize, modelVersion }`.
- Produces: `GET /health` returning `{ ok: true, modelLoaded: true }`.

- [ ] **Step 1: 写固定图片推理契约测试**

```js
test("inference returns exactly 68 finite landmarks", async () => {
  const result = await inferFixture("tests/cloudrun/fixtures/front-face.jpg");
  assert.equal(result.points.length, 68);
  result.points.forEach(point => {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
  });
  assert.ok(result.detectionScore >= 0 && result.detectionScore <= 1);
});
```

- [ ] **Step 2: 运行契约测试并确认推理实现不存在**

Run: `node --test tests/cloudrun/inference-contract.test.cjs`
Expected: FAIL，提示 `inferFixture` 不存在。

- [ ] **Step 3: 固定模型来源并实现最小推理服务**

`cloudrun/face-analysis/package.json` 固定依赖，不使用浮动版本：

```json
{
  "name": "face-style-analysis",
  "private": true,
  "scripts": { "start": "node src/server.js" },
  "dependencies": {
    "@vladmandic/face-api": "1.7.15",
    "express": "4.21.2",
    "@tensorflow/tfjs-node": "4.16.0"
  }
}
```

`Dockerfile` 使用有安全更新支持的 Node.js 20 基础镜像：

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
```

推理从 `node_modules/@vladmandic/face-api/model` 加载包内固定权重。该分支兼容 TensorFlow.js 4，并继续输出与原始 Face-API.js 相同语义的 68 点模型；不得启用年龄、性别、情绪或身份识别模块。

容器响应必须通过以下校验：

```js
function validateResult(result) {
  if (!Array.isArray(result.points) || result.points.length !== 68) throw new Error("INVALID_LANDMARK_COUNT");
  if (!result.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error("INVALID_LANDMARK_VALUE");
  return result;
}
```

- [ ] **Step 4: 构建容器并运行健康与固定图片测试**

Run: `docker build -t face-style-analysis:test cloudrun/face-analysis`
Expected: 构建成功。

Run: `npm test`
Expected: 固定图片输出 68 点；无脸图片返回 `NO_FACE`，多脸图片返回 `MULTIPLE_FACES`。

- [ ] **Step 5: 提交模型容器**

```bash
git add cloudrun/face-analysis tests/cloudrun
git commit -m "feat: add cloud face landmark service"
```

---

### Task 10: 实现报告生成、身份卡和推荐挑战

**Files:**
- Modify: `miniprogram/lib/face-style-core.js`
- Create: `miniprogram/pages/report/report.js`
- Create: `miniprogram/pages/report/report.json`
- Create: `miniprogram/pages/report/report.wxml`
- Create: `miniprogram/pages/report/report.wxss`
- Create: `miniprogram/components/identity-card/identity-card.js`
- Create: `miniprogram/components/identity-card/identity-card.json`
- Create: `miniprogram/components/identity-card/identity-card.wxml`
- Create: `miniprogram/components/identity-card/identity-card.wxss`
- Create: `tests/miniprogram/report-parity.test.cjs`

**Interfaces:**
- Consumes: normalized 68 points from Task 9.
- Produces: `computeMeasurements`, `deriveReadableProfile`, `buildIdentityPresentation`, `composeReport`.
- Produces: report route `/pages/report/report?id=<reportId>`.

- [ ] **Step 1: 写网页与小程序报告对等测试**

```js
test("fixed landmarks produce the same readable report", () => {
  const web = loadWebCore();
  const mini = require("../../miniprogram/lib/face-style-core");
  const points = makeFrontLandmarks();
  assert.deepEqual(mini.computeMeasurements(points, "high"), web.computeMeasurements(points, "high"));
});
```

- [ ] **Step 2: 运行测试并确认报告函数尚未迁移**

Run: `node --test tests/miniprogram/report-parity.test.cjs`
Expected: FAIL，提示 `computeMeasurements` 不存在。

- [ ] **Step 3: 迁移报告纯函数并实现沉浸式长页面**

```xml
<identity-card presentation="{{report.identity}}" />
<view class="readable-summary">{{report.memorySentence}}</view>
<view wx:for="{{report.dataGroups}}" wx:key="id">{{item.title}} · {{item.explanation}}</view>
<button bindtap="createRecommendedChallenge">加入推荐挑战</button>
```

- [ ] **Step 4: 运行报告对等和禁用文案测试**

Run: `npm test`
Expected: 固定关键点得到与网页相同的比例和脸型；源码不含“颜值评分”“缺点”“完美比例”。

- [ ] **Step 5: 提交报告和身份卡**

```bash
git add miniprogram/lib miniprogram/pages/report miniprogram/components/identity-card tests
git commit -m "feat: add readable identity report"
```

---

### Task 11: 保证分析原图删除和挑战照片生命周期

**Files:**
- Create: `cloudfunctions/lifecycleJobs/index.js`
- Create: `cloudfunctions/lifecycleJobs/package.json`
- Modify: `cloudfunctions/analysisApi/index.js`
- Modify: `cloudfunctions/challengeApi/index.js`
- Create: `tests/cloudfunctions/photo-lifecycle.test.cjs`

**Interfaces:**
- Produces: `deleteAnalysisPhoto(jobId)`, `deleteExpiredPhotos(now)`, `deleteChallengePhotos(challengeId)`.
- Produces: deletion states `pending | retrying | deleted | manual_review`.

- [ ] **Step 1: 写成功、失败、超时和退出四条删除测试**

```js
for (const terminalStatus of ["complete", "failed", "timeout", "cancelled"]) {
  test(`${terminalStatus} analysis schedules source deletion`, async () => {
    await finishJob("job-1", terminalStatus);
    assert.equal(store.deletionJobs[0].sourceId, "job-1");
  });
}
```

- [ ] **Step 2: 运行测试并确认没有删除队列**

Run: `node --test tests/cloudfunctions/photo-lifecycle.test.cjs`
Expected: FAIL，提示 `deleteAnalysisPhoto` 不存在。

- [ ] **Step 3: 实现幂等删除和 30 分钟兜底**

```js
async function deleteAnalysisPhoto(job) {
  if (job.photoDeletedAt) return { deleted: true };
  await cloud.deleteFile({ fileList: [job.tempFileId] });
  await jobs.doc(job._id).update({ data: { photoDeletedAt: db.serverDate(), sourcePhotoStatus: "deleted" } });
  return { deleted: true };
}
```

- [ ] **Step 4: 验证重复删除安全且过期对象被清除**

Run: `npm test`
Expected: 重复执行不报错；超过 `deleteBy` 的分析照片被删除；挑战结束 7 天后按策略删除。

- [ ] **Step 5: 提交照片生命周期**

```bash
git add cloudfunctions/lifecycleJobs cloudfunctions/analysisApi cloudfunctions/challengeApi tests/cloudfunctions/photo-lifecycle.test.cjs
git commit -m "feat: enforce photo retention lifecycle"
```

---

### Task 12: 生成身份卡、结营海报和小程序分享

**Files:**
- Modify: `miniprogram/pages/report/report.js`
- Modify: `miniprogram/pages/report/report.wxml`
- Modify: `miniprogram/pages/challenge-complete/challenge-complete.js`
- Modify: `miniprogram/pages/challenge-complete/challenge-complete.wxml`
- Create: `miniprogram/lib/poster.js`
- Create: `cloudfunctions/shareApi/index.js`
- Create: `cloudfunctions/shareApi/package.json`
- Create: `tests/miniprogram/poster.test.cjs`

**Interfaces:**
- Produces: `drawIdentityPoster(ctx, report, options)`.
- Produces: `drawChallengePoster(ctx, challenge, photos, miniCode)`.
- Produces: `getMiniCode({ scene, page }): fileId` server-side only.

- [ ] **Step 1: 写默认海报隐私测试**

```js
test("default challenge poster excludes facial measurements", () => {
  const model = buildChallengePosterModel(challenge, { includePhotos: false });
  assert.equal("measurements" in model, false);
  assert.equal("landmarks" in model, false);
  assert.equal(model.includePhotos, false);
});
```

- [ ] **Step 2: 运行测试并确认海报模型不存在**

Run: `node --test tests/miniprogram/poster.test.cjs`
Expected: FAIL，提示 `buildChallengePosterModel` 不存在。

- [ ] **Step 3: 实现 Canvas 导出、相册保存和好友分享**

```js
wx.canvasToTempFilePath({
  canvas,
  success: ({ tempFilePath }) => wx.saveImageToPhotosAlbum({ filePath: tempFilePath })
});
```

页面的 `onShareAppMessage` 返回报告或挑战页面路径，不上传临时海报图片作为永久公共文件。

- [ ] **Step 4: 真机验证拒绝相册权限后的降级提示**

Run: `npm test`
Expected: 海报隐私测试 PASS；拒绝相册权限时仍可返回报告并重新尝试授权。

- [ ] **Step 5: 提交海报与分享**

```bash
git add miniprogram cloudfunctions/shareApi tests/miniprogram/poster.test.cjs
git commit -m "feat: add privacy-safe mini program sharing"
```

---

### Task 13: 添加手机日历和一次性订阅提醒

**Files:**
- Create: `cloudfunctions/reminderApi/index.js`
- Create: `cloudfunctions/reminderApi/package.json`
- Modify: `miniprogram/pages/challenge-detail/challenge-detail.js`
- Modify: `miniprogram/pages/challenge-detail/challenge-detail.wxml`
- Create: `tests/cloudfunctions/reminder-api.test.cjs`
- Create: `tests/miniprogram/calendar.test.cjs`

**Interfaces:**
- Produces: `buildCalendarEvent(challenge, occurrence): AddPhoneCalendarOptions`.
- Produces: `saveSubscriptionResult(templateId, status)`.
- Produces: `sendDueReminders(now)` for accepted, unused one-time subscriptions.
- Produces: `getConfig(): { templateId: string }`, sourced from the cloud function environment variable `REMINDER_TEMPLATE_ID`.

- [ ] **Step 1: 写日历内容和拒绝提醒降级测试**

```js
test("calendar event contains task and mini program return hint", () => {
  const event = buildCalendarEvent(challenge, { day: 4, startsAt: 1788442200 });
  assert.match(event.title, /挑战/);
  assert.match(event.description, /回到小程序完成打卡/);
  assert.equal(event.alarm, true);
});
```

- [ ] **Step 2: 运行测试并确认日历构造器不存在**

Run: `node --test tests/miniprogram/calendar.test.cjs tests/cloudfunctions/reminder-api.test.cjs`
Expected: FAIL，提示 `buildCalendarEvent` 不存在。

- [ ] **Step 3: 实现日历确认与用户触发的订阅授权**

```js
const { templateId } = await callCloud("reminderApi", { action: "getConfig" });
wx.requestSubscribeMessage({
  tmplIds: [templateId],
  complete: result => saveSubscriptionResult(templateId, result[templateId])
});
```

只有用户点击“开启微信提醒”时调用订阅接口；拒绝后不自动重复弹窗。

- [ ] **Step 4: 验证无订阅时挑战仍完整可用**

Run: `npm test`
Expected: 日历事件时间和任务正确；拒绝订阅不会改变挑战状态或隐藏今日任务。

- [ ] **Step 5: 提交提醒能力**

```bash
git add cloudfunctions/reminderApi miniprogram/pages/challenge-detail tests
git commit -m "feat: add calendar and subscription reminders"
```

---

### Task 14: 完成“我的”、数据删除和隐私文档

**Files:**
- Create: `cloudfunctions/accountApi/index.js`
- Create: `cloudfunctions/accountApi/package.json`
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Create: `docs/wechat/privacy-guideline.md`
- Create: `docs/wechat/face-consent-copy.md`
- Create: `docs/wechat/data-retention.md`
- Create: `tests/cloudfunctions/account-api.test.cjs`

**Interfaces:**
- Produces: `deleteReport(reportId)`, `deleteChallenge(challengeId)`, `withdrawFaceConsent()`, `deleteAccountData()`.
- Produces: auditable deletion summary `{ reports, challenges, photos, subscriptions, completedAt }`.

- [ ] **Step 1: 写账户级联删除测试**

```js
test("account deletion removes every owned private collection", async () => {
  const summary = await deleteAccountData("openid-A");
  assert.deepEqual(summary.remaining, []);
  assert.equal(store.records.some(item => item._openid === "openid-A"), false);
  assert.equal(store.records.some(item => item._openid === "openid-B"), true);
});
```

- [ ] **Step 2: 运行测试并确认级联删除未实现**

Run: `node --test tests/cloudfunctions/account-api.test.cjs`
Expected: FAIL，提示 `deleteAccountData` 不存在。

- [ ] **Step 3: 实现二次确认、级联删除和用户可读说明**

```xml
<button class="danger-secondary" bindtap="confirmDeleteAll">清空我的全部数据</button>
<text>这会删除身份卡、挑战、打卡和云端照片，且无法恢复。</text>
```

- [ ] **Step 4: 验证单份删除、整组删除和全部删除**

Run: `npm test`
Expected: 只删除当前用户数据；照片删除失败会进入重试队列；订阅记录同步失效。

- [ ] **Step 5: 提交隐私与数据管理**

```bash
git add cloudfunctions/accountApi miniprogram/pages/profile docs/wechat tests/cloudfunctions/account-api.test.cjs
git commit -m "feat: add user data controls and privacy docs"
```

---

### Task 15: 完成全链路回归、真机矩阵和提审材料

**Files:**
- Create: `tests/e2e/critical-journeys.md`
- Create: `docs/wechat/device-matrix.md`
- Create: `docs/wechat/release-checklist.md`
- Create: `docs/wechat/reviewer-guide.md`
- Create: `docs/wechat/cloud-setup.md`
- Create: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one release candidate that can be uploaded with WeChat DevTools and followed by a reviewer without developer assistance.

- [ ] **Step 1: 写五条不可跳过的端到端场景**

```text
1. 拒绝人脸同意 → 进入挑战 → 创建模板 → 完成打卡。
2. 同意 → 选择合格照片 → 分析 → 原图删除 → 身份卡 → 推荐挑战。
3. 低质量照片 → 仍然分析 → 参考报告 → 保存身份卡。
4. 断网打卡 → 恢复网络 → 只出现一条当日记录。
5. 完成挑战 → 可选对照照 → 海报 → 保存相册 → 好友打开分享路径。
```

- [ ] **Step 2: 运行完整自动化测试**

Run: `npm test`
Expected: 全部 PASS，且现有网页测试没有回归。

- [ ] **Step 3: 执行真机和权限拒绝矩阵**

```text
设备：较新 iPhone、较旧 iPhone、主流安卓、低性能安卓。
网络：Wi-Fi、移动网络、弱网、断网恢复。
权限：照片、相册、日历、订阅分别测试允许和拒绝。
界面：320px 小屏、系统字体放大、安全区和长报告滚动。
```

- [ ] **Step 4: 完成发布检查**

Run: `git diff --check && npm test`
Expected: 无空白错误；全部测试 PASS；`release-checklist.md` 中 AppID、生产 EnvId、服务类目、备案、隐私指引、订阅模板、云托管版本和回滚版本均已勾选。

- [ ] **Step 5: 提交发布候选文档**

```bash
git add README.md docs/wechat tests/e2e
git commit -m "docs: prepare mini program release candidate"
```
