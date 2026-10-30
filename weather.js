/**
 * 和风天气（QWeather）读取模块
 * 文档：https://dev.qweather.com/
 *
 * 设计要点：
 * - 密钥从环境变量 QWEATHER_KEY 读取，绝不写死在代码里。
 * - 免费开发版 host 为 devapi.qweather.com，GeoAPI 为 geoapi.qweather.com；
 *   如使用标准版/商业版，请设置环境变量 QWEATHER_HOST=api.qweather.com。
 * - location 参数格式：经度,纬度（如 117.30,39.88）或 LocationID（GeoAPI 返回）。
 */

const https = require('https');
const zlib = require('zlib');

const WEATHER_HOST = process.env.QWEATHER_HOST || 'devapi.qweather.com';
const GEO_HOST = process.env.QWEATHER_GEO_HOST || 'geoapi.qweather.com';

function getKey() {
  return (process.env.QWEATHER_KEY || '').trim();
}

/**
 * 通用 GET 请求和风天气 API，返回解析后的 JSON。
 */
function qweatherRequest(host, path) {
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

function withKey(path) {
  const key = getKey();
  if (!key) {
    throw new Error('服务端未配置 QWEATHER_KEY，请在云托管环境变量中设置');
  }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}key=${encodeURIComponent(key)}`;
}

/** 实时天气 */
async function getNow(location) {
  const path = withKey(`/v7/weather/now?location=${encodeURIComponent(location)}`);
  return qweatherRequest(WEATHER_HOST, path);
}

/** 3 天预报 */
async function get3d(location) {
  const path = withKey(`/v7/weather/3d?location=${encodeURIComponent(location)}`);
  return qweatherRequest(WEATHER_HOST, path);
}

/** 7 天预报 */
async function get7d(location) {
  const path = withKey(`/v7/weather/7d?location=${encodeURIComponent(location)}`);
  return qweatherRequest(WEATHER_HOST, path);
}

/** 逐小时（24h） */
async function get24h(location) {
  const path = withKey(`/v7/weather/24h?location=${encodeURIComponent(location)}`);
  return qweatherRequest(WEATHER_HOST, path);
}

/** 城市搜索：根据名称查 LocationID / 经纬度 */
async function cityLookup(name) {
  const path = withKey(`/v2/city/lookup?location=${encodeURIComponent(name)}`);
  return qweatherRequest(GEO_HOST, path);
}

module.exports = { getNow, get3d, get7d, get24h, cityLookup };
