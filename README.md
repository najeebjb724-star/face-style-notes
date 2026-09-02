# 美学身份卡 · Face Style Notes

一款面向年轻女性的移动端面部比例分析与变美行动网页。上传正面照片后，页面会把面部轮廓与比例整理成可读、可收藏、可分享的“美学身份卡”，并可继续创建变美挑战、完成打卡和记录前后对比。

> 当前完整网页版 MVP 与 GitHub Pages 部署位于 `codex/aesthetic-identity-card-ui` 分支。

[在线体验](https://najeebjb724-star.github.io/face-style-notes/) · [查看完整源码](https://github.com/najeebjb724-star/face-style-notes/tree/codex/aesthetic-identity-card-ui)

![美学身份卡手机端首页预览](https://raw.githubusercontent.com/najeebjb724-star/face-style-notes/codex/aesthetic-identity-card-ui/assets/preview.png)

## 核心功能

- **照片质量检查**：提示角度、清晰度、亮度和人脸大小问题。
- **参考级继续分析**：照片不完全合格时，用户仍可主动选择继续，并看到可信度提示。
- **可读面部数据**：将三庭、眼距、轮廓和六维特征转成容易理解的描述。
- **美学身份卡**：以杂志与收藏卡风格呈现结果，可保存或通过系统分享。
- **变美挑战**：模板优先、可选自定义，支持打卡、日历提醒、前后照片对比和挑战海报。

## 隐私与结果边界

用户选择的照片在浏览器本地处理，不会发送到本项目服务器。挑战记录和可选对比照片可能保存在当前浏览器的本地存储中。GitHub Pages 与第三方 CDN 会产生加载页面、脚本、字体或模型所需的常规网络请求，但不会上传用户选择的照片。

身份卡基于单张照片与几何比例提供风格参考，不评价美丑，不构成医疗、健康或人格判断。拍摄角度、光线、镜头畸变、表情和启发式规则都会影响结果。

[查看完整隐私说明](https://github.com/najeebjb724-star/face-style-notes/blob/codex/aesthetic-identity-card-ui/PRIVACY.md)

## 本地体验

下载或克隆[完整源码分支](https://github.com/najeebjb724-star/face-style-notes/tree/codex/aesthetic-identity-card-ui)，在项目目录运行：

```bash
python -m http.server 8000
```

然后访问 `http://127.0.0.1:8000/`。首次打开需要联网加载 Tailwind CSS、Face-API.js、html2canvas 和面部关键点模型。

## 技术构成

- 单文件 HTML、CSS 与原生 JavaScript
- Tailwind CSS CDN
- Face-API.js 0.22.2 与 68 点关键点模型
- html2canvas 1.4.1
- localStorage、IndexedDB、Web Share 与日历 `.ics` 文件
- GitHub Actions 与 GitHub Pages

## 测试状态

完整源码分支已通过 81 项自动测试：

```bash
node --test tests/*.test.cjs
```

## 当前阶段

这是用于验证“面部分析 → 身份卡 → 变美挑战 → 打卡与分享”链路的网页版 MVP。微信登录、云数据库、订阅消息、日历能力和小程序码将在迁移到微信小程序时另行设计。

## License

本项目采用 [MIT License](https://github.com/najeebjb724-star/face-style-notes/blob/codex/aesthetic-identity-card-ui/LICENSE)。
