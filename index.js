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
