/**
 * 和风天气（QWeather）读取模块
 * 文档：https://dev.qweather.com/
 *
 * 设计要点：
 * - 密钥从环境变量 QWEATHER_KEY 读取，绝不写死在代码里。
 * - 兼容多种 API Host（新版标准/免费订阅 api.qweather.com、旧版开发版 devapi.qweather.com、
 *   以及通过环境变量 QWEATHER_HOST / QWEATHER_GEO_HOST 指定的专属 Host）。
 * - 自动按候选 Host 顺序重试，命中第一个返回 code:200 的即返回，省去手动配置 Host。
 * - location 参数格式：经度,纬度（如 117.30,39.88）或 LocationID（GeoAPI 返回）。
 */

const https = require('https');
const zlib = require('zlib');

function getKey() {
  return (process.env.QWEATHER_KEY || '').trim();
}

// 默认项目专属 Host（和风「开发者信息」页的 API Host，无需再配环境变量即可生效；
// 仍可用 QWEATHER_HOST / QWEATHER_GEO_HOST 环境变量覆盖）。
const PROJECT_HOST = 'kb7p45c2pa.re.qweatherapi.com';

/** 原始请求：给定 host + 完整 path，返回解压并解析后的 JSON */
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

/**
 * 按候选 (host, path前缀) 顺序请求，返回第一个成功（code:200）的结果。
 * 全部失败时抛出最后一个错误。
 */
async function requestFirstSuccess(targets, pathFor) {
  let last = null;
  for (const t of targets) {
    try {
      const data = await rawRequest(t.host, withKey(`${t.prefix}${pathFor}`));
      if (isSuccess(data)) return data;
      last = data; // 可能是 host 不匹配（Invalid Host / 403），尝试下一个
    } catch (e) {
      last = e;
    }
  }
  if (last instanceof Error) throw last;
  throw new Error('和风天气所有候选 Host 均失败：' + JSON.stringify(last).slice(0, 200));
}

function withKey(queryPath) {
  const key = getKey();
  if (!key) {
    throw new Error('服务端未配置 QWEATHER_KEY，请在云托管环境变量中设置');
  }
  const sep = queryPath.includes('?') ? '&' : '?';
  return `${queryPath}${sep}key=${encodeURIComponent(key)}`;
}

// 天气/常规 API 候选 Host（顺序：默认项目专属 -> 自定义 -> 新版标准 -> 旧版开发版）
const WEATHER_TARGETS = (() => {
  const custom = (process.env.QWEATHER_HOST || '').trim();
  const list = [];
  if (PROJECT_HOST) list.push({ host: PROJECT_HOST, prefix: '/v7' });
  if (custom && custom !== PROJECT_HOST) list.push({ host: custom, prefix: '/v7' });
  list.push({ host: 'api.qweather.com', prefix: '/v7' });
  list.push({ host: 'devapi.qweather.com', prefix: '/v7' });
  return list;
})();

// GeoAPI 候选 Host（顺序：默认项目专属(两种前缀都试) -> 自定义 Geo Host -> 通用自定义 Host -> 新版 /geo/v2 -> 旧版 /v2）
const GEO_TARGETS = (() => {
  const custom = (process.env.QWEATHER_GEO_HOST || '').trim();
  const customMain = (process.env.QWEATHER_HOST || '').trim();
  const list = [];
  if (PROJECT_HOST) {
    // 项目专属 Host 同时承载天气与 GeoAPI，路径前缀两种都试
    list.push({ host: PROJECT_HOST, prefix: '/geo/v2' });
    list.push({ host: PROJECT_HOST, prefix: '/v2' });
  }
  if (custom) list.push({ host: custom, prefix: '/v2' });
  if (customMain && customMain !== PROJECT_HOST) {
    list.push({ host: customMain, prefix: '/geo/v2' });
    list.push({ host: customMain, prefix: '/v2' });
  }
  list.push({ host: 'api.qweather.com', prefix: '/geo/v2' });
  list.push({ host: 'geoapi.qweather.com', prefix: '/v2' });
  return list;
})();

/** 实时天气 */
async function getNow(location) {
  return requestFirstSuccess(WEATHER_TARGETS, `/weather/now?location=${encodeURIComponent(location)}`);
}

/** 3 天预报 */
async function get3d(location) {
  return requestFirstSuccess(WEATHER_TARGETS, `/weather/3d?location=${encodeURIComponent(location)}`);
}

/** 7 天预报 */
async function get7d(location) {
  return requestFirstSuccess(WEATHER_TARGETS, `/weather/7d?location=${encodeURIComponent(location)}`);
}

/** 逐小时（24h） */
async function get24h(location) {
  return requestFirstSuccess(WEATHER_TARGETS, `/weather/24h?location=${encodeURIComponent(location)}`);
}

/** 城市搜索：根据名称查 LocationID / 经纬度 */
async function cityLookup(name) {
  return requestFirstSuccess(GEO_TARGETS, `/city/lookup?location=${encodeURIComponent(name)}`);
}

module.exports = { getNow, get3d, get7d, get24h, cityLookup };
