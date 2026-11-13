export function buildWindyUrls({ lat, lon, overlay = 'snow', zoom = 8 }) {
  const params = new URLSearchParams({
    lat,
    lon,
    detailLat: lat,
    detailLon: lon,
    zoom,
    level: 'surface',
    overlay,
  });
  return {
    src: `https://embed.windy.com/embed2.html?${params.toString()}`,
    href: `https://www.windy.com/?${overlay},${lat},${lon},${zoom}`,
  };
}

export function setWindyFrame(iframeEl, linkEl, opts) {
  const { src, href } = buildWindyUrls(opts);
  iframeEl.src = src;
  linkEl.href = href;
}
