// Tour dates. Bandsintown stopped serving events to public app ids (every artist answers []), so the
// engine asks Ticketmaster's Discovery API instead. The key stays here, never in a browser.
// An artist is looked up as an "attraction" first (exact name match), so tribute acts that merely
// contain the name do not show up as the artist's concerts.

export const DEFAULT_TICKETMASTER_KEY = "gCnkc6kf6EzDVbAuAH5p7qXTjOKHUYUa";
const BASE = "https://app.ticketmaster.com/discovery/v2";
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function createTour({ apiKey = DEFAULT_TICKETMASTER_KEY, fetchImpl = fetch, ttlMs = 6 * 3600_000 } = {}) {
  const cache = new Map();
  const get = async (path, params) => {
    const r = await fetchImpl(`${BASE}${path}?${new URLSearchParams({ apikey: apiKey, ...params })}`);
    if (!r.ok) throw new Error(`Ticketmaster ${r.status}`);
    return r.json();
  };
  async function load(artist) {
    const want = norm(artist);
    if (!want) return [];
    const found = await get("/attractions.json", { keyword: artist, classificationName: "music", size: "20" });
    const hit = (found._embedded?.attractions ?? []).find((a) => norm(a.name) === want);
    if (!hit) return [];
    const ev = await get("/events.json", { attractionId: hit.id, sort: "date,asc", size: "50" });
    return (ev._embedded?.events ?? []).map((e) => {
      const v = e._embedded?.venues?.[0] ?? {};
      return {
        datetime: e.dates?.start?.dateTime ?? (e.dates?.start?.localDate ? `${e.dates.start.localDate}T${e.dates.start.localTime ?? "00:00:00"}` : ""),
        url: e.url ?? "",
        venue: { name: v.name ?? "", city: v.city?.name ?? "", region: v.state?.stateCode ?? v.state?.name ?? "", country: v.country?.name ?? "" },
      };
    });
  }
  return {
    async events(artist) {
      const k = norm(artist);
      const c = cache.get(k);
      if (c && Date.now() - c.at < ttlMs) return c.events;
      const events = await load(artist);
      cache.set(k, { at: Date.now(), events });
      return events;
    },
  };
}
