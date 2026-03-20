  window.IS_RESULTS_PAGE = true;

// QUERY PARAM PARSER
function parseCruiseParams() {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  const destination = (params.get("destination") || "anywhere").toLowerCase();
  const start       = params.get("start")       || "anytime";
  const end         = params.get("end")         || null;
  const sort        = (params.get("sort") || "recommended").toLowerCase();
  const normalizedSort = (sort === "departing" || sort === "price" || sort === "recommended")
    ? sort
    : "recommended";

  return {
    destination,
    start,
    end,
    sort: normalizedSort,
    cruiseLines: params.getAll("cruise_line").flatMap(v => v.split(",")).filter(Boolean),
    ships: params.getAll("ship").flatMap(v => v.split(",")).filter(Boolean),
    durations: params.getAll("duration").flatMap(v => v.split(",")).filter(Boolean),
    minPrice: params.get("min_price")
      ? Number(params.get("min_price"))
      : null,
    maxPrice: params.get("max_price")
      ? Number(params.get("max_price"))
      : null
  };
}

window.CruiseSearchParams = parseCruiseParams();

function resolveDestinationName(slug) {
  if (!slug || slug === "anywhere") return null;

  const safeSlug = String(slug).trim().toLowerCase();

  const option = document.querySelector(
    `.destination-option[data-slug="${CSS.escape(safeSlug)}"]`
  );

  if (option?.dataset?.label) {
    return option.dataset.label.trim();
  }

  const cleanedSlug = safeSlug.replace(/-\d+$/, "");

  return cleanedSlug
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const destinationSlug = window.CruiseSearchParams.destination;
const destinationName = resolveDestinationName(destinationSlug);

function updateCruisesSEO({ destinationSlug, destinationName, results }) {
  const isAnywhere =
    !destinationSlug ||
    destinationSlug === "anywhere" ||
    destinationSlug === "all";

  const hasResults = results && results.length > 0;

  if (!isAnywhere && destinationName && hasResults) {
    setPageMeta({
      title: `${destinationName} Cruises | CruiseScout - Compare prices and find great deals`,
      description: `Discover ${destinationName} cruises from 40+ cruise lines and compare prices across booking sites. Save time and money by planning your next cruise vacation with CruiseScout.`,
      canonical: `${window.location.origin}/cruises?destination=${destinationSlug}`
    });
  } else {
    setMetaTag("name", "robots", "noindex,follow");
  }
}

let cruisesSeoInitialized = false;

function maybeInitCruisesSEO({ destinationSlug, destinationName, results }) {
  if (cruisesSeoInitialized) return;
  cruisesSeoInitialized = true;

  updateCruisesSEO({
    destinationSlug,
    destinationName,
    results
  });
}

// Breadcrumbs
if (window.IS_RESULTS_PAGE) {
  const { destination } = window.CruiseSearchParams || {};

  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Cruises", href: "/cruises" }
  ];

  if (destination && destination !== "anywhere") {
    let destLabel = null;

    const option = document.querySelector(
      `.destination-option[data-slug="${destination}"]`
    );

    if (option) {
      destLabel = option.dataset.destinationName; // <-- use real name
    }

    if (!destLabel) {
      destLabel = destination
        .replace(/-\d+$/, "") // remove numeric ID
        .split("-")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    crumbs.push({ label: destLabel });
  }

  renderBreadcrumbs(crumbs);
}


let allCruises = []; 
const selectedCruiseLines = new Set(); 
const selectedShips = new Set();
const selectedDurations = new Set();
const selectedDurationLabels = new Map();

(window.CruiseSearchParams?.cruiseLines || []).forEach(id => selectedCruiseLines.add(String(id)));
(window.CruiseSearchParams?.ships || []).forEach(id => selectedShips.add(String(id)));

let didHydrateFromUrl = false;
let facetsReady = false;

let nextOffset = null;
let isLoadingMore = false;
let reachedEnd = false;
let observer = null;
let fetchPage = null;
let ingestPage = null;

let priceTouchedByUser = false; 
if (
  window.CruiseSearchParams?.minPrice !== null ||
  window.CruiseSearchParams?.maxPrice !== null
) {
  priceTouchedByUser = true;
}

let resultsWrapper = null;
let loadingBlock = null;
let emptyBlock = null;
let template = null;

function asText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (typeof v === "string") return v;
  return String(v);
}

function normKey(v) {
  return asText(v).trim().toLowerCase();
}

const cruiseLineLabelByKey = new Map();
const shipLabelByKey = new Map();

function firstVal(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}

function cruiseLineKey(r) {
  return String(firstVal(r.cruise_line_id || r.cruise_line_slug || r.cruise_line_name) || "").trim();
}

function shipKey(r) {
  return String(firstVal(r.ship_id || r.ship_slug || r.ship_name) || "").trim();
}

function hydrateLegacySelections(results) {
  const lineLabelToKey = new Map();
  const shipLabelToKey = new Map();

  results.forEach(r => {
    const lk = cruiseLineKey(r);
    const ll = asText(r.cruise_line_name).trim();
    if (lk && ll) lineLabelToKey.set(normKey(ll), lk);

    const sk = shipKey(r);
    const sl = asText(r.ship_name).trim();
    if (sk && sl) shipLabelToKey.set(normKey(sl), sk);
  });

  [...selectedCruiseLines].forEach(v => {
    const k = lineLabelToKey.get(normKey(v));
    if (k && k !== v) { selectedCruiseLines.delete(v); selectedCruiseLines.add(k); }
  });

  [...selectedShips].forEach(v => {
    const k = shipLabelToKey.get(normKey(v));
    if (k && k !== v) { selectedShips.delete(v); selectedShips.add(k); }
  });
}

