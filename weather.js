/**
 * 和风天气（QWeather）通用代理模块
 * 文档：https://dev.qweather.com/
 *
 * 设计要点：
 * - 密钥仅来自环境变量 QWEATHER_KEY，绝不写死在代码里。
 * - 兼容多 Host：项目专属 Host（默认 kb7p45c2pa.re.qweatherapi.com）、
 *   标准 api.qweather.com、开发版 devapi、geoapi。按候选顺序重试，
 *   第一个返回 code:200 即采用，无需手动配置 Host。
 * - 通用代理 /api/q/* ：把和风原始 path（含 /v7、/geo/v2、/weatheralert 等）
 *   原样转发到候选 Host，使前端只需拼 path 即可调用任意和风接口
 *   （实时/3天/7天/逐小时/72h/168h/历史时光机/生活指数/预警 GeoAPI 等）。
 * - 自动 gzip/deflate 解压（按响应头 + 字节魔数双重兜底）。
 * - location 格式：经度,纬度（如 117.30,39.88）或 LocationID。
 */

const https = require('https');
const zlib = require('zlib');

function getKey() {
  return (process.env.QWEATHER_KEY || '').trim();
}

// 默认项目专属 Host（和风「开发者信息」页 API Host，无需再配环境变量即可生效；
// 仍可用环境变量 QWEATHER_HOST 覆盖）。
const PROJECT_HOST = 'kb7p45c2pa.re.qweatherapi.com';

/** 原始请求：给定 host + 完整 path（含 query），返回解压并解析后的 JSON */
function rawRequest(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'wxcloudrun-express/weather',
          'Accept-Encoding': 'gzip, deflate',
        },
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const encoding = (res.headers['content-encoding'] || '').toLowerCase();
          // 优先按响应头判断，否则按字节魔数兜底（防止响应头丢失导致解压失败）
          const isGzip = encoding === 'gzip' || (buffer[0] === 0x1f && buffer[1] === 0x8b);
          let body;
          try {
            if (isGzip) {
              body = zlib.gunzipSync(buffer).toString('utf8');
            } else if (encoding === 'deflate') {
              body = zlib.inflateSync(buffer).toString('utf8');
            } else {
              body = buffer.toString('utf8');
            }
          } catch (e) {
            return reject(new Error('解压和风天气返回失败：' + e.message));
          }
          if (!body) {
            return reject(new Error('和风天气返回为空（HTTP ' + res.statusCode + '）'));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('和风天气返回解析失败：' + body.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('和风天气请求超时')));
    req.end();
  });
}

/** 和风天气成功响应的最外层 code 为字符串 "200" */
function isSuccess(data) {
  if (!data || typeof data !== 'object') return false;
  return String(data.code) === '200';
}

/** 候选 Host 列表（单一数组即可，和风 path 自身已带 /v7 /geo/v2 等前缀） */
function buildTargets() {
  const custom = (process.env.QWEATHER_HOST || '').trim();
  const list = [];
  if (PROJECT_HOST) list.push(PROJECT_HOST);
  if (custom && custom !== PROJECT_HOST) list.push(custom);
  list.push('api.qweather.com');
  list.push('devapi.qweather.com');
  list.push('geoapi.qweather.com');
  return list;
}
const ALL_TARGETS = buildTargets();

function withKey(queryPath) {
  const key = getKey();
  if (!key) {
    throw new Error('服务端未配置 QWEATHER_KEY，请在云托管环境变量中设置');
  }
  const sep = queryPath.includes('?') ? '&' : '?';
  return `${queryPath}${sep}key=${encodeURIComponent(key)}`;
}

/**
 * 通用请求：把完整 path（含 query，如 /v7/weather/now?location=...）转发到候选 Host，
 * 返回第一个 code:200 的和风原始 JSON；全部失败抛出带诊断信息的 Error。
 */
async function requestFirstSuccess(fullPath) {
  const tried = [];
  let last = null;
  for (const host of ALL_TARGETS) {
    try {
      const data = await rawRequest(host, withKey(fullPath));
      const tag =
        data && data.code
          ? 'code:' + data.code
          : data && data.error
          ? 'ERR' + data.error.status + ' ' + (data.error.title || '')
          : '?';
      tried.push(`${host} => ${tag}`);
      if (isSuccess(data)) return data;
      last = data; // 可能是 host 不匹配（Invalid Host / 403），尝试下一个
    } catch (e) {
      tried.push(`${host} => ERR:${e.message.slice(0, 80)}`);
      last = e;
    }
  }
  if (last instanceof Error) throw last;
  throw new Error('和风天气所有候选 Host 均失败 [' + tried.join(' | ') + ']');
}

// ===================== 便捷方法（供 index.js 既有 /api/weather/* 路由使用） =====================
async function getNow(location) {
  return requestFirstSuccess(`/v7/weather/now?location=${encodeURIComponent(location)}`);
}
async function get3d(location) {
  return requestFirstSuccess(`/v7/weather/3d?location=${encodeURIComponent(location)}`);
}
async function get7d(location) {
  return requestFirstSuccess(`/v7/weather/7d?location=${encodeURIComponent(location)}`);
}
async function get24h(location) {
  return requestFirstSuccess(`/v7/weather/24h?location=${encodeURIComponent(location)}`);
}
/** 城市搜索：name 既可是城市名，也可是 经度,纬度 坐标（和风 GeoAPI 均支持） */
async function cityLookup(name) {
  return requestFirstSuccess(`/geo/v2/city/lookup?location=${encodeURIComponent(name)}`);
}

module.exports = { getNow, get3d, get7d, get24h, cityLookup, requestFirstSuccess, getKey };
