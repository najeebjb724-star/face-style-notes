# CloudBase 与微信后台最短配置路径

## 使用前提

当前没有真实 AppID、EnvId、订阅模板、CloudRun 版本或部署结果。本页是执行清单，不是已部署说明。配置完成仍必须通过 [发布检查清单](release-checklist.md)、[关键旅程](../../tests/e2e/critical-journeys.md) 和 [真机矩阵](device-matrix.md)。

**只需要提供 AppID、EnvId 和已核准的模板配置。绝不要把 AppSecret 发给开发者、粘贴到聊天/工单、写进本仓库或放入小程序包。**

## 用户需要做的最少操作

1. 在微信公众平台注册小程序，完成主体认证、服务类目、所需资质、备案和正式隐私保护指引。
2. 复制公开的 **AppID**，在微信开发者工具导入本仓库并把 `touristappid` 换成真实 AppID。不要提供 AppSecret。
3. 在微信云开发创建开发环境，并在受控发布工单记录体验/生产 **EnvId**。当前运行时代码固定调用 `getCloudEnv("develop")`；只可为开发/测试阶段配置并验证 `develop`，不能因填写了 `trial` 或 `release` 槽位就声称体验版或发布版正在使用对应 EnvId。运行时渠道选择实现并验证前，不要把 trial/release EnvId 作为可用配置。
4. 在微信后台申请一次性订阅消息模板，记录模板 ID、字段名/类型和跳转页；不要自行猜字段。
5. 指定运营联系人、投诉渠道、告警接收人、删除审计保留期限，并提供发布与回滚负责人。

完成以上五步后，工程/运维按下文部署。AppID 与 EnvId 可记录在受控发布工单；AppSecret 不进入本流程。

## 分阶段发布路径

1. **阶段 1：上传前阻塞。** 完成本页的部署、权限、模型、清理、提醒和运营资料，以及运行时环境选择验证；关闭 [发布检查清单](release-checklist.md) 中所有阶段 1 项。
2. **阶段 2：上传体验版。** 仅在阶段 1 关闭后，由发布负责人上传体验版并记录版本、成员权限和审核账号。
3. **阶段 3：执行体验版。** 用该体验版完成 [关键旅程](../../tests/e2e/critical-journeys.md)、[真机矩阵](device-matrix.md) 和 [审核员指引](reviewer-guide.md)，并保留真实证据。
4. **阶段 4：签字与提审。** 阶段 1–3 全部通过后，完成最终签字并提交审核。

## 阶段 1：工程部署顺序

### 1. 建立集合和最小权限

目标环境需要以下集合：

`users`、`consents`、`analysis_uploads`、`analysis_jobs`、`reports`、`challengeOwners`、`challenges`、`checkins`、`challenge_photos`、`share_previews`、`reminder_subscriptions`、`deletion_jobs`。

以服务器写入为默认：删除任务、分析任务、分享预览、提醒、挑战照片和所有归属字段不得由客户端任意写入。用户身份只取云函数运行时 OPENID，不接受客户端传入的 owner。用两个测试账号验证彼此不能读取、修改或删除对方数据。

### 2. 创建真实查询要求的索引

按 CloudBase 部署提示创建并验证至少这些组合：

- `deletion_jobs(state, dueAt)`
- `analysis_jobs(sourcePhotoStatus, deleteBy)`
- `analysis_jobs(sourcePhotoStatus, status, leaseExpiresAt)`
- `analysis_uploads(status, deleteBy)`
- `challenges(status, photosCleaned, completedAt)`
- `challenge_photos(challengeId, _openid, deletionState, retentionPolicy)`
- `share_previews(expiresAt)`
- 提醒到期查询所需的 `reminder_subscriptions(status, usedAt, sendState, dueAt)`

其余 `_openid`、`_id` 复合查询以目标环境实际报错/建议为准。不要把“已创建索引”当成通过；要执行对应真实查询并保存证据。

### 3. 部署云函数

在同一目标 EnvId 部署：

`bootstrapUser`、`challengeApi`、`analysisApi`、`accountApi`、`shareApi`、`reminderApi`、`lifecycleJobs`。

服务端安装各目录锁定的依赖。限制普通客户端直接调用生命周期 worker 和提醒发送 worker。验证函数写入使用目标 wx-server-sdk 的 `{ data: ... }` 形态，事务查询、冲突重试和原子提交行为与本地假实现一致。

### 4. 部署 68 点模型服务