function readPriceBoundsFromUI() {
  const DEFAULT_MIN = 0;
  const DEFAULT_MAX = 10000;

  const minText = document.getElementById("price-min-display")?.innerText ?? "";
  const maxText = document.getElementById("price-max-display")?.innerText ?? "";

  const minDigits = String(minText).replace(/[^0-9]/g, "");
  const maxDigits = String(maxText).replace(/[^0-9]/g, "");

  const min = minDigits ? Number(minDigits) : DEFAULT_MIN;
  const max = maxDigits ? Number(maxDigits) : DEFAULT_MAX;

  return { min, max, DEFAULT_MIN, DEFAULT_MAX };
}

function syncPriceSliderUI(min, max, tries = 0) {
  const wrapper = document.querySelector("#price-slider");
  if (!wrapper) return;

  const track = wrapper.querySelector('[fs-rangeslider-element="track"]');
  const fill = wrapper.querySelector('[fs-rangeslider-element="fill"]');
  const handles = wrapper.querySelectorAll('[fs-rangeslider-element="handle"]');
  const displays = wrapper.querySelectorAll('[fs-rangeslider-element="display-value"]');

  const minHandle = handles[0] || null;
  const maxHandle = handles[1] || null;
  const minDisplay = document.getElementById("price-min-display") || displays[0] || null;
  const maxDisplay = document.getElementById("price-max-display") || displays[1] || null;

  const sliderMin = Number(wrapper.getAttribute("fs-rangeslider-min") || 0);
  const sliderMax = Number(wrapper.getAttribute("fs-rangeslider-max") || 10000);

  let nextMin = Number(min);
  let nextMax = Number(max);

  if (!Number.isFinite(nextMin)) nextMin = sliderMin;
  if (!Number.isFinite(nextMax)) nextMax = sliderMax;

  nextMin = Math.max(sliderMin, Math.min(nextMin, sliderMax));
  nextMax = Math.max(nextMin, Math.min(nextMax, sliderMax));

  // Always update visible labels immediately
  if (minDisplay) minDisplay.textContent = nextMin.toLocaleString("en-US");
  if (maxDisplay) maxDisplay.textContent = nextMax.toLocaleString("en-US");

  // Keep attrs in sync
  wrapper.setAttribute("fs-rangeslider-start", `${nextMin},${nextMax}`);
  if (minHandle) {
    minHandle.setAttribute("fs-rangeslider-start", String(nextMin));
    minHandle.setAttribute("aria-valuenow", String(nextMin));
    minHandle.setAttribute("aria-valuemin", String(sliderMin));
    minHandle.setAttribute("aria-valuemax", String(nextMax));
  }
  if (maxHandle) {
    maxHandle.setAttribute("fs-rangeslider-start", String(nextMax));
    maxHandle.setAttribute("aria-valuenow", String(nextMax));
    maxHandle.setAttribute("aria-valuemin", String(nextMin));
    maxHandle.setAttribute("aria-valuemax", String(sliderMax));
  }

  syncPricePlusFromDisplay();

  if (!track || !fill || !minHandle || !maxHandle) return;

  const trackWidth = track.clientWidth || track.getBoundingClientRect().width || 0;

  // If hidden/closed, retry shortly. This is the key fix.
  if (trackWidth <= 0) {
    if (tries < 8) {
      setTimeout(() => syncPriceSliderUI(nextMin, nextMax, tries + 1), 60);
    }
    return;
  }

  const range = sliderMax - sliderMin || 1;
  const minLeft = ((nextMin - sliderMin) / range) * trackWidth;
  const maxLeft = ((nextMax - sliderMin) / range) * trackWidth;

  minHandle.style.left = `${minLeft}px`;
  maxHandle.style.left = `${maxLeft}px`;

  fill.style.left = `${minLeft}px`;
  fill.style.width = `${Math.max(0, maxLeft - minLeft)}px`;
}

function syncPricePlusFromDisplay() {
  const maxDisplay = document.getElementById("price-max-display");
  const plus = document.getElementById("price-max-plus");
  if (!maxDisplay || !plus) return;

  const max = Number((maxDisplay.textContent || "").replace(/[^0-9]/g, ""));
  const show = Number.isFinite(max) && max >= 10000;

  plus.classList.toggle("hidden", !show);
  plus.style.display = show ? "inline" : "none";
}

function bindPricePlusObserver() {
  const maxDisplay = document.getElementById("price-max-display");
  if (!maxDisplay || maxDisplay.dataset.plusObserved === "1") return;

  maxDisplay.dataset.plusObserved = "1";

  const observer = new MutationObserver(() => {
    syncPricePlusFromDisplay();
  });

  observer.observe(maxDisplay, {
    childList: true,
    characterData: true,
    subtree: true
  });

  // initial sync
  syncPricePlusFromDisplay();
}

function syncFiltersToURL() {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  params.delete("cruise_line");
  params.delete("ship");
  params.delete("duration");
  params.delete("min_price");
  params.delete("max_price");

  if (selectedCruiseLines.size) {
    params.set("cruise_line", [...selectedCruiseLines].join(","));
  }

  if (selectedShips.size) {
    params.set("ship", [...selectedShips].join(","));
  }

  if (selectedDurations.size) {
    params.set("duration", [...selectedDurations].join(","));
  }

  const { min, max, DEFAULT_MIN, DEFAULT_MAX } = readPriceBoundsFromUI();

  if (min !== DEFAULT_MIN || max !== DEFAULT_MAX) {
    params.set("min_price", String(min));
    params.set("max_price", String(max));
  }
  
  const sort = window.CruiseSearchParams?.sort || getSortFromUrl() || "recommended";
  params.set("sort", SORT_VALUES.has(sort) ? sort : "recommended");

  window.history.replaceState({}, "", url);
}

window.syncFiltersToURL = syncFiltersToURL;

// SORT
const SORT_VALUES = new Set(["recommended", "departing", "price"]);

function ensureDefaultSortInUrl() {
  const url = new URL(window.location.href);
  const current = (url.searchParams.get("sort") || "").trim().toLowerCase();

  if (!SORT_VALUES.has(current)) {
    url.searchParams.set("sort", "recommended");
    window.history.replaceState({}, "", url.toString());
    return "recommended";
  }
  return current;
}

