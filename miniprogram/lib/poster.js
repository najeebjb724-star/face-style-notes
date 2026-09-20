const COLORS = {
  background: "#F7F3EE",
  surface: "#FFFDF9",
  accent: "#C9A87C",
  text: "#2C2420",
  muted: "#7A6B5A"
};

function buildIdentityPosterModel(report = {}) {
  return {
    title: report.identity?.title || "我的美学身份卡",
    subtitle: report.identity?.subtitle || "照片内结构参考",
    memorySentence: report.memorySentence || "找到适合自己的表达方式。"
  };
}

function buildChallengePosterModel(challenge = {}, options = {}) {
  return {
    title: challenge.title || "我的挑战复盘",
    completed: Number(challenge.completed) || 0,
    total: Number(challenge.total) || 0,
    completionRate: Number(challenge.completionRate) || 0,
    streak: Number(challenge.streak) || 0,
    includePhotos: options.includePhotos === true
  };
}

function prepareCanvas(ctx) {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, 300, 420);
  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(20, 20, 260, 380);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(20, 20, 260, 6);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "left";
}

function drawIdentityPoster(ctx, report, options = {}) {
  const model = buildIdentityPosterModel(report, options);
  prepareCanvas(ctx);
  ctx.font = "16px sans-serif";
  ctx.fillText("美学身份卡", 42, 70);
  ctx.font = "24px sans-serif";
  ctx.fillText(model.title, 42, 118);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "15px sans-serif";
  ctx.fillText(model.subtitle, 42, 150);
  ctx.fillText(model.memorySentence, 42, 220);
  if (options.miniCode && typeof ctx.drawImage === "function") ctx.drawImage(options.miniCode, 188, 270, 60, 60);
  return model;
}

function drawChallengePoster(ctx, challenge, photos = [], miniCode) {
  const model = buildChallengePosterModel(challenge, { includePhotos: challenge?.includePhotos === true });
  prepareCanvas(ctx);
  ctx.font = "16px sans-serif";
  ctx.fillText("挑战结营", 42, 70);
  ctx.font = "24px sans-serif";
  ctx.fillText(model.title, 42, 118);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "15px sans-serif";
  ctx.fillText(`完成 ${model.completed} / ${model.total} 次`, 42, 170);
  ctx.fillText(`完成率 ${model.completionRate}%`, 42, 205);
  ctx.fillText(`最长连续 ${model.streak} 次`, 42, 240);
  if (model.includePhotos && photos.length && typeof ctx.drawImage === "function") {
    ctx.drawImage(photos[0], 42, 270, 80, 80);
    if (photos[1]) ctx.drawImage(photos[1], 130, 270, 80, 80);
  }
  if (miniCode && typeof ctx.drawImage === "function") ctx.drawImage(miniCode, 218, 285, 50, 50);
  return model;
}

module.exports = {
  buildIdentityPosterModel,
  buildChallengePosterModel,
  drawIdentityPoster,
  drawChallengePoster
};
