export function setWindyFrame(
  iframeEl,
  linkEl,
  { lat, lon, overlay = 'snow', zoom = 8 }
) {
  const params = new URLSearchParams({
    lat,
    lon,
    detailLat: lat,
    detailLon: lon,
    zoom,
    level: 'surface',
    overlay,
  });
  iframeEl.src = `https://embed.windy.com/embed2.html?${params.toString()}`;
  linkEl.href = `https://www.windy.com/?${overlay},${lat},${lon},${zoom}`;
}