function getSortFromUrl() {
  const url = new URL(window.location.href);
  const raw = (url.searchParams.get("sort") || "recommended").trim().toLowerCase();
  return SORT_VALUES.has(raw) ? raw : "recommended";
}

function setSortInUrl(sort) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", sort);
  window.history.replaceState({}, "", url.toString());
}

function forceCloseWebflowDropdownFromChild(el) {
  const dd = el.closest(".w-dropdown");
  if (!dd) return false;

  const list = dd.querySelector(".w-dropdown-list");
  const toggle = dd.querySelector(".w-dropdown-toggle");

  dd.classList.remove("w--open");
  list?.classList.remove("w--open");
  toggle?.classList.remove("w--open");

  toggle?.setAttribute("aria-expanded", "false");

  return true;
}

function buildSearchURL({ destination, start, end, limit, offset }) {
  const workerBase = "https://cruise-api-proxy-pg.john-744.workers.dev/api/search";
  const u = new URL(workerBase);

  if (destination && destination !== "anywhere") u.searchParams.set("destination", destination);
  if (start && start !== "anytime") u.searchParams.set("start", start);
  if (end) u.searchParams.set("end", end);

  const sort = getSortFromUrl(); 
  u.searchParams.set("sort", sort);

  u.searchParams.set("limit", String(limit || 24));
  if (offset) u.searchParams.set("offset", String(offset));

  if (selectedCruiseLines.size) u.searchParams.set("cruise_line", [...selectedCruiseLines].join(","));
  if (selectedShips.size) u.searchParams.set("ship", [...selectedShips].join(","));

  if (selectedDurations.size) u.searchParams.set("duration", [...selectedDurations].join(","));

  const { min, max, DEFAULT_MIN, DEFAULT_MAX } = readPriceBoundsFromUI();

  const urlHasPrice =
    window.CruiseSearchParams.minPrice !== null ||
    window.CruiseSearchParams.maxPrice !== null;

  const shouldSendPrice = priceTouchedByUser || urlHasPrice;

  if (shouldSendPrice && (min !== DEFAULT_MIN || max !== DEFAULT_MAX)) {
    u.searchParams.set("min_price", String(min));
    u.searchParams.set("max_price", String(max));
  }

  return u;
}

function refreshSearch() {
  if (!resultsWrapper) return;                 
  if (typeof fetchPage !== "function") return; 

  syncFiltersToURL();

  reachedEnd = false;
  nextOffset = null;

  loadingBlock?.classList.remove("hidden");
  resultsWrapper.classList.add("is-refreshing");
  
  fetchPage({ reset: true });
}


//RESULTS PAGE RENDERER