按 `cloudrun/face-analysis/DEPLOYMENT.md` 构建并部署 Node 20 镜像。记录不可变镜像/版本号和上一可用回滚版本，先执行：

```powershell
npm run test:face-analysis-release
```

配置：

| 位置 | 配置 | 值 |
| --- | --- | --- |
| `analysisApi` | `FACE_ANALYSIS_URL` | 模型服务的 HTTPS `/analyze` 地址 |
| `analysisApi` | `PHOTO_URL_HOSTS` | CloudBase 临时照片 URL 的精确主机白名单 |
| 模型服务 | `CREDENTIAL_CONSUMER_URL` | `analysisApi` HTTP 网关 `main` 地址 |
| 模型服务 | `PHOTO_URL_HOSTS` | 同一精确主机白名单 |

HTTP 网关只能承载短期任务凭证的领取/完成/失败回调，不能暴露通用数据库接口。真实验证健康检查、单脸 68 点、零脸、多脸、凭证单次使用、过期、超时、并发 429、下载大小/域名/重定向限制和回调失败。完成依赖安全升级兼容验证，或由安全负责人书面接受残余风险。

### 5. 关闭原图与挑战照片硬阻塞

上线前必须先实现并验证：

- 上传成功但设备在 `attachUpload` 前消失时，服务端仍掌握精确云文件 ID；可选方案是上传前服务端发放可核验 ID，或 CloudBase 已验证的存储清单/到期策略。不能从路径猜 ID。
- 挑战照片的按用户隔离云桥由服务端持久化精确 `fileId`、`challengeId`、`_openid` 与可选 `retentionPolicy`。当前客户端只本地预览，不能直接放行。

### 6. 启用生命周期任务与监控

部署 `lifecycleJobs/config.json` 的一分钟定时触发器，把函数超时设为小于一分钟租约。确认每次最多处理 50 个候选时，真实容量仍满足采用的原图清理时限。

必须告警：

- `PHOTO_DELETE_FAILED` / `LIFECYCLE_JOB_FAILED`
- 任意 `manual_review`
- 两分钟无定时器心跳
- 最老未删除原图接近对外时限
- 队列积压、函数超时、存储故障、分享预览/小程序码过期未清理
- 提醒长期停在 `sending` 或进入 `manual_review`

人工处置只能在核对精确对象与真实存储回执后关闭；不得手工把状态改成 `deleted` 来消警。用成功、失败、取消、超时、孤立上传、超过 50 项、大账户和存储中断场景验证恢复。

### 7. 配置订阅消息与受保护调度器

将微信后台核准的模板 ID 配为 `REMINDER_TEMPLATE_ID`，把完全匹配模板字段的 JSON 映射配为 `REMINDER_TEMPLATE_DATA`。部署只有受信调度器能调用的 `sendDueReminders`；普通小程序入口不能触发批量发送。

发送是最多尝试一次，不是已确认的恰好一次。发送异常或发送后落库不确定会进入 `manual_review`；任何人工重试前先与微信提供方核对，避免重复消息。

### 8. 补齐隐私与运营资料

把 [隐私说明](privacy-guideline.md)、[单独同意文案](face-consent-copy.md) 和 [保留与删除](data-retention.md) 与微信后台正式指引逐项对齐。补充真实运营主体、联系/投诉渠道、有限删除审计保留期限和自动到期删除机制。

对外说明必须保留这些边界：仅作个人造型参考；不是医疗/识别/排名；相册/截图/他人副本不能远程删除；已提交提醒无法撤回；清空数据不是注销账号。

## 阶段 1 完成后的上传、执行与回滚

1. 阶段 1 记录 AppID、目标 EnvId、所有函数版本、模型版本、回滚版本和配置校验值（不记录密钥），并验证运行时渠道实际使用正确 EnvId。
2. **阶段 2：**上传体验版，记录版本、说明、成员权限和审核账号。
3. **阶段 3：**用该体验版执行五条关键旅程、四类设备、四类网络、权限允许/拒绝、显示矩阵和审核员指引；核查精确存储删除回执、分享七天到期清理、订阅人工核查、大账户批处理和跨账号隔离。
4. 在阶段 1–3 全部通过前，演练模型和云函数回滚；回滚后重新跑烟雾测试并确认不会把新数据写入错误环境。
5. **阶段 4：**只有 [发布检查清单](release-checklist.md) 的最终签字完成后，才提交审核；体验版上传和审核员执行不应等待阶段 3/4 完成。
