exports.handler = async function () {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300'
  };
  try {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=02187010&parameterCd=00062&siteStatus=all';
    const res = await fetch(url, { headers: { 'User-Agent': 'HartwellBridgeClearanceApp/3.0' } });
    if (!res.ok) throw new Error(`USGS returned ${res.status}`);
    const json = await res.json();
    const series = json?.value?.timeSeries || [];
    let best = null;
    for (const ts of series) {
      const variable = ts?.variable?.variableName || '';
      const values = ts?.values?.[0]?.value || [];
      for (const v of values) {
        const level = Number(v.value);
        if (!Number.isFinite(level)) continue;
        const observed = v.dateTime;
        const item = { level, observed, variable };
        if (!best || new Date(observed) > new Date(best.observed)) best = item;
      }
    }
    if (!best) throw new Error('No reservoir elevation value found');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        level: best.level,
        observed: best.observed,
        source: 'USGS 02187010 Hartwell Lake near Anderson, SC',
        variable: best.variable,
        sourceUrl: url
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }
};