document.addEventListener("DOMContentLoaded", () => {

  if (window.location.pathname !== "/cruises") return;

  console.log("🚀 Results renderer loaded");
  
  const effectiveSort = ensureDefaultSortInUrl();
  window.CruiseSearchParams.sort = effectiveSort;
  
  document.querySelectorAll("#filter-sort .filter-option")
  .forEach(opt => {
    opt.classList.toggle(
      "selected",
      opt.dataset.sort === effectiveSort
    );
  });

  const lineToggle = document.querySelector("#filter-cruise-line .w-dropdown-toggle");
  const shipToggle = document.querySelector("#filter-ship .w-dropdown-toggle");
  
  const priceToggle = document.querySelector("#filter-price .w-dropdown-toggle");
    if (priceToggle) {
      priceToggle.addEventListener("click", () => {
        setTimeout(() => {
          const { min, max } = readPriceBoundsFromUI();
          syncPriceSliderUI(min, max);
        }, 60);
      });
    }
  
  // SORT DROPDOWN
  const sortOptions = document.querySelectorAll(
    "#filter-sort .filter-option"
  );

  sortOptions.forEach(option => {
    option.addEventListener("click", (e) => {
      e.preventDefault();

      const sort = (option.dataset.sort || "").toLowerCase();
      if (!SORT_VALUES.has(sort)) return;

      setSortInUrl(sort);
      window.CruiseSearchParams.sort = sort;

      sortOptions.forEach(o => o.classList.remove("selected"));
      option.classList.add("selected");
      
      forceCloseWebflowDropdownFromChild(option);

      refreshSearch();
    });
  });

  resultsWrapper = document.getElementById("sailing-results");
  loadingBlock   = document.getElementById("results-loading");
  emptyBlock     = document.getElementById("results-empty");
  template       = document.getElementById("sailing-card-template");
  
  bindPricePlusObserver();
  
  const minEl = document.getElementById("price-min-display");
  const maxEl = document.getElementById("price-max-display");
  if (
    window.CruiseSearchParams.minPrice === null &&
    window.CruiseSearchParams.maxPrice === null
  ) {
    syncPriceSliderUI(0, 10000);
  }

  if (!resultsWrapper || !template) {
    console.error("❌ Missing results wrapper or template.");
    return;
  }

  template.style.display = "none";

  const { destination, start, end } = window.CruiseSearchParams;
  console.log("🔍 Parsed Params:", { destination, start, end });

  loadingBlock?.classList.remove("hidden");
  emptyBlock?.classList.add("hidden");
  resultsWrapper.innerHTML = "";

  const workerBase = "https://cruise-api-proxy.john-744.workers.dev/api/search";
  const searchURL = new URL(workerBase);

  if (destination !== "anywhere") searchURL.searchParams.set("destination", destination);
  if (start !== "anytime")       searchURL.searchParams.set("start", start);
  if (end)                       searchURL.searchParams.set("end", end);

  console.log("🌐 Worker URL:", searchURL.toString());

  const PAGE_SIZE = 24;

  ingestPage = function ingestPageImpl(data, { reset = false } = {}) {
  const results = Array.isArray(data.results) ? data.results : [];

  if (reset) allCruises = results;
  else allCruises = allCruises.concat(results);

  nextOffset = data.nextOffset || null;
  reachedEnd = !nextOffset;

  console.log(
    `📦 Received ${results.length} results (total: ${allCruises.length}) nextOffset=${nextOffset}`
  );

  if (reset && allCruises.length === 0) {
    resultsWrapper?.replaceChildren();
    resultsWrapper?.classList.remove("is-refreshing");
    emptyBlock?.classList.remove("hidden");
    updateAppliedFilters();
    return;
  }

  if (reset && !didHydrateFromUrl) {
    didHydrateFromUrl = true;

    // (optional safety) ensure clean slate before hydrating
    selectedCruiseLines.clear();
    selectedShips.clear();
    selectedDurations.clear();
    selectedDurationLabels.clear();

    const { cruiseLines, ships, durations, minPrice, maxPrice } = window.CruiseSearchParams;

    cruiseLines.forEach(line => selectedCruiseLines.add(String(line)));
    ships.forEach(ship => selectedShips.add(String(ship)));

    // ✅ keep this so legacy label-based params map to ids
    hydrateLegacySelections(allCruises);

    // ✅ keep your label logic
    durations.forEach(range => {
      selectedDurations.add(range);

      let label = range;
      if (range === "12+") label = "12+ nights";
      else if (range.includes("-")) {
        const [min, max] = range.split("-");
        label = `${min} – ${max} nights`;
      }
      selectedDurationLabels.set(range, label);
    });

    if (minPrice !== null && maxPrice !== null) {
      syncPriceSliderUI(minPrice, maxPrice);
    } else {
      syncPriceSliderUI(0, 10000);
    }

    setupDurationFilter();
    maybeInitCruisesSEO({ destinationSlug, destinationName, results: allCruises });
  }

  updateAppliedFilters();
  applyFilters();
  activateCardClicks();
};

fetchPage = async function fetchPageImpl({ offset = null, reset = false } = {}) {
  if (!reset && (isLoadingMore || reachedEnd)) return;
  isLoadingMore = true;

  try {
      if (reset) {
        reachedEnd = false;
        nextOffset = null;
        emptyBlock?.classList.add("hidden");
      }

    const u = buildSearchURL({ destination, start, end, limit: PAGE_SIZE, offset });
    console.log("🌐 Worker URL:", u.toString());

    const res = await fetch(u.toString());
    const data = await res.json();

    ingestPage(data, { reset });
  } catch (err) {
    console.error("❌ API error:", err);
    if (reset) emptyBlock?.classList.remove("hidden");
  } finally {
    loadingBlock?.classList.add("hidden");
    resultsWrapper?.classList.remove("is-refreshing");
    isLoadingMore = false;
  }
};

  loadingBlock?.classList.remove("hidden");
  fetchPage({ reset: true });

  const sentinel = document.getElementById("results-sentinel");

  if (sentinel) {
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;

        if (reachedEnd) return;
        if (isLoadingMore) return;
        if (!nextOffset) return; 

        fetchPage({ offset: nextOffset, reset: false });
      },
      {
        root: null,
        rootMargin: "800px 0px",
        threshold: 0,
      }
    );

    io.observe(sentinel);
  } else {
    console.warn("results-sentinel not found; infinite scroll disabled");
  }
    
    const facetsURL = new URL("https://cruise-api-proxy-pg.john-744.workers.dev/api/facets");
    if (destination !== "anywhere") facetsURL.searchParams.set("destination", destination);
    if (start !== "anytime")       facetsURL.searchParams.set("start", start);
    if (end)                       facetsURL.searchParams.set("end", end);

    fetch(facetsURL.toString())
      .then(r => r.json())
      .then(facetsData => {
        const facets = facetsData?.facets || {};
        const cruiseLineFacets = Array.isArray(facets.cruise_lines) ? facets.cruise_lines : [];
        const shipFacets       = Array.isArray(facets.ships) ? facets.ships : [];

        window.__GLOBAL_LINE_FACETS = cruiseLineFacets;
        window.__GLOBAL_SHIP_FACETS = shipFacets;
        
        cruiseLineLabelByKey.clear();
        cruiseLineFacets.forEach(o => cruiseLineLabelByKey.set(String(o.key), o.label));

        shipLabelByKey.clear();
        shipFacets.forEach(o => shipLabelByKey.set(String(o.key), o.label));

        facetsReady = true;

        setupCruiseLineFilterFromFacets(cruiseLineFacets);
        setupShipFilterFromFacets(shipFacets);

        setupDurationFilter();

        updateAppliedFilters();
       })
      .catch(err => {
        console.error("❌ Facets API error:", err);
      });
      
function isDropdownOpen(kind) {
  const root =
    kind === "ship"
      ? document.querySelector("#filter-ship")
      : document.querySelector("#filter-cruise-line");
  const list = getDropdownListEl(kind);
  return !!(root?.classList.contains("w--open") || list?.classList.contains("w--open"));
}

// Warm cache WITHOUT touching the DOM unless the dropdown is open
async function warmCache(kind) {
  const canRenderShip = typeof window.setupShipFilterFromFacets === "function";
  const canRenderLine = typeof window.setupCruiseLineFilterFromFacets === "function";
  if ((kind === "ship" && !canRenderShip) || (kind === "line" && !canRenderLine)) return;

  try {
    const data = await fetchFacets(kind); // uses your cached fetch() logic
    const facets = data?.facets || {};
    const cruiseLineFacets = Array.isArray(facets.cruise_lines) ? facets.cruise_lines : [];
    const shipFacets = Array.isArray(facets.ships) ? facets.ships : [];

    // keep label maps warm (pills etc.)
    cruiseLineFacets.forEach(o => cruiseLineLabelByKey.set(String(o.key), String(o.label)));
    shipFacets.forEach(o => shipLabelByKey.set(String(o.key), String(o.label)));

    // ONLY re-render if that dropdown is already open
    if (isDropdownOpen(kind)) {
      if (kind === "ship") window.setupShipFilterFromFacets(shipFacets);
      else window.setupCruiseLineFilterFromFacets(cruiseLineFacets);
    }
  } catch (e) {
    // silent warm failure is fine
    // console.warn("[facets] warmCache failed", kind, e);
  }
}

