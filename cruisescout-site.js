window.Webflow = window.Webflow || [];
window.Webflow.push(function () {
  
  function parseDateOnly(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
  
  function scrollSearchBarIntoView(searchBar) {
  	if (window.innerWidth > 479) return;

 	 if (!searchBar) return;

 	 const header = document.querySelector(".header-wrapper");
 	 const headerBottom = header
   	 ? header.getBoundingClientRect().bottom
  	  : 0;

 	 const searchBarTop = searchBar.getBoundingClientRect().top;
  	const delta = searchBarTop - headerBottom - 12;

 	 if (Math.abs(delta) < 4) return;

 	 window.scrollTo({
 	   top: window.scrollY + delta,
 	   behavior: "auto"
 	 });
	}
  
  const MOBILE_BP = 479;
  const isMobile = () => window.innerWidth <= MOBILE_BP;
  
  const DESTINATIONS_URL = "https://destinations-sync.john-744.workers.dev/destinations.json";
  let __destinationsPromise = null;
  let __destinationsData = null;

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadDestinations() {
    if (__destinationsData) return Promise.resolve(__destinationsData);
    if (__destinationsPromise) return __destinationsPromise;

    __destinationsPromise = fetch(DESTINATIONS_URL, { credentials: "omit" })
      .then(res => {
        if (!res.ok) throw new Error(`Destination load failed: ${res.status}`);
        return res.json();
      })
      .then(data => {
        __destinationsData = (Array.isArray(data?.items) ? data.items : [])
          .sort((a, b) => {
            const ak = a.sortKey || "";
            const bk = b.sortKey || "";
            return ak.localeCompare(bk);
          });
        return __destinationsData;
      })
      .catch(err => {
        console.error("[destinations] load failed", err);
        __destinationsPromise = null;
        throw err;
      });

    return __destinationsPromise;
  }

  function getDestinationMatches(items, query, limit = 10) {
    const q = (query || "").toLowerCase().trim();

    if (!q) return items.slice(0, limit);

    return items
      .filter(item => {
        const haystack = `${item.name || ""} ${item.subhead || ""} ${item.type || ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, limit);
  }

  function renderDestinationOptionsHTML(items) {
    return items.map(item => `
      <div
        class="destination-option"
        data-slug="${escapeHtml(item.slug || "")}"
        data-label="${escapeHtml(item.name || "")}"
        data-type="${escapeHtml(item.type || "")}"
        tabindex="0"
      >
        <div class="destination-option-icon-wrapper">
          <img
            class="destination-option-icon"
            src="${escapeHtml(item.iconUrl || "")}"
            alt="${escapeHtml(item.type || "Destination")} icon"
          />
        </div>
        <div class="destination-option-text-wrapper">
          <div class="destination-text">${escapeHtml(item.name || "")}</div>
          <div class="destination-subhead">${escapeHtml(item.subhead || "")}</div>
        </div>
      </div>
    `).join("");
  }

  /* ========================
     HEADER SEARCH CONTROLLER
  =========================== */
  if (window.IS_RESULTS_PAGE) {

    const headerWrapper = document.querySelector(".header-wrapper");
    const searchSlot    = document.querySelector(".header-search-slot");
    const editor        = document.querySelector(".header-search-editor");

    if (headerWrapper && searchSlot && editor) {

      searchSlot.classList.add("visible");

      const mobileEditorClose = editor.querySelector("#mobile-search-editor-close, .mobile-search-editor-close");

      if (mobileEditorClose && !mobileEditorClose.__bound) {
        mobileEditorClose.__bound = true;
        mobileEditorClose.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeEditor();
        });
      }

      const mobileEditorButton = editor.querySelector("#mobile-search-editor-button, .mobile-search-editor-button");

      if (mobileEditorButton && !mobileEditorButton.__bound) {
        mobileEditorButton.__bound = true;
        mobileEditorButton.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const editorBar = editor.querySelector(".search-bar");
          if (!editorBar) return;

          window.location.href = buildSearchUrlFromBar(editorBar);
        });
      }

      /* ----------------------
         URL → HEADER HYDRATION
      ------------------------- */
      const destInput       = document.getElementById("header-destination-input");
      const destPlaceholder = document.getElementById("header-destination-placeholder");
      const dateInput       = document.getElementById("header-date-input");
      const datePlaceholder = document.getElementById("header-date-placeholder");

      const params = new URLSearchParams(window.location.search);

      // Destination
      const destination = params.get("destination");
      if (destInput) {
        if (destination && destination !== "anywhere") {
          loadDestinations()
            .then(items => {
              const match = items.find(item => item.slug === destination);
              if (!match) return;

              destInput.value = match.name;
              destInput.dataset.slug = match.slug;
              destInput.style.fontWeight = "600";
              destPlaceholder && (destPlaceholder.style.opacity = "0");
            })
            .catch(err => {
              console.error("[header hydration] destination lookup failed", err);
            });
        } else {
          destInput.value = "";
          delete destInput.dataset.slug;
          if (destPlaceholder) {
            destPlaceholder.textContent = "Anywhere";
            destPlaceholder.style.opacity = "1";
          }
        }
      }

      // Dates
      const start = params.get("start");
      const end   = params.get("end");
      if (dateInput) {
        if (start) {
          const s = parseDateOnly(start);
          const e = end ? parseDateOnly(end) : null;
          const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          dateInput.value = e
            ? `${m[s.getMonth()]} ${s.getDate()} – ${m[e.getMonth()]} ${e.getDate()}`
            : `${m[s.getMonth()]} ${s.getDate()}`;
          datePlaceholder && (datePlaceholder.style.opacity = "0");
        } else {
          dateInput.value = "";
          if (datePlaceholder) {
            datePlaceholder.textContent = "Anytime";
            datePlaceholder.style.opacity = "1";
          }
        }
      }

      /* -----------------
         EXPAND / COLLAPSE
      -------------------- */
      let isExpanded = false;
      let expandIntent = null;

      function openEditor(intent = null) {
        if (isExpanded) return;
        isExpanded = true;
        expandIntent = intent;

        headerWrapper.classList.add("is-expanded");

        requestAnimationFrame(() => {
          if (isMobile()) {
            expandIntent = null;
            return;
          }

          if (expandIntent === "destination") {
            const sb = document.querySelector(".header-search-editor .search-bar");
            sb?.openDestinationDropdown?.();
          }

          if (expandIntent === "dates") {
            const sb = document.querySelector(".header-search-editor .search-bar");
            sb?.openDatepicker?.();
            sb && typeof window.renderCalendars === "function" && window.renderCalendars();
          }

          expandIntent = null;
        });
      }

      function closeEditor() {
        if (!isExpanded) return;
        isExpanded = false;
        expandIntent = null;
        headerWrapper.classList.remove("is-expanded");
      }

      /* -------------
         CLICK ROUTING
      ---------------- */
      searchSlot.addEventListener("click", function (e) {
        if (isMobile()) {
          e.preventDefault();
          e.stopPropagation();
          openEditor(null); 
          return;
        }

        const destArea = e.target.closest("#header-destination-area");
        const dateArea = e.target.closest("#header-date-area");

        if (destArea) openEditor("destination");
        else if (dateArea) openEditor("dates");
        else openEditor(null);
      }, true);

      document.addEventListener("click", function (e) {
        if (!isExpanded) return;
        if (!editor.contains(e.target) && !searchSlot.contains(e.target)) {
          closeEditor();
        }
      });
    }
  }

  
  /********************
 * MOBILE SEARCH MODALS
 **********************/
(function initMobileSearchModals() {
  const isMobile = () => window.innerWidth <= 479;

  const modalSourceBar =
    document.querySelector(".home-page-hero .search-bar") ||
    document.querySelector(".header-search-editor .search-bar");

  if (!modalSourceBar) return;

  const heroDestArea = modalSourceBar.querySelector("#destination-area");
  const heroDestInput = modalSourceBar.querySelector("#destination-input");
  const heroDestPlaceholder = modalSourceBar.querySelector("#destination-placeholder");

  const heroDateArea = modalSourceBar.querySelector("#date-area");
  const heroDateInput = modalSourceBar.querySelector("#date-input");
  const heroDatePlaceholder = modalSourceBar.querySelector("#date-placeholder");

  const destModal = document.getElementById("mobile-destination-modal");
  const destClose = document.getElementById("mobile-destination-close");
  const destInput = document.getElementById("mobile-destination-input");
  const destList  = document.getElementById("mobile-destination-list");
  const destPlaceholderEl = document.getElementById("mobile-destination-placeholder");

  const dateModal = document.getElementById("mobile-date-modal");
  const dateClose = document.getElementById("mobile-date-close");
  const dateApply = document.getElementById("mobile-date-apply");
  const calContainer = document.getElementById("mobile-calendar-container");
  
  if (!destModal || !dateModal) return;
  
  if (!destModal.__scrollBound) {
    destModal.__scrollBound = true;

    const block = (e) => {
      if (e.target.closest("#mobile-destination-list")) return;
      e.preventDefault();
    };

    destModal.addEventListener("touchmove", block, { passive: false });
    destModal.addEventListener("wheel", block, { passive: false });
  }
  
  const destClear =
    document.getElementById("mobile-destination-clear") ||
    document.querySelector(".mobile-destination-clear");

  const destPlaceholder =
    document.getElementById("mobile-destination-placeholder") ||
    document.querySelector(".mobile-destination-placeholder");

  function setMobileDestPlaceholderVisible(visible) {
    if (!destPlaceholder) return;
    destPlaceholder.style.opacity = visible ? "1" : "0";
  }

  function clearMobileDestination() {
    destInput.value = "";
    setMobileDestPlaceholderVisible(true);
    filterDest(""); // show all options again

  if (typeof updateMobileDestClearVisibility === "function") {
      updateMobileDestClearVisibility();
    } else {
      destClear?.classList.remove("visible");
    }

    requestAnimationFrame(() => destInput.focus({ preventScroll: true }));
  }

  destModal.addEventListener(
    "pointerdown",
    (e) => {
      const btn = e.target.closest("#mobile-destination-clear, .mobile-destination-clear");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();
      clearMobileDestination();
    },
    { passive: false }
  );

  destModal.addEventListener(
    "touchstart",
    (e) => {
      const btn = e.target.closest("#mobile-destination-clear, .mobile-destination-clear");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();
      clearMobileDestination();
    },
    { passive: false }
  );

  window.startDate = window.startDate || null;
  window.endDate   = window.endDate || null;

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  const weekdayNames = ["S","M","T","W","T","F","S"];

  function toDateOnly(d) {
    const nd = new Date(d);
    nd.setHours(0,0,0,0);
    return nd;
  }
  function isSameDay(a,b) {
    return a && b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function isBefore(a,b) {
    return a.getTime() < b.getTime();
  }
  function isBetween(d,start,end) {
    return d.getTime() > start.getTime() && d.getTime() < end.getTime();
  }
  function getDaysInMonth(y,m) {
    return new Date(y, m+1, 0).getDate();
  }

  let __scrollY = 0;
  let __lockActive = false;

  function lockBody(lock) {
    if (lock) {
      if (__lockActive) return;
      __lockActive = true;

      __scrollY = window.scrollY || window.pageYOffset || 0;

      document.documentElement.classList.add("modal-open");
      document.body.classList.add("modal-open");

      document.body.style.position = "fixed";
      document.body.style.top = `-${__scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";

      window.__keepScrollLocked = () => {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      };
      window.addEventListener("scroll", window.__keepScrollLocked, { passive: false });

      window.__preventTouchMove = (e) => {
        const allow =
          e.target.closest("#mobile-destination-list") ||
          e.target.closest("#mobile-calendar-container");
        if (allow) return;
        e.preventDefault();
      };
      document.addEventListener("touchmove", window.__preventTouchMove, { passive: false });

      window.__preventWheel = (e) => {
        const allow =
          e.target.closest("#mobile-destination-list") ||
          e.target.closest("#mobile-calendar-container");
        if (allow) return;
        e.preventDefault();
      };
      document.addEventListener("wheel", window.__preventWheel, { passive: false });

      window.scrollTo(0, 0);

    } else {
      if (!__lockActive) return;
      __lockActive = false;

      window.removeEventListener("scroll", window.__keepScrollLocked);
      document.removeEventListener("touchmove", window.__preventTouchMove);
      document.removeEventListener("wheel", window.__preventWheel);

      delete window.__keepScrollLocked;
      delete window.__preventTouchMove;
      delete window.__preventWheel;

      document.documentElement.classList.remove("modal-open");
      document.body.classList.remove("modal-open");

      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";

      window.scrollTo(0, __scrollY);
    }
  }
  
  function openModal(modalEl) {
    modalEl.classList.add("is-open");
    lockBody(true);
  }
  function closeModal(modalEl) {
    modalEl.classList.remove("is-open");
    if (!destModal.classList.contains("is-open") && !dateModal.classList.contains("is-open")) {
      lockBody(false);
    }
  }

  function bindMobileOpen(el, fn) {
    if (!el) return;

    const open = (e) => {
      if (!isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      fn(e);
   };

    el.addEventListener("touchstart", open, { passive: false });
    el.addEventListener("pointerdown", open, { passive: false });

    el.addEventListener("click", (e) => {
      if (!isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  }

  /* -----------------
     HERO DISPLAY SYNC
  -------------------- */
  function syncHeroDestination(label, slug) {
    if (!heroDestInput) return;
    heroDestInput.value = label || "";
    heroDestInput.style.fontWeight = label ? "600" : "400";

    if (slug) heroDestInput.dataset.slug = slug;
    else delete heroDestInput.dataset.slug;

    if (heroDestPlaceholder) heroDestPlaceholder.style.opacity = label ? "0" : "1";
  }

  function formatMobileRangeLabel(start, end) {
    if (!start) return "";
    const fmt = (d) => d.toLocaleString("en-US", { month: "short", day: "numeric" });
    return end ? `${fmt(start)} – ${fmt(end)}` : `${fmt(start)}`;
  }

  function syncHeroDates() {
    if (!heroDateInput) return;

    if (!window.startDate) {
      heroDateInput.value = "";
      if (heroDatePlaceholder) {
        heroDatePlaceholder.style.opacity = "1";
        heroDatePlaceholder.textContent = "Add departure dates";
      }
      return;
    }

    const lbl = formatMobileRangeLabel(window.startDate, window.endDate);
    heroDateInput.value = lbl;
    if (heroDatePlaceholder) heroDatePlaceholder.style.opacity = "0";
  }

  /* ----------------
     DESTINATION MODAL
  ------------------- */
  let mobileDestinations = [];
  let mobileVisibleDestinations = [];

  function renderMobileDestinationOptions(items) {
    mobileVisibleDestinations = items.slice(0, 20);
    destList.innerHTML = renderDestinationOptionsHTML(mobileVisibleDestinations);
  }

  function filterDest(query) {
    const matches = getDestinationMatches(mobileDestinations, query, 20);
    renderMobileDestinationOptions(matches);
  }

  function openDestinationModal(e) {
    openModal(destModal);

    destInput.value = heroDestInput?.value || "";

    loadDestinations()
      .then(items => {
        mobileDestinations = items;
        filterDest(destInput.value);
      })
      .catch(() => {
        destList.innerHTML = "";
      });

    syncMobileDestPlaceholder();
    updateMobileDestClearVisibility();

    destInput.removeAttribute("readonly");
    destInput.tabIndex = 0;

    destModal.getBoundingClientRect();

    destInput.focus();

    setTimeout(() => {
      try {
        destInput.setSelectionRange(destInput.value.length, destInput.value.length);
      } catch (err) {}
    }, 0);
  }
  
  function syncMobileDestPlaceholder() {
    if (!destPlaceholderEl) return;
    const hasText = (destInput.value || "").trim().length > 0;
    destPlaceholderEl.style.opacity = hasText ? "0" : "1";
  }
  
  function updateMobileDestClearVisibility() {
    if (!destClear) return;
    const hasValue = (destInput.value || "").trim().length > 0;
    destClear.classList.toggle("visible", hasValue);
  }

  destInput.addEventListener("input", () => {
    syncMobileDestPlaceholder();
    updateMobileDestClearVisibility();
    filterDest(destInput.value);
  });

  destList.addEventListener("click", (e) => {
    const opt = e.target.closest(".destination-option");
    if (!opt) return;

    const label = opt.dataset.label || opt.querySelector(".destination-text")?.textContent?.trim() || "";
    const slug  = opt.dataset.slug || "";

    syncHeroDestination(label, slug);
    
    destInput.value = label;
    syncMobileDestPlaceholder();
    updateMobileDestClearVisibility();

    closeModal(destModal);
    openDateModal(); 
  });

  if (destClose) destClose.addEventListener("click", () => closeModal(destModal));

  /* ----------
     DATE MODAL
  ------------- */
  let pendingStart = null;
  let pendingEnd   = null;

  function updateMobileApplyState() {
    if (!dateApply) return;

    const hasSelection = !!pendingStart;

    dateApply.disabled = !hasSelection;
    dateApply.classList.toggle("is-active", hasSelection);
    
    dateApply.style.pointerEvents = hasSelection ? "auto" : "none";

  }
  
  function todayDateOnly() {
    const t = new Date();
    t.setHours(0,0,0,0);
    return t;
  }

  function setPendingFromGlobal() {
    pendingStart = window.startDate ? toDateOnly(window.startDate) : null;
    pendingEnd   = window.endDate ? toDateOnly(window.endDate) : null;
  }

  function commitPendingToGlobal() {
    window.startDate = pendingStart ? toDateOnly(pendingStart) : null;
    window.endDate   = pendingEnd ? toDateOnly(pendingEnd) : null;
  }

  function renderMobileCalendar24Months() {
    const today = todayDateOnly();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    calContainer.innerHTML = "";

    for (let i = 0; i < 24; i++) {
      const monthDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);

      const monthEl = document.createElement("div");
      monthEl.className = "date-month";

      const header = document.createElement("div");
      header.className = "date-month-header";

      const left = document.createElement("div");
      left.className = "date-nav-slot";
      const right = document.createElement("div");
      right.className = "date-nav-slot";

      const title = document.createElement("div");
      title.className = "date-month-title";
      title.textContent = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

      header.appendChild(left);
      header.appendChild(title);
      header.appendChild(right);
      monthEl.appendChild(header);

      const wdRow = document.createElement("div");
      wdRow.className = "date-weekdays";
      weekdayNames.forEach(w => {
        const wd = document.createElement("div");
        wd.textContent = w;
        wdRow.appendChild(wd);
      });
      monthEl.appendChild(wdRow);

      const grid = document.createElement("div");
      grid.className = "date-days-grid";

      const firstDayIndex = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
      const totalDays = getDaysInMonth(monthDate.getFullYear(), monthDate.getMonth());

      for (let b = 0; b < firstDayIndex; b++) {
        grid.appendChild(document.createElement("div"));
      }

      for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement("div");
        const btn  = document.createElement("button");
        btn.className = "date-day";
        btn.type = "button";
        btn.textContent = day;

        btn.addEventListener("mousedown", (e) => e.preventDefault());

        const dateObj = toDateOnly(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));

        if (isBefore(dateObj, today)) {
          btn.classList.add("is-disabled");
        } else {
        }

        if (pendingStart && isSameDay(dateObj, pendingStart)) {
          btn.classList.add("is-start");
          cell.classList.add("is-start-range");
        }
        if (pendingEnd && isSameDay(dateObj, pendingEnd)) {
          btn.classList.add("is-end");
          cell.classList.add("is-end-range");
        }
        if (pendingStart && pendingEnd && isBetween(dateObj, pendingStart, pendingEnd)) {
          cell.classList.add("is-in-range");
        }

        cell.appendChild(btn);
        grid.appendChild(cell);
      }

      // Click handling
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("button.date-day");
        if (!btn || btn.classList.contains("is-disabled")) return;

        const dayNum = parseInt(btn.textContent, 10);
        const clicked = toDateOnly(new Date(monthDate.getFullYear(), monthDate.getMonth(), dayNum));

        // RANGE LOGIC
        if (!pendingStart || (pendingStart && pendingEnd)) {
          pendingStart = clicked;
          pendingEnd = null;
        } else if (pendingStart && !pendingEnd) {
          if (isBefore(clicked, pendingStart) || isSameDay(clicked, pendingStart)) {
            pendingStart = clicked;
            pendingEnd = null;
          } else {
            pendingEnd = clicked;
          }
        }

        renderMobileCalendar24Months();
        updateMobileApplyState();
      });

      monthEl.appendChild(grid);
      calContainer.appendChild(monthEl);
    }
  }

  function openDateModal() {
    openModal(dateModal);
    setPendingFromGlobal();
    renderMobileCalendar24Months();
    updateMobileApplyState();
  }

  if (dateClose) dateClose.addEventListener("click", () => closeModal(dateModal));

  if (dateApply) {
    dateApply.addEventListener("click", () => {
      commitPendingToGlobal();
      syncHeroDates();
      closeModal(dateModal);
    });
  }

  /* -------------------------
     HERO → OPEN MODALS
  ------------------------- */
  bindMobileOpen(heroDestArea, openDestinationModal);
  bindMobileOpen(heroDestInput, openDestinationModal);

  bindMobileOpen(heroDateArea, openDateModal);
  bindMobileOpen(heroDateInput, openDateModal);

})();
  
  
  
  /* =====================
     SEARCH BAR CONTROLLER
 	 ===================== */
  if (document.querySelector(".search-bar")) {
  
  /******************
 * DESTINATION PICKER
 ********************/
const searchBars = document.querySelectorAll(".search-bar");
searchBars.forEach(initDestinationPicker);

function initDestinationPicker(searchBar) {
  if (searchBar.closest(".header-wrapper") &&
      !searchBar.closest(".header-search-editor")) {
    return;
  }

  const input = searchBar.querySelector("#destination-input");
  const area = searchBar.querySelector("#destination-area");
  const dropdown = searchBar.querySelector("#destination-dropdown");
  const listEl = dropdown?.querySelector(".destination-options-list") || dropdown;
  const placeholder = searchBar.querySelector("#destination-placeholder");
  const clearBtn = searchBar.querySelector("#destination-clear");

  if (!input || !area || !dropdown || !listEl) return;

  let didPortal = false;
  let activeIndex = -1;
  let allDestinations = [];

  function portalDestinationDropdown() {
    if (window.innerWidth <= 479) return;
    if (didPortal) return;
    if (!dropdown) return;

    dropdown.setAttribute("data-portaled", "true");
    document.body.appendChild(dropdown);
    didPortal = true;
  }

  function positionDestinationDropdown() {
    const fieldRect = area.getBoundingClientRect();

    dropdown.style.position = "fixed";
    dropdown.style.top = `${fieldRect.bottom + 12}px`;
    dropdown.style.left = `${fieldRect.left}px`;
    dropdown.style.width = `${Math.round(fieldRect.width * 1.5)}px`;
  }

  function startTrackingDestinationDropdownPosition() {
    positionDestinationDropdown();
    window.addEventListener("scroll", positionDestinationDropdown, { passive: true });
    window.addEventListener("resize", positionDestinationDropdown);
  }

  function stopTrackingDestinationDropdownPosition() {
    window.removeEventListener("scroll", positionDestinationDropdown);
    window.removeEventListener("resize", positionDestinationDropdown);
  }

  function getVisibleOptions() {
    return Array.from(listEl.querySelectorAll(".destination-option"));
  }

  function updateDestinationClearVisibility() {
    if (!clearBtn) return;

    const hasValue = input.value.trim().length > 0;
    const dropdownOpen = window.getComputedStyle(dropdown).display !== "none";

    if (hasValue && dropdownOpen) clearBtn.classList.add("visible");
    else clearBtn.classList.remove("visible");
  }

  function updateActiveOption() {
    const visibleOptions = getVisibleOptions();
    visibleOptions.forEach(o => o.classList.remove("is-active"));

    if (activeIndex >= 0 && visibleOptions[activeIndex]) {
      const item = visibleOptions[activeIndex];
      item.classList.add("is-active");
      item.scrollIntoView({ block: "nearest" });
    }
  }

  function closeDestinationDropdown(reason = "") {
    dropdown.style.display = "none";
    activeIndex = -1;
    updateActiveOption();
    updateDestinationClearVisibility();
    stopTrackingDestinationDropdownPosition();
  }

  function openSiblingDatepicker() {
    searchBar?.openDatepicker?.();
  }

  function renderResults(items) {
    listEl.innerHTML = renderDestinationOptionsHTML(items);
    activeIndex = -1;
    updateActiveOption();
  }

  function filterDestinations(query) {
    const matches = getDestinationMatches(allDestinations, query, 10);
    renderResults(matches);
    dropdown.style.display = matches.length ? "block" : "none";
    updateDestinationClearVisibility();
  }

  function selectOption(option) {
    if (!option) return;

    input.value = option.dataset.label || "";
    input.dataset.slug = option.dataset.slug || "";
    input.style.fontWeight = "600";

    if (placeholder) placeholder.style.opacity = "0";

    if (isMobile()) {
      return;
    }

    closeDestinationDropdown("select");
    openSiblingDatepicker();
  }

  listEl.addEventListener("click", (e) => {
    const option = e.target.closest(".destination-option");
    if (!option) return;
    e.stopPropagation();
    selectOption(option);
  });

  (function hydrateDestinationFromURL() {
    const params = new URLSearchParams(window.location.search);
    const dest = params.get("destination");

    loadDestinations()
      .then(items => {
        allDestinations = items;
        renderResults(allDestinations.slice(0, 10));

        if (dest && dest !== "anywhere") {
          const match = allDestinations.find(item => item.slug === dest);
          if (match) {
            input.value = match.name;
            input.dataset.slug = match.slug;
            input.style.fontWeight = "600";
            placeholder && (placeholder.style.opacity = "0");
          }
        }

        updateDestinationClearVisibility();
      })
      .catch(() => {
        listEl.innerHTML = "";
      });
  })();

  area.addEventListener("click", (e) => {
    if (isMobile()) return;

    e.stopPropagation();

    scrollSearchBarIntoView(searchBar);

    searchBar.openDestinationDropdown();
    input.removeAttribute("readonly");
    input.focus({ preventScroll: true });

    if (allDestinations.length) {
      filterDestinations(input.value);
    } else {
      loadDestinations().then(items => {
        allDestinations = items;
        filterDestinations(input.value);
      });
    }
  });

  input.addEventListener("input", () => {
    if (placeholder) placeholder.style.opacity = input.value.length > 0 ? 0 : 1;
    input.style.fontWeight = input.value.length > 0 ? "600" : "400";

    activeIndex = -1;
    updateDestinationClearVisibility();
    filterDestinations(input.value);
  });

  input.addEventListener("keydown", (e) => {
    const visibleOptions = getVisibleOptions();
    if (!visibleOptions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % visibleOptions.length;
      updateActiveOption();
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + visibleOptions.length) % visibleOptions.length;
      updateActiveOption();
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();

      if (activeIndex >= 0 && visibleOptions[activeIndex]) {
        selectOption(visibleOptions[activeIndex]);
      }
    }

    if (e.key === "Escape") {
      closeDestinationDropdown("escape");
    }
  });

  document.addEventListener("click", (e) => {
    if (!area.contains(e.target) && !dropdown.contains(e.target)) {
      closeDestinationDropdown("outside");
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      input.value = "";
      delete input.dataset.slug;
      input.style.fontWeight = "400";

      if (placeholder) placeholder.style.opacity = "1";
      clearBtn.classList.remove("visible");

      if (allDestinations.length) {
        renderResults(allDestinations.slice(0, 10));
      }

      dropdown.style.display = "block";
      updateDestinationClearVisibility();
    });
  }

  searchBar.openDestinationDropdown = function () {
    if (isMobile()) return;
    searchBar.closeDatepicker?.();

    portalDestinationDropdown();

    dropdown.style.position = "fixed";
    dropdown.style.inset = "auto";
    dropdown.style.bottom = "auto";
    dropdown.style.right = "auto";
    dropdown.style.transform = "none";
    dropdown.style.display = "block";

    startTrackingDestinationDropdownPosition();
    updateDestinationClearVisibility();

    if (allDestinations.length) {
      filterDestinations(input.value);
    }
  };
}
  
/*************
 * DATE PICKER
 *************/
document.querySelectorAll(".search-bar").forEach(initDatePicker);

function initDatePicker(searchBar) {
  const mobile = () => window.innerWidth <= 479;
  
  const area        = searchBar.querySelector("#date-area");
  const input       = searchBar.querySelector("#date-input");
  const dropdown    = searchBar.querySelector("#date-dropdown");
  
  let didPortal = false;

  function portalDropdownToBody() {
    if (didPortal) return;
    if (!dropdown) return;

    dropdown.setAttribute("data-portaled", "true");
    document.body.appendChild(dropdown);

    didPortal = true;
  }
  
  const container   = searchBar.querySelector("#calendar-container");
  const placeholder = searchBar.querySelector("#date-placeholder");

  if (!area || !input || !dropdown || !container) return;

const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const shortMonths = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
];
const weekdayNames = ["S","M","T","W","T","F","S"];

let today = new Date();
today.setHours(0,0,0,0);

let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
let startDate = window.startDate || null;
let endDate = window.endDate || null;
let hoverDate = window.hoverDate || null;

function toDateOnly(d) {
  const nd = new Date(d);
  nd.setHours(0,0,0,0);
  return nd;
}
function isSameDay(a,b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
function isBefore(a,b) {
  return a.getTime() < b.getTime();
}
function isBetween(d,start,end) {
  return d.getTime() > start.getTime() && d.getTime() < end.getTime();
}
function getDaysInMonth(y,m) {
  return new Date(y, m+1, 0).getDate();
}

function formatRangeLabel(start, end) {
  if (!start && !end) return "";

  const sM = shortMonths[start.getMonth()];
  const sD = start.getDate();

  if (!end) return `${sM} ${sD}`;

  const eM = shortMonths[end.getMonth()];
  const eD = end.getDate();

  if (start.getMonth() === end.getMonth()) {
    return `${sM} ${sD} – ${eD}`;
  }

  return `${sM} ${sD} – ${eM} ${eD}`;
}
  
let isDateOpen = false;

function positionDateDropdown() {
  // Only position when open
  if (!isDateOpen) return;

  const barRect = searchBar.getBoundingClientRect();
  const fieldRect = area.getBoundingClientRect();

  dropdown.style.position = "fixed";
  dropdown.style.top = `${fieldRect.bottom + 24}px`;
  dropdown.style.left = `${barRect.left}px`;
  dropdown.style.width = `${barRect.width}px`;
}

function startTrackingDropdownPosition() {
  window.addEventListener("scroll", positionDateDropdown, { passive: true });
  window.addEventListener("resize", positionDateDropdown);
}

function stopTrackingDropdownPosition() {
  window.removeEventListener("scroll", positionDateDropdown);
  window.removeEventListener("resize", positionDateDropdown);
}

function openDropdown() {
  if (isMobile()) return;
  
  scrollSearchBarIntoView(searchBar);

  requestAnimationFrame(() => {
    portalDropdownToBody();

    isDateOpen = true;

    dropdown.style.inset = "auto";
    dropdown.style.bottom = "auto";
    dropdown.style.right = "auto";

    dropdown.classList.add("dropdown-open");
    document.body.classList.add("calendar-open");
    bindDateClear();

    positionDateDropdown(true);

    requestAnimationFrame(() => {
      positionDateDropdown(true);
      startTrackingDropdownPosition();
    });
  });
}
  
function bindDateClear() {
  const dateClear = searchBar.querySelector("#date-clear");
  if (!dateClear || dateClear.__bound) return;

  dateClear.__bound = true;

  dateClear.addEventListener("click", (e) => {
    e.stopPropagation();

    window.startDate = null;
    window.endDate   = null;
    window.hoverDate = null;

    renderCalendars();
    updatePlaceholder();
    updateDateClearVisibility();
  });
}

function closeDropdown() {
  isDateOpen = false;
  dropdown.classList.remove("dropdown-open");
  document.body.classList.remove("calendar-open");
  stopTrackingDropdownPosition();
}

// expose instance
searchBar.openDatepicker = function () {
  openDropdown();
  input.focus({ preventScroll: true });
};
  
searchBar.closeDatepicker = function () {
  closeDropdown();
};

function updatePlaceholder() {
  if (!startDate) {
    placeholder.style.opacity = "1";
    placeholder.textContent = "Add departure dates";
    input.value = "";
  } else {
  placeholder.style.opacity = "0";
  const lbl = formatRangeLabel(startDate, endDate);
  placeholder.textContent = lbl;
  input.value = lbl;

  const dateClear = searchBar.querySelector("#date-clear");
  if (dateClear) dateClear.classList.add("visible");
 }
}
  
function updateDateClearVisibility() {
  const clearBtn = searchBar.querySelector("#date-clear");
  if (!clearBtn) return;

  const hasValue = window.startDate !== null;
  const open = dropdown.classList.contains("dropdown-open");

  clearBtn.classList.toggle("visible", hasValue && open);
}

function renderCalendars() {
  startDate = window.startDate;
  endDate = window.endDate;
  hoverDate = window.hoverDate;

  container.innerHTML = "";

  const monthsToRender = mobile() ? 24 : 2;
	for (let i = 0; i < monthsToRender; i++) {
    const monthDate = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + i,
      1
    );

    const monthEl = document.createElement("div");
    monthEl.className = "date-month";

    /* HEADER */
    const header = document.createElement("div");
    header.className = "date-month-header";

    const leftCol = document.createElement("div");
    leftCol.className = "date-nav-slot";

    if (!isMobile() && i === 0) {
      const prevBtn = document.createElement("button");
      prevBtn.className = "date-nav-btn";
      prevBtn.textContent = "‹";
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        visibleMonth = new Date(
          visibleMonth.getFullYear(),
          visibleMonth.getMonth() - 1,
          1
        );
        renderCalendars();
      });
      leftCol.appendChild(prevBtn);
    }

    const title = document.createElement("div");
    title.className = "date-month-title";
    title.textContent =
      `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

    const rightCol = document.createElement("div");
    rightCol.className = "date-nav-slot";

    if (!isMobile() && i === 1) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "date-nav-btn";
      nextBtn.textContent = "›";
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        visibleMonth = new Date(
          visibleMonth.getFullYear(),
          visibleMonth.getMonth() + 1,
          1
        );
        renderCalendars();
      });
      rightCol.appendChild(nextBtn);
    }

    header.appendChild(leftCol);
    header.appendChild(title);
    header.appendChild(rightCol);
    monthEl.appendChild(header);

    /* WEEKDAYS */
    const wdRow = document.createElement("div");
    wdRow.className = "date-weekdays";
    weekdayNames.forEach(w => {
      const wd = document.createElement("div");
      wd.textContent = w;
      wdRow.appendChild(wd);
    });
    monthEl.appendChild(wdRow);

    /* DAYS GRID */
    const grid = document.createElement("div");
    grid.className = "date-days-grid";

    const firstDayIndex =
      new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
    const totalDays =
      getDaysInMonth(monthDate.getFullYear(), monthDate.getMonth());

    /* LEADING BLANKS */
    for (let b = 0; b < firstDayIndex; b++) {
      const blank = document.createElement("div");
      grid.appendChild(blank);
    }

    /* ACTUAL DAYS */
    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement("div");
      const btn  = document.createElement("button");

      btn.className = "date-day";
      btn.textContent = day;
      
btn.addEventListener("mousedown", (e) => e.preventDefault());
btn.addEventListener("focus", (e) => e.target.blur());

      const thisDate = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        day
      );
      const dateOnly = toDateOnly(thisDate);

      /* DISABLED DATES */
      const disabled = isBefore(dateOnly, today);
      if (disabled) {
        btn.classList.add("is-disabled");
      } else {
        btn.classList.add("is-hoverable");
      }

/* --- START / END SELECTION --- */
if (startDate && isSameDay(dateOnly, startDate)) {
    btn.classList.add("is-start");
    cell.classList.add("is-start-range");

    // Selected start date should NOT hover
    btn.classList.remove("is-hoverable");
}

if (endDate && isSameDay(dateOnly, endDate)) {
    btn.classList.add("is-end");
    cell.classList.add("is-end-range");

    // Selected end date should NOT hover
    btn.classList.remove("is-hoverable");
}

/* --- RANGE --- */
if (startDate && endDate && isBetween(dateOnly, startDate, endDate)) {
    cell.classList.add("is-in-range");
}

/* --- HOVER PREVIEW RANGE --- */
if (startDate && !endDate && hoverDate) {
    const min = startDate < hoverDate ? startDate : hoverDate;
    const max = startDate > hoverDate ? startDate : hoverDate;

    // Preview middle
    if (isBetween(dateOnly, min, max)) {
        cell.classList.add("is-preview-range");
    }

    // Preview start
    if (isSameDay(dateOnly, startDate)) {
        cell.classList.add("is-preview-start");
    }

    // Preview end
    if (isSameDay(dateOnly, hoverDate)) {
        cell.classList.add("is-hover-end");
        cell.classList.add("is-preview-end");  // REQUIRED for correct grey extension
    }
}

      cell.appendChild(btn);
      grid.appendChild(cell);
    }

    grid.addEventListener("click", (e) => {
  e.stopPropagation();  // <-- prevents the dropdown from closing

  const btn = e.target.closest("button.date-day");
  if (!btn) return;
  if (btn.classList.contains("is-disabled")) return;

      const day = parseInt(btn.textContent, 10);
      const dateObj = toDateOnly(
        new Date(monthDate.getFullYear(), monthDate.getMonth(), day)
      );

      handleDateClick(dateObj);
    });

    if (!isMobile()) {
  		grid.addEventListener("mousemove", (e) => {
   		 const btn = e.target.closest("button.date-day");
   		 if (!btn) return;
  	     if (!startDate || endDate) return;
	     if (btn.classList.contains("is-disabled")) return;

   		 const day = parseInt(btn.textContent, 10);
   		 hoverDate = toDateOnly(
   		   new Date(monthDate.getFullYear(), monthDate.getMonth(), day)
  	     );

  	  renderCalendars();
  	 });
	}

    grid.addEventListener("mouseleave", () => {
      if (hoverDate) {
        hoverDate = null;
        renderCalendars();
      }
    });

    monthEl.appendChild(grid);
    container.appendChild(monthEl);
  }
  
}
  
  (function hydrateDatesFromURL() {
    const params = new URLSearchParams(window.location.search);

    const start = params.get("start");
    const end   = params.get("end");

    if (!start) return;

    const s = parseDateOnly(start);
    if (isNaN(s)) return;

    window.startDate = new Date(
      s.getFullYear(),
      s.getMonth(),
      s.getDate()
    );

    if (end) {
      const e = parseDateOnly(end);
      if (!isNaN(e)) {
        window.endDate = new Date(
          e.getFullYear(),
          e.getMonth(),
          e.getDate()
        );
      }
    } else {
      window.endDate = null;
    }

    window.hoverDate = null;

    renderCalendars();
    updatePlaceholder();
  })();

function handleDateClick(dateObj) {
  if (!startDate || (startDate && endDate)) {
    window.startDate = startDate = dateObj;
    window.endDate   = endDate = null;
    window.hoverDate = hoverDate = null;
  }

  else if (startDate && !endDate) {
    if (isBefore(dateObj, startDate) || isSameDay(dateObj, startDate)) {
      window.startDate = startDate = dateObj;
      window.endDate   = endDate = null;
      window.hoverDate = hoverDate = null;
    } else {
      window.endDate   = endDate = dateObj;
      window.hoverDate = hoverDate = null;
    }
  }

  renderCalendars();
  updatePlaceholder();
  updateDateClearVisibility();
}

area.addEventListener("click", (e) => {
  if (isMobile()) return;

  e.stopPropagation();
  openDropdown();
  updateDateClearVisibility();
});

input.addEventListener("focus", () => {
  if (isMobile()) return;
  openDropdown();
  updateDateClearVisibility();
});
  
document.addEventListener("click", function (e) {
  if (!searchBar.contains(e.target)) {
    closeDropdown();
    updateDateClearVisibility();
  }
});

window.renderCalendars = renderCalendars;
window.updateDatePlaceholder = updatePlaceholder;
  
renderCalendars();
updatePlaceholder();
bindDateClear();

}

function buildSearchUrlFromBar(searchBar) {
  const params = new URLSearchParams();

  const destInput = searchBar.querySelector("#destination-input");
  if (destInput && destInput.dataset.slug) {
    params.set("destination", destInput.dataset.slug);
  }

  if (window.startDate instanceof Date) {
    params.set("start", window.startDate.toISOString().split("T")[0]);
  }

  if (window.endDate instanceof Date) {
    params.set("end", window.endDate.toISOString().split("T")[0]);
  }

  const qs = params.toString();
  return "/cruises" + (qs ? `?${qs}` : "");
}


/***********************
 * MOBILE SEARCH SUBMIT
 ***********************/
(function bindMobileHeroSubmit() {
  const modalSourceBar =
    document.querySelector(".home-page-hero .search-bar") ||
    document.querySelector(".header-search-editor .search-bar");

  if (!modalSourceBar) return;

  const btn = modalSourceBar.querySelector(".search-button-mobile, .mobile-search-editor-button");
  if (!btn) {
    console.warn("[mobile submit] .search-button-mobile not found");
    return;
  }

  if (btn.__bound) return;
  btn.__bound = true;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const params = new URLSearchParams();

    // Destination
    const destInput = modalSourceBar.querySelector("#destination-input");
    if (destInput && destInput.dataset.slug) {
      params.set("destination", destInput.dataset.slug);
    }

    // Dates
    if (window.startDate instanceof Date) {
      params.set("start", window.startDate.toISOString().split("T")[0]);
    }
    if (window.endDate instanceof Date) {
      params.set("end", window.endDate.toISOString().split("T")[0]);
    }

    const qs = params.toString();
    window.location.href = "/cruise-search" + (qs ? `?${qs}` : "");
  });
})();
    
/***********************
 * SEARCH SUBMIT
 ***********************/
document.querySelectorAll(".search-bar").forEach(searchBar => {
  const searchBtn = searchBar.querySelector("[data-search-submit]");
  if (!searchBtn) return;

  searchBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();

    const params = new URLSearchParams();

    const destInput = searchBar.querySelector("#destination-input");
    if (destInput && destInput.dataset.slug) {
      params.set("destination", destInput.dataset.slug);
    }

    if (window.startDate instanceof Date) {
      params.set("start", window.startDate.toISOString().split("T")[0]);
    }

    if (window.endDate instanceof Date) {
      params.set("end", window.endDate.toISOString().split("T")[0]);
    }

    // ✅ ALWAYS include default sort
    params.set("sort", "recommended");

    const qs = params.toString();
    window.location.href = "/cruise-search" + (qs ? `?${qs}` : "");
  });
});

}

});