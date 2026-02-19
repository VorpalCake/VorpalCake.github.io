(() => {
  // #region DOM
  const bankEl = document.getElementById("bank");
  const bankModeLabel = document.getElementById("bankModeLabel");
  const tierLists = [...document.querySelectorAll(".tier .list")];
  const allLists = [bankEl, ...tierLists];
  const tooltip = document.getElementById("tooltip");
  const tabItems = document.getElementById("tabItems");
  const tabPowers = document.getElementById("tabPowers");
  const resetBtn = document.getElementById("resetBtn");
  const toastRoot = document.getElementById("toast-root");
  // #endregion

  // #region Constants / State
  const TIERS = ["S", "A", "B", "C", "D"];
  const MODES = ["items", "powers"];
  const STORAGE_KEY = "tierlist_state_v1";
  const HERO_FILTER_STORAGE_KEY = "hero_filter_v1";

  const SCROLL_DIST = 128;
  const SCROLL_MAX_SPEED = 8;
  const SCROLL_ACCEL = 1.0;

  const ROLE_ORDER = ["Tank", "Damage", "Support"];

  let mode = "items"; // 'items' | 'powers'
  let ICONS = {};
  let BY_ID = {};
  let idsByMode = { items: [], powers: [] };
  let orderedIds = { items: [], powers: [] };

  let universalEnabledByMode = { items: true, powers: true };
  let heroFilterByMode = { items: {}, powers: {} };
  let currentHoverHero = null;

  function getCurrentHeroFilter() {
    return heroFilterByMode[mode] || {};
  }
  function getCurrentUniversalEnabled() {
    return !!universalEnabledByMode[mode];
  }

  let TEXTURE_MAP = new Map();

  let stateByMode = {
    items: emptyState(),
    powers: emptyState(),
  };
  // #endregion

  // #region Utils
  function emptyState() {
    return { S: [], A: [], B: [], C: [], D: [] };
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(
      /[&<>"]/g,
      (s) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        })[s],
    );
  }

  function safeName(name) {
    return String(name || "").trim();
  }

  function decodeHtmlEntities(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(str ?? "");
    return textarea.value;
  }

  function imgIcon(path, alt = "", size = 16) {
    const safe = escapeHtml(path || "");
    const a = escapeHtml(alt || "");
    return `<img src="${safe}" alt="${a}" width="${size}" height="${size}" class="img-icon" />`;
  }

  const Rank = {
    role(role) {
      const r = String(role || "").toLowerCase();
      if (r === "tank") return 0;
      if (r === "damage") return 1;
      if (r === "support") return 2;
      return 99;
    },
    category(cat) {
      const c = String(cat || "").toLowerCase();
      if (c === "weapon") return 0;
      if (c === "ability") return 1;
      if (c === "survival") return 2;
      if (c === "gadget") return 3;
      return 99;
    },
    rarity(r) {
      const v = String(r || "").toLowerCase();
      if (v === "common") return 0;
      if (v === "rare") return 1;
      if (v === "epic") return 2;
      return 99;
    },
  };

  const Base64Url = {
    encode(bytes) {
      let str = "";
      for (let i = 0; i < bytes.length; i++)
        str += String.fromCharCode(bytes[i]);
      const b64 = btoa(str);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    },
    decode(b64url) {
      const b64 = b64url
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
      const str = atob(b64);
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
      return bytes;
    },
  };

  const Gzip = {
    async compress(str) {
      if ("CompressionStream" in window) {
        const enc = new TextEncoder();
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        writer.write(enc.encode(str));
        writer.close();
        const compressed = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(compressed);
      }
      return new TextEncoder().encode(str);
    },
    async decompress(bytes) {
      if ("DecompressionStream" in window) {
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const decompressed = await new Response(ds.readable).text();
        return decompressed;
      }
      return new TextDecoder().decode(bytes);
    },
  };

  function hexToRgba(hex8) {
    const h = String(hex8 || "").trim();
    if (!/^[0-9a-fA-F]{8}$/.test(h)) return null;

    const a = parseInt(h.slice(0, 2), 16) / 255;
    const r = parseInt(h.slice(2, 4), 16);
    const g = parseInt(h.slice(4, 6), 16);
    const b = parseInt(h.slice(6, 8), 16);
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }

  function renderFormatted(text) {
    if (!text) return "";
    let html = decodeHtmlEntities(String(text));
    html = html.replace(/%%/, "%");

    // <fg#AARRGGBB>...</fg>
    html = html.replace(/<fg#([0-9a-fA-F]{8})>/g, (_, hex) => {
      const color = hexToRgba(hex) || "inherit";
      return `<span style="color:${color};font-weight:600">`;
    });
    html = html.replace(/<\/fg>/g, "</span>");

    // <tx ...> texture tags
    html = html.replace(/<tx[^>]*>/g, (m) => {
      const src = TEXTURE_MAP.get(m);
      if (src)
        return `<img src="${escapeHtml(String(src))}" alt="" class="tx-icon" />`;
      console.warn(`Missing icon for texture: ${m}`);
      return "";
    });

    html = html.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
    return html;
  }
  // #endregion

  // #region Sorting helpers
  function makeHeroRoleLookup(roles) {
    const heroToGroup = new Map();
    const roleNames = Object.keys(roles || {}).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const role of roleNames) {
      for (const heroName of roles[role] || []) {
        heroToGroup.set(safeName(heroName), role);
      }
    }
    return { heroToGroup, roleNames };
  }

  function rankAbilities(heroName, ability, abilitiesMap) {
    const h = safeName(heroName);
    const a = safeName(ability);
    if (!a) return h === "Pharah" ? 9999 : -1;

    const arr = abilitiesMap.get(h) || [];
    const idx = arr.findIndex((x) => x.toLowerCase() === a.toLowerCase());
    if (idx === -1) return heroName === "Pharah" ? 9999 : arr.length + 1;
    return idx;
  }

  function sortItems(items, roles) {
    const { heroToGroup } = makeHeroRoleLookup(roles || {});
    return [...items].sort((a, b) => {
      const aHero = safeName(a.hero?.name);
      const bHero = safeName(b.hero?.name);

      const aIsUniversal = !aHero;
      const bIsUniversal = !bHero;
      if (aIsUniversal !== bIsUniversal) return aIsUniversal ? -1 : 1;

      const aGR = Rank.role(heroToGroup.get(aHero));
      const bGR = Rank.role(heroToGroup.get(bHero));
      if (aGR !== bGR) return aGR - bGR;

      const hn = aHero.localeCompare(bHero);
      if (hn !== 0) return hn;

      const aCat = Rank.category(a.category);
      const bCat = Rank.category(b.category);
      if (aCat !== bCat) return aCat - bCat;

      const aR = Rank.rarity(a.rarity);
      const bR = Rank.rarity(b.rarity);
      if (aR !== bR) return aR - bR;

      if (a.cost !== b.cost) return a.cost - b.cost;

      return a.name.localeCompare(b.name);
    });
  }

  function sortPowers(powers, roles, abilitiesMap) {
    const desiredOrder = ROLE_ORDER;
    const groupRank = new Map(desiredOrder.map((r, i) => [r.toLowerCase(), i]));
    const { heroToGroup } = makeHeroRoleLookup(roles || {});

    return [...powers].sort((a, b) => {
      const aHero = safeName(a.hero?.name);
      const bHero = safeName(b.hero?.name);

      const aGroup = (heroToGroup.get(aHero) || "~").toLowerCase();
      const bGroup = (heroToGroup.get(bHero) || "~").toLowerCase();

      const aGR = groupRank.has(aGroup) ? groupRank.get(aGroup) : 999;
      const bGR = groupRank.has(bGroup) ? groupRank.get(bGroup) : 999;
      if (aGR !== bGR) return aGR - bGR;

      const hn = aHero.localeCompare(bHero);
      if (hn !== 0) return hn;

      const aRank = rankAbilities(aHero, a.ability, abilitiesMap);
      const bRank = rankAbilities(bHero, b.ability, abilitiesMap);
      if (aRank !== bRank) return aRank - bRank;

      return a.name.localeCompare(b.name);
    });
  }
  // #endregion

  // #region Data parsing
  function buildVarSpecIndex(itemData) {
    const map = new Map();
    for (const spec of Array.isArray(itemData) ? itemData : []) {
      const name = safeName(spec?.Name);
      if (!name) continue;
      const hero = safeName(spec?.Hero);
      const key = hero ? `${name}@@${hero}` : name;
      map.set(key, spec);
    }
    return map;
  }

  function resolveIconImages(baseNameFromGame, rarity, spec) {
    const paths = {
      base: `data/Talents/${encodeURIComponent(baseNameFromGame.replace(/\#|\?/, ""))}.0.png`,
      border: `data/VectorImages/${encodeURIComponent(rarity)}.svg`,
      mask: `data/VectorImages/${encodeURIComponent(rarity)}Mask.svg`,
    };
    if (!spec?.Icon) return paths;

    if (typeof spec.Icon === "string") {
      const s = String(spec.Icon).trim();
      if (!s) return paths;
      const looksLikePath = s.includes("/") || s.endsWith(".png");
      const base = looksLikePath
        ? s
        : `data/Talents/${encodeURIComponent(s)}.0.png`;
      return { base, border: paths.border, mask: paths.mask };
    }

    return paths;
  }

  function buildTooltip(spec, resolvedDesc) {
    const parts = [];
    const rows = Array.isArray(spec?.Stats) ? spec.Stats : [];
    const vars = spec?.vars;

    const resolveAmount = (s) => {
      if (typeof s?.amount === "number" || typeof s?.amount === "string") {
        let a = String(s.amount);
        if (Array.isArray(vars)) {
          a = a.replace(/\$(\d+)/g, (_, d) => {
            const v = vars[Number(d) - 1];
            return v !== undefined && v !== null ? String(v) : _;
          });
        }
        if (vars && !Array.isArray(vars) && typeof vars === "object") {
          a = a.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
            const v = vars[key];
            return v !== undefined && v !== null ? String(v) : _;
          });
        }
        return a;
      }
      if (typeof s?.amountVar === "number" && Array.isArray(vars)) {
        const v = vars[s.amountVar - 1];
        if (v !== undefined && v !== null) return String(v);
      }
      return "";
    };

    if (rows.length === 0 && resolvedDesc) {
      parts.push({ type: "desc", body: resolvedDesc });
      return parts;
    }

    for (const r of rows) {
      if (typeof r === "string" && r.toLowerCase() === "description") {
        if (resolvedDesc) parts.push({ type: "desc", body: resolvedDesc });
        continue;
      }
      if (r && typeof r === "object") {
        const key = String(r.key || "default");
        const label = String(r.label ?? "");
        const amount = resolveAmount(r);
        if (!label && !amount) continue;
        parts.push({ type: "stat", key, label, amount });
      }
    }

    if (
      !rows.some(
        (x) => typeof x === "string" && x.toLowerCase() === "description",
      ) &&
      resolvedDesc
    ) {
      parts.push({ type: "desc", body: resolvedDesc });
    }

    return parts;
  }

  function parseTalents(talentsObject, varSpecMap) {
    const items = [];
    const powers = [];

    for (const [id, raw] of Object.entries(talentsObject || {})) {
      if (!raw?.Rarity) continue;

      const rarity = raw?.Rarity?.Value;
      const type = rarity == "Legendary" ? "Power" : "Item";

      const rawName = raw?.Name;
      const name = safeName(rawName);
      if (!name) continue;

      const category = safeName(raw?.Category?.Value);
      const cost = Number(raw?.Cost || 0);

      const heroName = safeName(raw?.Hero?.Value);
      const heroMeta = heroName
        ? {
            name: heroName,
            icon: `data/HeroIcons/${encodeURIComponent(heroName.replace(":", "_"))}/${encodeURIComponent(heroName.replace(":", "_"))}.png`,
          }
        : null;

      const spec =
        varSpecMap.get(`${safeName(name)}@@${safeName(heroName)}`) ||
        varSpecMap.get(safeName(name));

      let resolvedDesc = String(raw?.Description);
      if (Array.isArray(spec?.vars)) {
        resolvedDesc = resolvedDesc.replace(/%(\d+)\$[sd]/g, (match, idx) => {
          const value = spec.vars[idx - 1];
          return value != null ? String(value) : match;
        });
      }

      const tooltip = buildTooltip(spec, resolvedDesc);
      const img = resolveIconImages(rawName, rarity, spec);

      const entry = {
        id,
        name,
        category,
        rarity,
        img,
        cost,
        hero: heroMeta,
        tooltip,
        ability: safeName(raw?.Loadout?.Name),
        cooldown: spec?.Cooldown,
      };

      if (type === "Item") items.push(entry);
      else powers.push(entry);
    }

    console.log("parseGameTalents:", {
      total: Object.keys(talentsObject || {}).length,
      items: items.length,
      powers: powers.length,
    });

    return { items, powers };
  }
  // #endregion

  // #region Filter helpers
  function heroIconPath(heroName) {
    const safe = safeName(heroName).replace(":", "_");
    return `data/HeroIcons/${encodeURIComponent(safe)}/${encodeURIComponent(safe)}.png`;
  }

  function loadHeroFilter(rolesObj) {
    heroFilterByMode = { items: {}, powers: {} };
    universalEnabledByMode = { items: true, powers: true };

    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(HERO_FILTER_STORAGE_KEY));
    } catch {}

    const roles = rolesObj || {};

    const initBucket = (bucketKey) => {
      const savedBucket = saved?.[bucketKey];
      const filter = {};
      for (const role of Object.keys(roles)) {
        for (const h of roles[role] || []) {
          const name = safeName(h);
          const savedVal =
            savedBucket && typeof savedBucket.heroes?.[name] === "boolean"
              ? savedBucket.heroes[name]
              : true;
          filter[name] = savedVal;
        }
      }
      heroFilterByMode[bucketKey] = filter;
      universalEnabledByMode[bucketKey] =
        typeof savedBucket?.universal === "boolean"
          ? savedBucket.universal
          : true;
    };

    initBucket("items");
    initBucket("powers");
  }

  function saveHeroFilter() {
    try {
      const payload = {
        items: {
          heroes: heroFilterByMode.items,
          universal: universalEnabledByMode.items,
        },
        powers: {
          heroes: heroFilterByMode.powers,
          universal: universalEnabledByMode.powers,
        },
      };
      localStorage.setItem(HERO_FILTER_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function resetFiltersToDefaults(rolesObj) {
    const roles = rolesObj || rolesByGroup || {};
    const bucketKey = mode; // 'items' or 'powers'
    const next = {};
    for (const role of Object.keys(roles)) {
      for (const h of roles[role] || []) {
        next[safeName(h)] = true;
      }
    }
    heroFilterByMode[bucketKey] = next;
    universalEnabledByMode[bucketKey] = true;

    saveHeroFilter();
    clearHeroHover();
    buildHeroFilterUI(rolesByGroup);
    renderFromState();
  }

  function isHeroEnabled(name) {
    if (!name) return getCurrentUniversalEnabled();
    const key = safeName(name);
    const cur = getCurrentHeroFilter();
    return cur[key] !== false;
  }

  function isItemEnabled(item) {
    const heroName = safeName(item?.hero?.name);
    return isHeroEnabled(heroName);
  }

  function areAllFiltersOn() {
    const cur = getCurrentHeroFilter();
    const allHeroesOn = Object.values(cur).every(Boolean);
    return allHeroesOn && getCurrentUniversalEnabled() === true;
  }

  function setAllFilters(nextOn) {
    const cur = getCurrentHeroFilter();
    for (const k of Object.keys(cur)) cur[k] = !!nextOn;
    universalEnabledByMode[mode] = !!nextOn;
    saveHeroFilter();
  }

  function setRoleFilters(role, on) {
    const cur = getCurrentHeroFilter();
    const heroes = (rolesByGroup?.[role] || []).map(safeName);
    for (const h of heroes) cur[h] = !!on;
    saveHeroFilter();
  }

  function getRoleTriState(role) {
    const cur = getCurrentHeroFilter();
    const heroes = (rolesByGroup?.[role] || []).map(safeName);
    if (!heroes.length) return "none";
    let on = 0;
    for (const h of heroes) if (cur[h] !== false) on++;
    if (on === 0) return "none";
    if (on === heroes.length) return "all";
    return "mixed";
  }

  function clearHeroHover() {
    currentHoverHero = null;
    document
      .querySelectorAll(".item.is-dim")
      .forEach((el) => el.classList.remove("is-dim"));
  }

  function applyHeroHover(name) {
    currentHoverHero = safeName(name || "");
    document
      .querySelectorAll(".item.is-dim")
      .forEach((el) => el.classList.remove("is-dim"));
    let keepSelector;
    if (currentHoverHero === "") {
      keepSelector = '.item:not([data-hero]), .item[data-hero=""]';
    } else {
      keepSelector = `.item[data-hero="${CSS.escape(currentHoverHero)}"]`;
    }
    const allItems = Array.from(document.querySelectorAll(".item"));
    const keep = new Set(Array.from(document.querySelectorAll(keepSelector)));
    for (const el of allItems) {
      if (!keep.has(el)) el.classList.add("is-dim");
    }
  }

  function reapplyHeroHoverIfAny() {
    if (currentHoverHero !== null) applyHeroHover(currentHoverHero);
  }
  // #endregion

  // #region Data loading
  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) {
      console.error(`Failed to fetch ${path}:`, res.status, res.statusText);
      return null;
    }
    return res.json();
  }

  async function loadData() {
    ICONS = new Proxy(
      {},
      {
        get(_, key) {
          return `data/VectorImages/${key}.svg`;
        },
      },
    );

    const talents = await fetchJson("data/list-talents.json");
    const varJson = await fetchJson("data/vars.json");

    const { items: itemData, roles, abilities, textures } = varJson || {};
    rolesByGroup = roles || {};

    const abilitiesMap = new Map();
    if (abilities && typeof abilities === "object") {
      for (const [hero, list] of Object.entries(abilities)) {
        if (!Array.isArray(list)) continue;
        abilitiesMap.set(safeName(hero), list.map(safeName).filter(Boolean));
      }
    }

    TEXTURE_MAP = new Map();
    if (textures && typeof textures === "object") {
      for (const [k, v] of Object.entries(textures)) {
        const decodedKey = decodeHtmlEntities(String(k));
        TEXTURE_MAP.set(decodedKey, v);
      }
    }

    const varSpecMap = buildVarSpecIndex(itemData);
    const { items, powers } = parseTalents(talents || {}, varSpecMap);

    const sortedItems = sortItems(items, roles);
    const sortedPowers = sortPowers(powers, roles, abilitiesMap);

    idsByMode.items = items.map((it) => it.id);
    idsByMode.powers = powers.map((p) => p.id);

    orderedIds.items = sortedItems.map((it) => it.id);
    orderedIds.powers = sortedPowers.map((p) => p.id);

    BY_ID = Object.fromEntries([...items, ...powers].map((x) => [x.id, x]));
  }
  // #endregion

  // #region State management
  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const savedMode = parsed?.mode;
      const savedStates = parsed?.stateByMode;

      if (MODES.includes(savedMode)) mode = savedMode;

      if (savedStates?.items)
        stateByMode.items = fixStateShape(savedStates.items);
      if (savedStates?.powers)
        stateByMode.powers = fixStateShape(savedStates.powers);
    } catch (err) {
      console.warn("Failed to load persisted state:", err);
    }
  }

  function saveLocalState() {
    try {
      const payload = { mode, stateByMode };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to save state:", err);
    }
  }

  function fixStateShape(st) {
    const out = emptyState();
    for (const t of TIERS) out[t] = Array.isArray(st?.[t]) ? st[t] : [];
    return out;
  }

  function sanitizeStates() {
    const itemsAllowed = new Set(idsByMode.items);
    const powersAllowed = new Set(idsByMode.powers);
    const sanitize = (st, allowed) => {
      for (const t of TIERS)
        st[t] = (st[t] || []).filter((id) => allowed.has(id));
    };
    sanitize(stateByMode.items, itemsAllowed);
    sanitize(stateByMode.powers, powersAllowed);
  }

  function buildSharePayload(mode, stateByMode) {
    const prune = (st) => {
      const out = {};
      for (const t of TIERS) {
        if (Array.isArray(st[t]) && st[t].length) out[t] = st[t];
      }
      return out;
    };
    const payload = { m: mode };
    const i = prune(stateByMode.items);
    const p = prune(stateByMode.powers);
    if (Object.keys(i).length) payload.i = i;
    if (Object.keys(p).length) payload.p = p;
    return payload;
  }

  function applySharePayload(payload) {
    const nextMode =
      (payload && (payload.m === "powers" ? "powers" : "items")) || "items";
    const fix = (obj) => {
      const out = emptyState();
      if (!obj || typeof obj !== "object") return out;
      for (const t of TIERS) out[t] = Array.isArray(obj[t]) ? obj[t] : [];
      return out;
    };
    return {
      mode: nextMode,
      items: fix(payload?.i),
      powers: fix(payload?.p),
    };
  }

  async function createShareUrl() {
    const payload = buildSharePayload(mode, stateByMode);
    const json = JSON.stringify(payload);
    const compressed = await Gzip.compress(json);
    const b64url = Base64Url.encode(compressed);

    const url = new URL(location.href);
    url.hash = `s=${b64url}`;
    return url.toString();
  }

  async function tryLoadFromHash() {
    const hash = location.hash || "";
    const m = hash.match(/[#&?]s=([A-Za-z0-9\-_]+)/);
    if (!m) return false;

    try {
      const bytes = Base64Url.decode(m[1]);
      const json = await Gzip.decompress(bytes);
      const payload = JSON.parse(json);
      const restored = applySharePayload(payload);

      mode = restored.mode;
      stateByMode.items = restored.items;
      stateByMode.powers = restored.powers;

      sanitizeStates();
      renderFromState();
      saveLocalState();
      return true;
    } catch (err) {
      console.warn("Failed to parse state from URL:", err);
      return false;
    }
  }

  async function updateUrlFragment() {
    const shareUrl = await createShareUrl();
    history.replaceState(null, "", shareUrl);
  }

  async function shortenWithIsGd(longUrl) {
    const api = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`;
    const res = await fetch(api, { method: "GET" });
    if (!res.ok) throw new Error("is.gd failed");
    const shortUrl = await res.text();
    if (!/^https?:\/\//i.test(shortUrl))
      throw new Error("is.gd error: " + shortUrl);
    return shortUrl.trim();
  }
  // #endregion

  // #region Tooltips
  function showTooltip(e) {
    if (draggingEl) return;
    const id = e.currentTarget.dataset.id;
    const item = BY_ID[id];
    if (!item) return;

    tooltip.innerHTML = "";
    tooltip.appendChild(makeTipHeader(item));
    tooltip.appendChild(makeSep());

    const parts = Array.isArray(item.tooltip) ? item.tooltip : [];
    let statsUl = null;
    const flushStats = () => {
      if (statsUl && statsUl.childElementCount > 0)
        tooltip.appendChild(statsUl);
      statsUl = null;
    };

    for (const piece of parts) {
      if (!piece || !piece.type) continue;
      if (piece.type === "stat") {
        if (!statsUl) {
          statsUl = document.createElement("ul");
          statsUl.className = "stats";
        }
        statsUl.appendChild(makeStatRow(piece));
      } else if (piece.type === "desc") {
        flushStats();
        const d = document.createElement("div");
        d.className = "desc";
        d.innerHTML = renderFormatted(piece.body || "");
        tooltip.appendChild(d);
      } else {
        flushStats();
      }
    }
    flushStats();

    if (mode === "items") {
      tooltip.appendChild(makeSep());
      tooltip.appendChild(buildCost(item));
    }

    tooltip.classList.add("is-visible");
    tooltip.setAttribute("aria-hidden", "false");
    moveTooltip(e);
  }

  function makeTipHeader(item) {
    const header = document.createElement("div");
    header.className = "tip-header";

    const left = document.createElement("div");
    left.className = "tip-title";

    const titleRow = document.createElement("div");
    titleRow.className = "tip-title-row";

    if (item.hero && mode === "powers") {
      if (item.hero.icon) {
        const heroLeftWrap = document.createElement("div");
        heroLeftWrap.className = "tip-hero-avatar-left";
        const heroLeftImg = document.createElement("img");
        heroLeftImg.src = item.hero.icon;
        heroLeftImg.alt = item.hero.name || "Hero";
        heroLeftImg.width = 20;
        heroLeftImg.height = 20;
        heroLeftImg.loading = "lazy";
        heroLeftWrap.appendChild(heroLeftImg);
        titleRow.appendChild(heroLeftWrap);
      } else {
        console.warn(`${item.name} is missing a hero.icon`);
      }
    }

    const nameEl = document.createElement("div");
    nameEl.className = "tip-name";
    nameEl.textContent = item.name || "";
    titleRow.appendChild(nameEl);

    left.appendChild(titleRow);

    if (item.hero && typeof mode !== "undefined" && mode === "items") {
      const sub = document.createElement("div");
      sub.className = "tip-subtitle";
      sub.textContent = "HERO ITEM";
      left.appendChild(sub);
    } else if (item.category === "Gadget") {
      const sub = document.createElement("div");
      sub.className = "tip-subtitle";
      sub.textContent = "GADGET";
      left.appendChild(sub);
    }

    const right = document.createElement("div");
    right.className = "tip-right";

    let rightWidgetAdded = false;

    if (!rightWidgetAdded && item.hero && mode === "items") {
      const heroBox = document.createElement("div");
      heroBox.className = "tip-hero-boxed";
      if (item.hero.icon) {
        const img = document.createElement("img");
        img.src = item.hero.icon;
        img.alt = item.hero.name || "Hero";
        img.width = 20;
        img.height = 20;
        img.loading = "lazy";
        heroBox.appendChild(img);
      } else {
        console.warn(`${item.name} is missing a hero.icon`);
      }
      right.appendChild(heroBox);
      rightWidgetAdded = true;
    }

    if (!rightWidgetAdded && item.hero && mode === "powers") {
      const abilityIconPath = (() => {
        if (!item.ability) return null;
        switch (item.ability) {
          case "The Best Defense...":
            return `data/HeroIcons/Doomfist/Abilities/The Best Defense.png`;
          case "B.O.B.":
            return `data/HeroIcons/Ashe/Abilities/B.O.B.png`;
          case "Shuriken":
            return `data/HeroIcons/Genji/Abilities/Fan of Blades.png`;
          case "Rivet Gun":
            return `data/HeroIcons/Torbjörn/Abilities/Rivet Gun - Alt Fire.png`;
          case "Quick Melee":
            return `data/VectorImages/Quick Melee.svg`;
          default:
            return `data/HeroIcons/${item.hero.name.replace(":", "_")}/Abilities/${item.ability}.png`;
        }
      })();

      if (abilityIconPath) {
        const abilityImg = document.createElement("img");
        abilityImg.className = "tip-ability-icon";
        abilityImg.src = abilityIconPath;
        abilityImg.alt =
          item.ability ||
          (item.hero && (item.hero.ability || item.hero.abilityKey)) ||
          "Ability";
        abilityImg.width = 20;
        abilityImg.height = 20;
        abilityImg.loading = "lazy";
        right.appendChild(abilityImg);
        rightWidgetAdded = true;
      }
    }

    if (!rightWidgetAdded && item.cooldown) {
      const wrap = document.createElement("div");
      wrap.className = "tip-cd";

      const icon = document.createElement("span");
      icon.className = "icon";
      icon.innerHTML = imgIcon(ICONS["cooldown"], "Cooldown");

      const val = document.createElement("span");
      val.textContent = String(item.cooldown).toUpperCase
        ? `${item.cooldown}S`
        : item.cooldown + "S";

      wrap.appendChild(icon);
      wrap.appendChild(val);
      right.appendChild(wrap);
      rightWidgetAdded = true;
    }

    header.appendChild(left);
    header.appendChild(right);
    return header;
  }

  function buildCost(item) {
    const cost = document.createElement("div");
    cost.className = "cost";
    const iconWrap = document.createElement("span");
    iconWrap.className = "icon";
    iconWrap.innerHTML = imgIcon("data/VectorImages/Cash.webp", "Cost", 12);
    const txt = document.createElement("span");
    txt.innerHTML = `<b>${escapeHtml(Number(item.cost || 0).toLocaleString(undefined))}</b>`;
    cost.appendChild(iconWrap);
    cost.appendChild(txt);
    return cost;
  }

  function makeSep() {
    const s = document.createElement("div");
    s.className = "sep";
    return s;
  }

  function makeStatRow(stat) {
    const li = document.createElement("li");
    li.className = "stat";

    const iconWrap = document.createElement("span");
    iconWrap.className = "icon";
    const key = String(stat.key || "default");
    const label = String(stat.label ?? "");
    iconWrap.innerHTML = imgIcon(ICONS[key], label || key);

    const text = document.createElement("span");
    text.className = "text";
    const amount = escapeHtml(String(stat.amount ?? ""));
    const lab = renderFormatted(label);
    text.innerHTML = `<b>${amount}</b> ${lab}`;

    li.appendChild(iconWrap);
    li.appendChild(text);
    return li;
  }

  function moveTooltip(e) {
    if (draggingEl) return;
    const padding = 12;
    const { clientX: x, clientY: y } = e;
    const rect = tooltip.getBoundingClientRect();
    let left = x + 16,
      top = y + 16;
    if (left + rect.width + padding > window.innerWidth)
      left = x - rect.width - 16;
    if (top + rect.height + padding > window.innerHeight)
      top = y - rect.height - 16;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove("is-visible");
    tooltip.setAttribute("aria-hidden", "true");
  }
  // #endregion Tooltips

  // #region Drag n drop, scroll
  let draggingEl = null;
  let dragPlaceholder = null;
  let dragOverRAF = null;

  let autoScrollRAF = null;
  let autoScrollTarget = null;
  let pointerPos = { x: 0, y: 0 };
  let dragging = false;

  function getScrollableParent(el) {
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const canY = /(auto|scroll)/.test(cs.overflowY);
      const canX = /(auto|scroll)/.test(cs.overflowX);
      if (
        (canY && cur.scrollHeight > cur.clientHeight) ||
        (canX && cur.scrollWidth > cur.clientWidth)
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return window;
  }

  function getTargetRect(target) {
    return target === window
      ? {
          top: 0,
          left: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        }
      : target.getBoundingClientRect();
  }

  function computeScrollDelta(target, pointer) {
    let dy = 0;
    const rect = getTargetRect(target);
    const relY = pointer.y - rect.top;

    if (relY < SCROLL_DIST) {
      const t = (SCROLL_DIST - relY) / SCROLL_DIST;
      dy = -Math.round(t * SCROLL_MAX_SPEED * SCROLL_ACCEL);
    } else if (relY > rect.height - SCROLL_DIST) {
      const t = (relY - (rect.height - SCROLL_DIST)) / SCROLL_DIST;
      dy = Math.round(t * SCROLL_MAX_SPEED * SCROLL_ACCEL);
    }
    return dy;
  }

  function startAutoScrollLoop() {
    if (autoScrollRAF) return;
    const tick = () => {
      autoScrollRAF = null;
      if (!dragging || !autoScrollTarget) return;

      const dy = computeScrollDelta(autoScrollTarget, pointerPos);
      if (dy) {
        if (autoScrollTarget === window)
          window.scrollBy({ top: dy, behavior: "auto" });
        else autoScrollTarget.scrollBy({ top: dy, behavior: "auto" });
      }
      autoScrollRAF = requestAnimationFrame(tick);
    };
    autoScrollRAF = requestAnimationFrame(tick);
  }

  function stopAutoScrollLoop() {
    if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
  }

  function makePlaceholder(fromEl) {
    const ph = document.createElement("div");
    ph.className = "placeholder";
    const rect = fromEl.getBoundingClientRect();
    ph.style.width = `${Math.round(rect.width)}px`;
    ph.style.height = `${Math.round(rect.height)}px`;
    return ph;
  }

  function onDragStart(e) {
    dragging = true;
    draggingEl = e.currentTarget;
    draggingEl.classList.add("is-dragging");

    dragPlaceholder = makePlaceholder(draggingEl);
    draggingEl.parentNode.insertBefore(dragPlaceholder, draggingEl.nextSibling);

    e.dataTransfer.setData("text/plain", draggingEl.dataset.id);
    e.dataTransfer.effectAllowed = "move";

    pointerPos.x = e.clientX;
    pointerPos.y = e.clientY;

    autoScrollTarget = getScrollableParent(e.target) || window;
    startAutoScrollLoop();

    hideTooltip();
  }

  function onListDragOver(e) {
    e.preventDefault();
    pointerPos.x = e.clientX;
    pointerPos.y = e.clientY;

    const list = e.currentTarget;
    list.classList.add("highlight");

    const newTarget = getScrollableParent(e.target) || window;
    if (newTarget !== autoScrollTarget) autoScrollTarget = newTarget;

    if (!dragPlaceholder) return;
    if (dragOverRAF) return;
    dragOverRAF = requestAnimationFrame(() => {
      dragOverRAF = null;
      const after = getDragAfterElement(list, e.clientX, e.clientY);
      if (after == null) list.appendChild(dragPlaceholder);
      else list.insertBefore(dragPlaceholder, after);
    });
  }

  function onListDrop(e) {
    e.preventDefault();
    dragging = false;
    stopAutoScrollLoop();
    autoScrollTarget = null;
    e.currentTarget.classList.remove("highlight");
    hideTooltip();
  }

  function onDragEnd() {
    dragging = false;
    try {
      if (dragPlaceholder && dragPlaceholder.parentNode) {
        dragPlaceholder.parentNode.replaceChild(draggingEl, dragPlaceholder);
      }
    } finally {
      if (draggingEl) draggingEl.classList.remove("is-dragging");
      draggingEl = null;
      dragPlaceholder = null;
      dragOverRAF = null;
      stopAutoScrollLoop();
      autoScrollTarget = null;

      allLists.forEach((l) => l.classList.remove("highlight"));
      hideTooltip();
      updateStateFromDom();
      saveLocalState();
      updateUrlFragment();
    }
  }

  function onListDragLeave() {
    this.classList.remove("highlight");
  }

  function getDragAfterElement(container, x, y) {
    const candidates = [
      ...container.querySelectorAll(".item:not(.is-dragging)"),
    ].filter((el) => el !== draggingEl);

    if (candidates.length === 0) return null;

    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const inSameRow = y >= r.top && y <= r.bottom;
      const isAfterHoriz = x < r.left + r.width / 2;
      const isBelow = y < r.top;

      let score;
      if (inSameRow) {
        if (!isAfterHoriz) continue;
        score = Math.abs(r.left + r.width / 2 - x);
      } else if (isBelow) {
        score = (r.top - y) * 1000 + Math.abs(r.left - x);
      } else {
        continue;
      }

      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || null;
  }
  // #endregion

  // #region Rendering
  function updateBankHeader() {
    bankModeLabel.textContent = mode === "powers" ? "Powers" : "Items";
  }

  function buildHeroFilterUI(rolesObj) {
    const container = document.getElementById("heroFilter");
    if (!container) return;
    container.innerHTML = "";

    const chips = [];

    const allChip = (() => {
      const chip = document.createElement("button");
      chip.className = "hero-chip compact";
      chip.type = "button";

      const allOn = areAllFiltersOn();
      chip.setAttribute("aria-pressed", allOn ? "true" : "false");
      chip.dataset.hero = "__ALL__";

      const pic = document.createElement("div");
      pic.className = "pic";

      const txt = document.createElement("span");
      txt.className = "pic-text";
      txt.textContent = "All";
      pic.appendChild(txt);

      chip.appendChild(pic);

      chip.addEventListener("click", () => {
        const currentlyAllOn = areAllFiltersOn();
        setAllFilters(!currentlyAllOn);
        chip.setAttribute("aria-pressed", !currentlyAllOn ? "true" : "false");
        buildHeroFilterUI(rolesObj);
        renderFromState();
        saveLocalState();
        updateUrlFragment();
      });

      chip.addEventListener("mouseenter", clearHeroHover);
      chip.addEventListener("mouseleave", clearHeroHover);
      chip.addEventListener("focus", clearHeroHover);
      chip.addEventListener("blur", clearHeroHover);
      return chip;
    })();
    chips.push(allChip);

    if (mode === "items") {
      const curUniversal = getCurrentUniversalEnabled();
      const uniChip = (() => {
        const chip = document.createElement("button");
        chip.className = "hero-chip hero-chip--icon";
        chip.type = "button";
        chip.setAttribute("aria-pressed", curUniversal ? "true" : "false");
        chip.dataset.hero = "";

        chip.setAttribute("aria-label", "Universal");
        chip.title = "Universal";

        const pic = document.createElement("div");
        pic.className = "pic";
        const img = document.createElement("img");
        img.src = "data/VectorImages/Universal.svg";
        img.alt = "";
        img.loading = "lazy";
        img.width = 28;
        img.height = 28;
        pic.appendChild(img);

        chip.appendChild(pic);

        chip.addEventListener("click", () => {
          universalEnabledByMode[mode] = !universalEnabledByMode[mode];
          chip.setAttribute("aria-pressed", universalEnabledByMode[mode]);
          saveHeroFilter();
          renderFromState();
          saveLocalState();
          updateUrlFragment();
        });

        chip.addEventListener("mouseenter", () => applyHeroHover(""));
        chip.addEventListener("mouseleave", clearHeroHover);
        chip.addEventListener("focus", () => applyHeroHover(""));
        chip.addEventListener("blur", clearHeroHover);

        return chip;
      })();
      const uniGroup = document.createElement("div");
      uniGroup.className = "role-group";
      uniGroup.appendChild(uniChip);
      chips.push(uniGroup);
    }

    const roleKeys = Object.keys(rolesObj || {}).sort((a, b) => {
      const ra = Rank.role(a),
        rb = Rank.role(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

    for (const role of roleKeys) {
      if (!ROLE_ORDER.includes(role)) continue;

      const heroes = (rolesObj[role] || [])
        .slice()
        .sort((a, b) => a.localeCompare(b));

      const group = document.createElement("div");
      group.className = "role-group";
      group.dataset.role = role;

      const roleToggle = document.createElement("button");
      roleToggle.className = "role-toggle role-toggle--icon";
      roleToggle.type = "button";
      roleToggle.setAttribute("role", "checkbox");
      const tri = getRoleTriState(role);
      const ariaChecked =
        tri === "all" ? "true" : tri === "none" ? "false" : "mixed";
      roleToggle.setAttribute("aria-checked", ariaChecked);
      roleToggle.setAttribute("aria-label", role);
      roleToggle.title = role;
      roleToggle.dataset.role = role;

      const iconSrc = `data/HeroIcons/${rolesObj?.[role][0].replace(":", "_")}/Abilities/Role_ ${role}.png`;
      const img = document.createElement("img");
      img.className = "role-toggle__img";
      img.alt = `${role} filters`;
      img.width = 20;
      img.height = 20;
      img.loading = "lazy";
      if (iconSrc) img.src = iconSrc;
      roleToggle.appendChild(img);

      roleToggle.addEventListener("click", () => {
        const state = getRoleTriState(role);
        const nextOn = state === "none";
        setRoleFilters(role, nextOn);
        buildHeroFilterUI(rolesObj);
        renderFromState();
        saveLocalState();
        updateUrlFragment();
      });

      group.appendChild(roleToggle);

      for (const hero of heroes) {
        const name = safeName(hero);
        const chip = document.createElement("button");
        chip.className = "hero-chip hero-chip--icon";
        chip.type = "button";
        chip.setAttribute(
          "aria-pressed",
          isHeroEnabled(name) ? "true" : "false",
        );
        chip.dataset.hero = name;

        chip.setAttribute("aria-label", name);
        chip.title = name;

        const pic = document.createElement("div");
        pic.className = "pic";
        const img = document.createElement("img");
        img.src = heroIconPath(name);
        img.alt = "";
        img.loading = "lazy";
        img.width = 24;
        img.height = 24;
        pic.appendChild(img);

        chip.appendChild(pic);

        chip.addEventListener("click", () => {
          const next = !isHeroEnabled(name);
          heroFilterByMode[mode][name] = next;
          chip.setAttribute("aria-pressed", next ? "true" : "false");
          saveHeroFilter();
          renderFromState();
          saveLocalState();
          updateUrlFragment();

          const tri = getRoleTriState(role);
          const ariaChecked =
            tri === "all" ? "true" : tri === "none" ? "false" : "mixed";
          roleToggle.setAttribute("aria-checked", ariaChecked);
        });

        chip.addEventListener("mouseenter", () => applyHeroHover(name));
        chip.addEventListener("mouseleave", clearHeroHover);
        chip.addEventListener("focus", () => applyHeroHover(name));
        chip.addEventListener("blur", clearHeroHover);

        group.appendChild(chip);
      }

      chips.push(group);
    }

    for (const c of chips) container.appendChild(c);
  }

  function renderFromState() {
    [bankEl, ...tierLists].forEach((l) => (l.innerHTML = ""));

    const ordered = mode === "powers" ? orderedIds.powers : orderedIds.items;
    const st = stateByMode[mode];

    TIERS.forEach((t, i) => {
      st[t].forEach((id) => {
        const item = BY_ID[id];
        if (!item) return;
        const card = createItemCard(item);
        if (!isItemEnabled(item)) card.classList.add("is-disabled");
        tierLists[i].appendChild(card);
      });
    });

    const placed = new Set([...TIERS.flatMap((t) => st[t])]);
    const bankIds = ordered.filter((id) => {
      if (placed.has(id)) return false;
      const item = BY_ID[id];
      return !!item && isItemEnabled(item);
    });
    bankIds.forEach((id) => bankEl.appendChild(createItemCard(BY_ID[id])));

    updateBankHeader();
    setActiveTab();
    reapplyHeroHoverIfAny();
  }

  function updateStateFromDom() {
    const st = emptyState();
    TIERS.forEach((t, idx) => {
      st[t] = [...tierLists[idx].querySelectorAll(".item")].map(
        (el) => el.dataset.id,
      );
    });
    stateByMode[mode] = st;
  }

  function setActiveTab() {
    const set = (el, active) => {
      el.classList.toggle("active", !!active);
      el.setAttribute("aria-selected", active ? "true" : "false");
    };
    set(tabItems, mode === "items");
    set(tabPowers, mode === "powers");
  }

  function createItemCard(item) {
    const el = document.createElement("div");
    el.className = "item";
    el.setAttribute("role", "listitem");
    el.dataset.id = item.id;
    el.dataset.hero = safeName(item?.hero?.name || "");

    el.draggable = true;

    if (item.img && item.img.base && item.img.border) {
      const base = escapeHtml(item.img.base);
      const border = escapeHtml(item.img.border);
      const mask = escapeHtml(item.img.mask);

      const icon = document.createElement("div");
      icon.className = "icon";
      icon.style.backgroundImage = `url("${base}")`;
      icon.style.setProperty("--mask-url", `url("${mask}")`);
      if (item.category === "Gadget") {
        icon.style.setProperty(
          "--gadget-mask-url",
          `url("data/VectorImages/GadgetMask.svg")`,
        );
      } else {
        icon.style.setProperty("--gadget-mask-url", "none");
      }

      const stroke = document.createElement("div");
      stroke.className = "stroke";
      stroke.style.backgroundImage = `url("${border}")`;
      stroke.style.setProperty("--mask-url", `url("${mask}")`);

      const borderEl = document.createElement("div");
      borderEl.className = "border";
      borderEl.style.backgroundImage = `url("${border}")`;

      el.appendChild(icon);
      el.appendChild(stroke);
      el.appendChild(borderEl);
    } else if (item.img) {
      el.style.background = `center / cover no-repeat url("${escapeHtml(item.img)}")`;
    } else {
      el.textContent = item.name || "";
    }

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = item.name || "";
    el.appendChild(label);

    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragend", onDragEnd);
    el.addEventListener("mouseenter", showTooltip);
    el.addEventListener("mousemove", moveTooltip);
    el.addEventListener("mouseleave", hideTooltip);

    return el;
  }

  function flash(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    (toastRoot || document.body).appendChild(el);
    setTimeout(() => el.classList.add("is-hiding"), 900);
    setTimeout(() => el.remove(), 1400);
  }
  // #endregion

  // #region Init
  async function init() {
    allLists.forEach((list) => {
      list.addEventListener("dragover", onListDragOver);
      list.addEventListener("drop", onListDrop);
      list.addEventListener("dragleave", onListDragLeave);
    });
    document.addEventListener("dragstart", hideTooltip, true);
    document.addEventListener("drop", hideTooltip, true);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener("drop", stopAutoScrollLoop, true);
    document.addEventListener("dragend", stopAutoScrollLoop, true);
    document.addEventListener(
      "dragleave",
      (e) => {
        if (
          !e.relatedTarget &&
          (e.target === document || e.target === document.documentElement)
        ) {
          stopAutoScrollLoop();
        }
      },
      true,
    );
    document.addEventListener(
      "dragover",
      (e) => {
        pointerPos.x = e.clientX;
        pointerPos.y = e.clientY;
        if (dragging) {
          const t = getScrollableParent(e.target);
          if (t !== autoScrollTarget) autoScrollTarget = t;
        }
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener(
      "dragenter",
      (e) => {
        if (dragging) e.preventDefault();
      },
      { passive: false },
    );

    // load data + state
    await loadData();
    loadLocalState();

    loadHeroFilter(rolesByGroup);
    buildHeroFilterUI(rolesByGroup);

    const didLoadFromUrl = await tryLoadFromHash();
    if (!didLoadFromUrl) {
      sanitizeStates();
      renderFromState();
    }

    // items/powers toggler
    tabItems.addEventListener("click", () => {
      if (mode === "items") return;
      updateStateFromDom();
      mode = "items";
      renderFromState();
      buildHeroFilterUI(rolesByGroup);
      saveLocalState();
      updateUrlFragment();
    });

    tabPowers.addEventListener("click", () => {
      if (mode === "powers") return;
      updateStateFromDom();
      mode = "powers";
      renderFromState();
      buildHeroFilterUI(rolesByGroup);
      saveLocalState();
      updateUrlFragment();
    });

    // share button
    const shareBtn = document.getElementById("shareBtn");
    shareBtn.addEventListener("click", async () => {
      try {
        const longUrl = await createShareUrl();
        let shortUrl;
        try {
          shortUrl = await shortenWithIsGd(longUrl);
        } catch {
          shortUrl = longUrl;
        }
        await navigator.clipboard.writeText(shortUrl);
        flash(shortUrl === longUrl ? "Share URL copied!" : "Short URL copied!");
      } catch (e) {
        console.error(e);
        flash("Failed to create share URL");
      }
    });

    // reset button
    resetBtn.addEventListener("click", () => {
      stateByMode[mode] = emptyState();
      resetFiltersToDefaults(rolesByGroup);
      saveLocalState();
      flash("Reset.");
      updateUrlFragment();
    });
  }
  // #endregion

  window.addEventListener("DOMContentLoaded", init);
})();