// schedule prefetch in idle time (fallback to setTimeout)
function schedulePrefetch(fn) {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => fn(), { timeout: 1200 });
  } else {
    setTimeout(fn, 0);
  }
}

document.addEventListener(
  "click",
  (e) => {
    const opt = e.target.closest(".filter-option");
    if (!opt) return;

    // Only react to clicks inside these two dropdowns
    if (opt.closest("#filter-cruise-line")) {
      // user changed line(s) -> warm ship facets
      schedulePrefetch(() => warmCache("ship"));
    } else if (opt.closest("#filter-ship")) {
      // user changed ship(s) -> warm line facets
      schedulePrefetch(() => warmCache("line"));
    }
  },
  true
);

// FILTERS
   
/// Applied Filter Bar 

// Cruise lines X clear click listener
document
  .querySelector("#filter-applied-cruise-line .filter-applied-x-icon")
  .addEventListener("click", () => {

    selectedCruiseLines.clear();

    document
      .querySelectorAll("#filter-cruise-line .filter-option")
      .forEach(option => option.classList.remove("selected"));

    updateAppliedFilters();
    refreshSearch();
  });
  
  // Ships X clear click listener
  document.querySelector("#filter-applied-ship .filter-applied-x-icon")
  .addEventListener("click", () => {
    selectedShips.clear();

    document.querySelectorAll("#filter-ship .filter-option").forEach(opt => {
      opt.classList.remove("selected");
    });

    updateAppliedFilters();
    refreshSearch();
  });
  
  	// Duration X clear click listener
  	document.querySelector("#filter-applied-duration .filter-applied-x-icon")
  		.addEventListener("click", () => {
   		 selectedDurations.clear();

		    document.querySelectorAll("#filter-duration .filter-option").forEach(option => {
    		  option.classList.remove("selected");
  		  });

   		 document.getElementById("filter-applied-duration").style.display = "none";

  		updateAppliedFilters();
  		refreshSearch();
 	 });
   
	function updateAppliedFilters() {
  const appliedBar = document.getElementById("filter-bar-applied");

  const minEl = document.getElementById("price-min-display");
  const maxEl = document.getElementById("price-max-display");

  const selectedMinPrice = parseInt(minEl?.innerText.replace(/[^0-9]/g, "") || "0");
  const selectedMaxPrice = parseInt(maxEl?.innerText.replace(/[^0-9]/g, "") || "1000000");

  const DEFAULT_MIN = 0;
	const DEFAULT_MAX = 10000;

	const priceIsNonDefault =
  selectedMinPrice !== DEFAULT_MIN ||
  selectedMaxPrice !== DEFAULT_MAX;

  const priceContainer = document.getElementById("filter-applied-price");
  priceContainer.innerHTML = "";

  if (priceIsNonDefault) {
    const label = `$${selectedMinPrice.toLocaleString()} – ${selectedMaxPrice >= 1000000 ? "$10,000+" : `$${selectedMaxPrice.toLocaleString()}`}`;

    const pill = document.createElement("div");
    pill.className = "filter-applied";

    pill.innerHTML = `
      <div class="filter-applied-inner-wrapper">
        <div class="filter-applied-text">
          <div class="filter-applied-placeholder-text">${label}</div>
        </div>
        <div class="filter-applied-x-icon">
          <img
            src="https://cdn.prod.website-files.com/6902b622d128142e45f76430/690b9e9cee0f69154b5dc11c_noun-x-5978509-FFFFFF.svg"
            loading="lazy"
            alt="Remove price filter"
          />
        </div>
      </div>
    `;

    pill.querySelector(".filter-applied-x-icon").addEventListener("click", () => {
      priceTouchedByUser = false;
      syncPriceSliderUI(0, 10000);

      updateAppliedFilters();
      refreshSearch();
    });

    priceContainer.style.display = "flex";
    priceContainer.appendChild(pill);
  } else {
    priceContainer.style.display = "none";
  }

  function renderFilterPills(containerId, selectedSet, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    if (selectedSet.size === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";

    selectedSet.forEach(value => {
      let label = value;

      if (type === "duration") {
        label = selectedDurationLabels.get(value) || value;
      } else if (type === "ship") {
        if (!facetsReady) return; // don't render until labels are ready
        label = shipLabelByKey.get(value) || "";
      } else if (type === "cruise-line") {
        if (!facetsReady) return; // don't render until labels are ready
        label = cruiseLineLabelByKey.get(value) || "";
      }

      const pill = document.createElement("div");
      pill.className = "filter-applied";
      pill.dataset.value = value;
      pill.dataset.type = type;

      pill.innerHTML = `
        <div class="filter-applied-inner-wrapper">
          <div class="filter-applied-text">
            <div class="filter-applied-placeholder-text">${label}</div>
          </div>
          <div class="filter-applied-x-icon">
            <img
              src="https://cdn.prod.website-files.com/6902b622d128142e45f76430/690b9e9cee0f69154b5dc11c_noun-x-5978509-FFFFFF.svg"
              loading="lazy"
              alt="Remove filter"
            />
          </div>
        </div>
      `;

pill.querySelector(".filter-applied-x-icon").addEventListener("click", () => {
  selectedSet.delete(value);

  if (type === "duration") {
    selectedDurationLabels.delete(value);
    document
      .querySelectorAll(
        `#filter-duration .filter-option[data-range="${value}"], #filter-duration .filter-option[data-value="${value}"]`
      )
      .forEach(opt => opt.classList.remove("selected"));

  } else if (type === "ship") {
    document
      .querySelectorAll(`#filter-ship .filter-option`)
      .forEach(opt => {
        if (opt.dataset.value === value) opt.classList.remove("selected");
      });

  } else if (type === "cruise-line") {
    document
      .querySelectorAll(`#filter-cruise-line .filter-option`)
      .forEach(opt => {
        if (opt.dataset.value === value) opt.classList.remove("selected");
      });
  }

  updateAppliedFilters();
  refreshSearch();
});

      container.appendChild(pill);
    });
  }

  renderFilterPills("filter-applied-cruise-line", selectedCruiseLines, "cruise-line");
  renderFilterPills("filter-applied-ship", selectedShips, "ship");
  renderFilterPills("filter-applied-duration", selectedDurations, "duration");

  const anyActive =
    selectedCruiseLines.size > 0 ||
    selectedShips.size > 0 ||
    selectedDurations.size > 0 ||
    priceIsNonDefault;

  appliedBar.style.display = anyActive ? "flex" : "none";
}
   
// CRUISE LINE FILTER
function setupCruiseLineFilterFromFacets(facets) {
  const content = document.querySelector("#filter-cruise-line .filter-dropdown-sheet-content");
  if (!content) return;

  content.querySelectorAll(".filter-option").forEach(el => el.remove());

  const options = (facets || [])
    .map(o => ({ key: String(o.key), label: String(o.label || "").trim() }))
    .filter(o => o.key && o.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  window.setupCruiseLineFilterFromFacets = setupCruiseLineFilterFromFacets;
  window.setupShipFilterFromFacets = setupShipFilterFromFacets;

  options.forEach(({ key, label }) => {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "filter-option w-button";
    a.dataset.value = key;
    a.textContent = label;

    if (selectedCruiseLines.has(key)) a.classList.add("selected");

    a.addEventListener("click", (e) => {
      e.preventDefault();
      const isSelected = a.classList.toggle("selected");
      if (isSelected) selectedCruiseLines.add(key);
      else selectedCruiseLines.delete(key);

      updateAppliedFilters();
      refreshSearch();
    });

    content.appendChild(a);
  });
}

// CRUISE SHIP FILTER
function setupShipFilterFromFacets(facets) {
  const content = document.querySelector("#filter-ship .filter-dropdown-sheet-content");
  if (!content) return;

  content.querySelectorAll(".filter-option").forEach(el => el.remove());

  const options = (facets || [])
    .map(o => ({ key: String(o.key), label: String(o.label || "").trim() }))
    .filter(o => o.key && o.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  window.setupCruiseLineFilterFromFacets = setupCruiseLineFilterFromFacets;
  window.setupShipFilterFromFacets = setupShipFilterFromFacets;

  options.forEach(({ key, label }) => {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "filter-option w-button";
    a.dataset.value = key;
    a.textContent = label;

    if (selectedShips.has(key)) a.classList.add("selected");

    a.addEventListener("click", (e) => {
      e.preventDefault();
      const isSelected = a.classList.toggle("selected");
      if (isSelected) selectedShips.add(key);
      else selectedShips.delete(key);

      updateAppliedFilters();
      refreshSearch();
    });

    content.appendChild(a);
  });
}


// DURATION FILTER
function setupDurationFilter() {
  const container = document.querySelector("#filter-duration .filter-dropdown-sheet-content");
  if (!container) return;

  // Prevent duplicate binding
  if (container.dataset.durationBound === "1") return;
  container.dataset.durationBound = "1";

  container.addEventListener("click", (e) => {
    const option = e.target.closest(".filter-option");
    if (!option || !container.contains(option)) return;

    e.preventDefault();
    e.stopPropagation();

    const range = option.dataset.value || option.dataset.range;
    if (!range) return;

    const label = (option.textContent || "").trim() || range;
    const isSelected = option.classList.toggle("selected");

    if (isSelected) {
      selectedDurations.add(range);
      selectedDurationLabels.set(range, label);
    } else {
      selectedDurations.delete(range);
      selectedDurationLabels.delete(range);
    }

    updateAppliedFilters();
    refreshSearch();
  });
}




// PRICE FILTER
let lastPriceText = null;

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const refreshSearchDebounced = debounce(() => {
  refreshSearch();
}, 250);

setInterval(() => {
  const minText = document.getElementById("price-min-display")?.innerText || "";
  const maxText = document.getElementById("price-max-display")?.innerText || "";
  const combined = `${minText}|${maxText}`;

  // seed initial state without treating it as user input
  if (lastPriceText === null) {
    lastPriceText = combined;
    return;
  }

  if (combined !== lastPriceText) {
    lastPriceText = combined;

    // DOM changed => treat as active user price interaction
    priceTouchedByUser = true;

    updateAppliedFilters();
    refreshSearchDebounced();
  }
}, 200);


// PRICE FILTER HELPER
function getDisplayedPrice(record) {

	const fields = [
    "interior_highlight_price",
    "oceanview_highlight_price",
    "balcony_highlight_price",
    "suite_highlight_price"
  ];

  const interp = Number(record?.interpolated_price);
  if (Number.isFinite(interp) && interp > 0) return interp;

  for (const f of fields) {
    const n = Number(record?.[f]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function applyFilters() {
  
  const minText = document.getElementById("price-min-display")?.innerText || "0";
  const maxText = document.getElementById("price-max-display")?.innerText || "1000000"; // fallback for "no max"

  const minPrice = Number(minText.replace(/,/g, ""));
  const maxPrice = Number(maxText.replace(/,/g, ""));
  
  const filtered = allCruises.filter(record => {
    // Cruise Lines
    if (selectedCruiseLines.size > 0 && !selectedCruiseLines.has(cruiseLineKey(record))) {
      return false;
    }
    // Cruise Ships
    if (selectedShips.size > 0 && !selectedShips.has(shipKey(record))) {
      return false;
    }

    // Duration
    if (selectedDurations.size > 0) {
  		const durationRanges = Array.from(selectedDurations).map(r => {
   		 if (r === "12+") return [12, Infinity];
   		 const [min, max] = r.split("-").map(Number);
  	   return [min, max];
  		});

  		if (!durationRanges.some(([min, max]) => record.duration_nights >= min && record.duration_nights <= max)) {
   		 return false;
  		}
		}
    
    // Price
    const urlHasPrice =
      window.CruiseSearchParams.minPrice !== null ||
      window.CruiseSearchParams.maxPrice !== null;

    if (priceTouchedByUser || urlHasPrice) {
      const price = getDisplayedPrice(record);
      if (price == null || price < minPrice || price > maxPrice) return false;
    }

    return true;
  });

  renderCruises(filtered);
  syncFiltersToURL();
}

window.updateAppliedFilters = updateAppliedFilters;
window.applyFilters = applyFilters;


// Apply filters and render cruises

function renderCruises(results) {
  const frag = document.createDocumentFragment();

  results.forEach(record => {
    const card = template.cloneNode(true);
    card.style.display = "block";
    card.removeAttribute("id");
    card.classList.add("sailing-card");

    fillCard(card, record);
    frag.appendChild(card);
  });

  resultsWrapper.replaceChildren(frag);

  emptyBlock?.classList.toggle("hidden", results.length > 0);

  activateCardClicks();
}

function fillCard(card, record) {
  card.setAttribute("data-cruise-id", record.cruise_id);
  card.setAttribute("data-departure-date", record.departure_date);

  const cabinPriority = [
    { field: "interior_highlight_price", label: "Interior" },
    { field: "oceanview_highlight_price", label: "Oceanview" },
    { field: "balcony_highlight_price", label: "Balcony" },
    { field: "suite_highlight_price", label: "Suite" }
  ];

  let best = null;

  for (let c of cabinPriority) {
    const price = Number(record[c.field]);
    if (!isNaN(price) && price > 0) {
      best = { type: c.label, price };
      break;
    }
  }

  if (!best) best = { type: "", price: "" };

  const typeNode = card.querySelector("[data-field='highlight_cabin_type']");
  const priceNode = card.querySelector("[data-field='highlight_price']");

  if (typeNode) typeNode.textContent = best.type;
  if (priceNode) priceNode.textContent = best.price ? formatPrice(best.price) : "";

  const nodes = card.querySelectorAll("[data-field]");

  nodes.forEach(node => {
    const field = node.getAttribute("data-field");
    if (!field) return;

    let value = record[field];

    if (field === "highlight_price" || field === "highlight_cabin_type") {
      return;
    }

    if (field === "departure_date" && value) {
      value = formatDate(value);
    }

    if (node.tagName === "IMG") {
      const wrapper = node.closest(".card-image-shell");
      const imageUrl = value && String(value).trim();

      if (wrapper) {
        wrapper.classList.add("skeleton");
        wrapper.classList.remove("image-loaded");
      }

      // Hide the placeholder image immediately
      node.style.opacity = "0";

      // No real image available
      if (!imageUrl) {
        node.removeAttribute("src");
        node.removeAttribute("srcset");
        return;
      }

      const img = new Image();

      img.onload = () => {
        node.src = imageUrl;
        node.removeAttribute("srcset");

        requestAnimationFrame(() => {
          if (wrapper) {
            wrapper.classList.remove("skeleton");
            wrapper.classList.add("image-loaded");
          }
          node.style.opacity = "1";
        });
      };

      img.onerror = () => {
        // leave skeleton visible if image fails
        node.removeAttribute("src");
        node.removeAttribute("srcset");
      };

      img.src = imageUrl;

      // Handle cached images that may already be loaded
      if (img.complete) {
        img.onload();
      }
    } else {
      node.textContent = value ?? "";
    }
  });
}

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatPrice(num) {
    const n = Number(num);
    if (isNaN(n)) return "";

    const rounded = Math.round(n);

    return rounded.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }


  function activateCardClicks() {
  const cards = document.querySelectorAll(".sailing-card");

  cards.forEach(card => {
    if (card.querySelector(".card-link-overlay")) return;

    const cruiseId = card.getAttribute("data-cruise-id");
    const depDate  = card.getAttribute("data-departure-date");

    if (!cruiseId) return;

    const url = new URL("/cruise", window.location.origin);
    url.searchParams.set("cruise_id", cruiseId);
    if (depDate) url.searchParams.set("departure_date", depDate);

    const link = document.createElement("a");
    link.href = url.toString();
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "card-link-overlay";

    Object.assign(link.style, {
      position: "absolute",
      inset: "0",
      zIndex: "10"
    });

    card.style.position = "relative";
    card.appendChild(link);
  });
}

});

//Facets refresh

(function () {
  const FACETS_BASE = "https://cruise-api-proxy-pg.john-744.workers.dev/api/facets";
  const CACHE_TTL_MS = 60 * 10000;

  const cache = {
    ship: { key: "", at: 0, data: null },
    line: { key: "", at: 0, data: null },
  };

  function getDropdownListEl(kind) {
    const root =
      kind === "ship"
        ? document.querySelector("#filter-ship")
        : document.querySelector("#filter-cruise-line");
    if (!root) return null;
    return root.querySelector(".filter-dropdown-list");
  }
  
  function getDropdownContentEl(kind) {
    const root =
      kind === "ship"
        ? document.querySelector("#filter-ship")
        : document.querySelector("#filter-cruise-line");
    if (!root) return null;
    return root.querySelector(".filter-dropdown-sheet-content");
  }

  function showLoading(kind) {
    const content = getDropdownContentEl(kind);
    if (!content) return;

    content.querySelectorAll(".filter-option").forEach((el) => el.remove());

    const a = document.createElement("a");
    a.href = "#";
    a.className = "filter-option w-button";
    a.style.pointerEvents = "none";
    a.style.opacity = "0.7";
    a.textContent = "Loading…";

    content.appendChild(a);
  }

  function buildFacetsUrl(kind) {
    const u = new URL(FACETS_BASE);

    const { destination, start, end } = window.CruiseSearchParams || {};
    if (destination && destination !== "anywhere") u.searchParams.set("destination", destination);
    if (start && start !== "anytime") u.searchParams.set("start", start);
    if (end) u.searchParams.set("end", end);

    if (kind === "ship") {
      if (selectedCruiseLines && selectedCruiseLines.size) {
        u.searchParams.set("cruise_line", [...selectedCruiseLines].join(","));
      }
    } else {
      if (selectedShips && selectedShips.size) {
        u.searchParams.set("ship", [...selectedShips].join(","));
      }
    }

    return u;
  }

  async function fetchFacets(kind) {
    const u = buildFacetsUrl(kind);
    const key = u.toString();

    const now = Date.now();
    const hit = cache[kind];
    if (hit.data && hit.key === key && now - hit.at < CACHE_TTL_MS) {
      return hit.data;
    }

    const res = await fetch(key);
    if (!res.ok) throw new Error(`facets ${kind} failed ${res.status}`);
    const data = await res.json();

    cache[kind] = { key, at: now, data };
    return data;
  }
  
  function cacheHasValid(kind) {
    const key = buildFacetsUrl(kind).toString();
    const hit = cache[kind];
    return !!(hit.data && hit.key === key && (Date.now() - hit.at) < CACHE_TTL_MS);
  }

  function prefetchFacets(kind) {
    return fetchFacets(kind).catch(() => null);
  }

  function prefetchBoth() {
    prefetchFacets("ship");
    prefetchFacets("line");
  }

  async function refreshDropdown(kind, { withLoading = false } = {}) {

    const canRenderShip = typeof window.setupShipFilterFromFacets === "function";
    const canRenderLine = typeof window.setupCruiseLineFilterFromFacets === "function";
    if ((kind === "ship" && !canRenderShip) || (kind === "line" && !canRenderLine)) return;

    if (withLoading) showLoading(kind);

    const data = await fetchFacets(kind);
    const facets = data?.facets || {};
    const cruiseLineFacets = Array.isArray(facets.cruise_lines) ? facets.cruise_lines : [];
    const shipFacets = Array.isArray(facets.ships) ? facets.ships : [];

    if (kind === "ship") {
      shipLabelByKey.clear();
      shipFacets.forEach((o) => shipLabelByKey.set(String(o.key), o.label));
      window.setupShipFilterFromFacets(shipFacets);
    } else {
      cruiseLineLabelByKey.clear();
      cruiseLineFacets.forEach((o) => cruiseLineLabelByKey.set(String(o.key), o.label));
      window.setupCruiseLineFilterFromFacets(cruiseLineFacets);
    }
  }

  window.refreshShipDropdownOptions = () => refreshDropdown("ship", { withLoading: true });
  window.refreshLineDropdownOptions = () => refreshDropdown("line", { withLoading: true });

  document.addEventListener(
  "mousedown",
  (e) => {
    const shipToggle = e.target.closest("#filter-ship .w-dropdown-toggle");
    if (shipToggle) {
      refreshDropdown("ship", { withLoading: !cacheHasValid("ship") }).catch((err) =>
        console.error("[facets] ship refresh failed", err)
      );
      return;
    }

    const lineToggle = e.target.closest("#filter-cruise-line .w-dropdown-toggle");
    if (lineToggle) {
      refreshDropdown("line", { withLoading: !cacheHasValid("line") }).catch((err) =>
        console.error("[facets] line refresh failed", err)
      );
      return;
    }
  },
  true
);
  
  // ✅ Prefetch facets on page load (warms cache for the CURRENT selection state)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(prefetchBoth, 0);
    });
  } else {
    setTimeout(prefetchBoth, 0);
  }

  document.addEventListener(
    "click",
    (e) => {
      const opt = e.target.closest(".filter-option");
      if (!opt) return;

      if (opt.closest("#filter-cruise-line")) {
        setTimeout(() => prefetchFacets("ship"), 0);
      } else if (opt.closest("#filter-ship")) {
        setTimeout(() => prefetchFacets("line"), 0);
      }
    },
    true
  );
})();


window.Webflow ||= [];
window.Webflow.push(() => {
  const sliderWrapper = document.querySelector("#price-slider[fs-rangeslider='slider']");
  if (!sliderWrapper) {
    console.warn("Price slider wrapper not found");
    return;
  }

sliderWrapper.addEventListener("rangeslider:change", () => {
  priceTouchedByUser = true;

  requestAnimationFrame(() => {
    const { min, max } = readPriceBoundsFromUI();

    const minDisplay = document.getElementById("price-min-display");
    const maxDisplay = document.getElementById("price-max-display");

    if (minDisplay) minDisplay.textContent = Number(min).toLocaleString("en-US");
    if (maxDisplay) maxDisplay.textContent = Number(max).toLocaleString("en-US");

    syncPricePlusFromDisplay();
  });
});

});


window.Webflow ||= [];
window.Webflow.push(function () {
  const mq = window.matchMedia("(max-width: 479px)");
  if (!mq.matches) return;

  const DROPDOWN = ".filter-dropdown.w-dropdown";
  const LIST     = ".filter-dropdown-list.w-dropdown-list";
  const BODY_OPEN_CLASS = "filter-sheet-open";

  function updateBodyScrollLock() {
    const anyOpen = document.querySelector(`${LIST}.w--open`);
    document.body.classList.toggle(BODY_OPEN_CLASS, !!anyOpen);
  }

  document.addEventListener("click", () => {
    requestAnimationFrame(updateBodyScrollLock);
  });

  document.addEventListener("touchend", () => {
    requestAnimationFrame(updateBodyScrollLock);
  }, { passive: true });

  window.addEventListener("resize", updateBodyScrollLock);
});


window.Webflow ||= [];
window.Webflow.push(function () {

  function closeDropdownFor(el) {
    const dd = el.closest(".w-dropdown");
    if (!dd) return;

    const toggle = dd.querySelector(".w-dropdown-toggle");
    const list = dd.querySelector(".w-dropdown-list");

    if (toggle && (dd.classList.contains("w--open") || list?.classList.contains("w--open"))) {
      toggle.click();
    }
  }

  document.addEventListener("click", function (e) {
    const closeBtn = e.target.closest(".filter-sheet-close");
    if (!closeBtn) return;

    e.preventDefault();
    e.stopPropagation();

    closeDropdownFor(closeBtn);

    document.querySelector(".modal-background")?.classList.remove("is-open");
  }, true);

});