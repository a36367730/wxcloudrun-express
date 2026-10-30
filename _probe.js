const https = require("https");
const zlib = require("zlib");

function get(u) {
  return new Promise((res, rej) => {
    https
      .get(u, { headers: { "Accept-Encoding": "gzip, deflate" } }, (r) => {
        const c = [];
        r.on("data", (d) => c.push(d));
        r.on("end", () => {
          const b = Buffer.concat(c);
          const enc = (r.headers["content-encoding"] || "").toLowerCase();
          let s;
          try {
            s =
              enc === "gzip"
                ? zlib.gunzipSync(b).toString()
                : enc === "deflate"
                ? zlib.inflateSync(b).toString()
                : b.toString();
          } catch (e) {
            s = "(解压失败 raw=" + b.slice(0, 50);
          }
          res({ status: r.statusCode, body: s });
        });
      })
      .on("error", rej);
  });
}

(async () => {
  const a = await get(
    "https://kb7p45c2pa.re.qweatherapi.com/v7/weather/now?location=117.96,40.95"
  );
  console.log("项目专属 Host（无key）:", a.status, a.body.slice(0, 300));
  const b = await get(
    "https://api.qweather.com/v7/weather/now?location=117.96,40.95"
  );
  console.log("api.qweather.com（无key）:", b.status, b.body.slice(0, 300));
})();
