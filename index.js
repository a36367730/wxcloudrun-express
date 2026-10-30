const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");
const weather = require("./weather");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// 健康检查（供小程序服务名探测：必须返回 service: 'fishing-weather-host' 才算命中）
app.get("/healthz", (req, res) => {
  res.send({
    service: "fishing-weather-host",
    status: "ok",
    keyConfigured: !!weather.getKey(),
  });
});

// ===== 通用和风天气代理 /api/q/* =====
// 把和风原始 path（含 /v7、/geo/v2、/weatheralert/v1 等）原样转发到候选 Host。
// 前端只需拼 path：/api/q/v7/weather/now、/api/q/geo/v2/city/lookup、
//   /api/q/v7/historical/weather、/api/q/v7/indices/1d、
//   /api/q/weatheralert/v1/current/{lat}/{lon} ...
// 成功返回 { code: 0, data: <和风原始 JSON> }；代理层失败返回 { code: 1, msg }。
app.get("/api/q/*", async (req, res) => {
  try {
    const sub = "/" + (req.params[0] || "");
    const qs = Object.keys(req.query)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`)
      .join("&");
    const full = sub + (qs ? "?" + qs : "");
    const data = await weather.requestFirstSuccess(full);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(502).send({ code: 1, msg: e.message });
  }
});

// ===== 和风天气（QWeather）接口 =====
// location 格式：经度,纬度（如 117.30,39.88）或 LocationID
// 示例：/api/weather/now?location=117.30,39.88
app.get("/api/weather/now", async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) return res.status(400).send({ code: 1, msg: "缺少 location 参数，格式：经度,纬度 或 LocationID" });
    const data = await weather.getNow(location);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(500).send({ code: 1, msg: e.message });
  }
});

app.get("/api/weather/3d", async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) return res.status(400).send({ code: 1, msg: "缺少 location 参数，格式：经度,纬度 或 LocationID" });
    const data = await weather.get3d(location);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(500).send({ code: 1, msg: e.message });
  }
});

app.get("/api/weather/7d", async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) return res.status(400).send({ code: 1, msg: "缺少 location 参数，格式：经度,纬度 或 LocationID" });
    const data = await weather.get7d(location);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(500).send({ code: 1, msg: e.message });
  }
});

app.get("/api/weather/24h", async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) return res.status(400).send({ code: 1, msg: "缺少 location 参数，格式：经度,纬度 或 LocationID" });
    const data = await weather.get24h(location);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(500).send({ code: 1, msg: e.message });
  }
});

// 城市搜索：/api/geo/city?name=承德
app.get("/api/geo/city", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).send({ code: 1, msg: "缺少 name 参数，如 ?name=承德" });
    const data = await weather.cityLookup(name);
    res.send({ code: 0, data });
  } catch (e) {
    res.status(500).send({ code: 1, msg: e.message });
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  // 数据库初始化失败不影响天气接口运行（未配置 MySQL 时跳过）
  try {
    await initDB();
  } catch (e) {
    console.warn("数据库初始化失败，天气服务仍可运行：", e.message);
  }
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
