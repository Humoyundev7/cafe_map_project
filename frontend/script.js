const API_BASE = "/api";

let places = [];
let ratingsSummary = {};
let isManagerLoggedIn = false;
let isAdmin = false;
let managerToken = null;
let managerPlaceId = null;

let userLocation = null;
let nearMeActive = false;
let favoritesOnly = false;
let favorites = new Set();

let currentBookingPlaceId = null;
let currentRatingPlaceId = null;

let map;
let clusterer;
let mapMarkers = {};
let userMarker = null;
let currentRoute = null;
let currentRoutePlace = null;

let gpsWatchId = null;          // live GPS tracking
let markerAnimationId = null;   // for smooth animation
let lastUserMarkerCoords = null;

let routeMode = "walk";         // "walk" or "drive"

// DOM elements
const userTab = document.getElementById("user-tab");
const managerTab = document.getElementById("manager-tab");
const userView = document.getElementById("user-view");
const managerView = document.getElementById("manager-view");

const typeFilter = document.getElementById("type-filter");
const userPlacesContainer = document.getElementById("user-places");

const loginSection = document.getElementById("login-section");
const managerSection = document.getElementById("manager-section");
const adminSection = document.getElementById("admin-section");

const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const managerPlacesContainer = document.getElementById("manager-places");
const managerBookingsContainer = document.getElementById("manager-bookings");
const adminOverviewContainer = document.getElementById("admin-overview");

const nearMeBtn = document.getElementById("near-me-btn");
const clearNearMeBtn = document.getElementById("clear-near-me-btn");
const favoritesToggleBtn = document.getElementById("favorites-toggle");

// NEW route controls
const walkBtn = document.getElementById("route-walk-btn");
const driveBtn = document.getElementById("route-drive-btn");
const routeEta = document.getElementById("route-eta");
const focusMeBtn = document.getElementById("focus-me-btn");

// Modals
const modalBackdrop = document.getElementById("modal-backdrop");

// Booking modal
const bookingModal = document.getElementById("booking-modal");
const bookingForm = document.getElementById("booking-form");
const bookingNameInput = document.getElementById("booking-name");
const bookingPeopleInput = document.getElementById("booking-people");
const bookingTimeInput = document.getElementById("booking-time");
const bookingCancelBtn = document.getElementById("booking-cancel");

// Rating modal
const ratingModal = document.getElementById("rating-modal");
const ratingForm = document.getElementById("rating-form");
const ratingSelect = document.getElementById("rating-select");
const statusSelect = document.getElementById("status-select");
const ratingNameInput = document.getElementById("rating-name");
const ratingCommentInput = document.getElementById("rating-comment");
const ratingHistoryContainer = document.getElementById("rating-history");
const ratingCancelBtn = document.getElementById("rating-cancel");

// ---------- FAVORITES ----------
function loadFavorites() {
  const raw = localStorage.getItem("favorites");
  if (raw) {
    try {
      favorites = new Set(JSON.parse(raw));
    } catch {
      favorites = new Set();
    }
  }
}
function saveFavorites() {
  localStorage.setItem("favorites", JSON.stringify([...favorites]));
}

// ---------- TAB SWITCH ----------
userTab.addEventListener("click", () => {
  userTab.classList.add("active");
  managerTab.classList.remove("active");
  userView.classList.remove("hidden");
  managerView.classList.add("hidden");
});

managerTab.addEventListener("click", () => {
  managerTab.classList.add("active");
  userTab.classList.remove("active");
  managerView.classList.remove("hidden");
  userView.classList.add("hidden");
});

// ---------- FETCH PLACES + RATINGS ----------
async function loadPlacesAndRatings() {
  try {
    const [resPlaces, resRatings] = await Promise.all([
      fetch(`${API_BASE}/places`),
      fetch(`${API_BASE}/ratings/summary`),
    ]);

    places = await resPlaces.json();
    const summaryArr = await resRatings.json();

    ratingsSummary = {};
    summaryArr.forEach((r) => {
      ratingsSummary[r.place_id] = r;
    });

    renderUserPlaces();
    loadMarkersOnMap();

    if (isManagerLoggedIn && !isAdmin) {
      renderManagerPlaces();
      await loadManagerBookings();
    }
    if (isAdmin) {
      await loadAdminOverview();
    }
  } catch (err) {
    console.error("Failed to load data", err);
  }
}

// ---------- RENDER USER PLACES ----------
function renderUserPlaces() {
  const filter = typeFilter.value;

  let filtered = places.filter((p) =>
    filter === "all" ? true : p.type === filter
  );

  if (favoritesOnly) {
    filtered = filtered.filter((p) => favorites.has(p.id));
  }

  if (nearMeActive && userLocation) {
    filtered = filtered
      .map((p) => ({
        ...p,
        distance_km: distanceKm(
          userLocation.lat,
          userLocation.lon,
          p.lat,
          p.lon
        ),
      }))
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  if (!filtered.length) {
    userPlacesContainer.innerHTML = "<p>No places found.</p>";
    return;
  }

  userPlacesContainer.innerHTML = filtered
    .map((place) => {
      const sum = ratingsSummary[place.id];
      const ratingHTML = sum
        ? `⭐ ${sum.avg_rating.toFixed(1)} (${sum.rating_count})`
        : "No rating";

      const statusHTML = sum?.last_status
        ? sum.last_status === "busy"
          ? "🔥 Busy"
          : sum.last_status === "free"
          ? "🟢 Free"
          : "🙂 Normal"
        : "";

      const distHTML =
        nearMeActive && place.distance_km !== undefined
          ? `<div class="distance">📍 ${place.distance_km.toFixed(
              1
            )} km</div>`
          : "";

      const favClass = favorites.has(place.id) ? "fav-on" : "";

      return `
      <div class="place-card" data-place-id="${place.id}">
        <div class="place-card-header">
          <h3>${place.name}</h3>
          <button class="fav-btn ${favClass}" data-place-id="${place.id}">
            ★
          </button>
        </div>

        <div class="place-type">${place.type}</div>
        <div class="place-address">${place.address}</div>
        <div class="place-seats">
          Seats: ${place.free_seats}/${place.total_seats}
        </div>
        <div class="rating-row">
          <span>${ratingHTML}</span>
          <span class="crowd-label">${statusHTML}</span>
        </div>
        ${distHTML}

        <div class="card-actions">
          <button class="book-btn" data-place-id="${place.id}">Book</button>
          <button class="rate-btn" data-place-id="${place.id}">
            Rate / I'm here
          </button>
        </div>
      </div>`;
    })
    .join("");

  // Card click → center + route
  document.querySelectorAll(".place-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = Number(card.dataset.placeId);
      const place = places.find((p) => p.id === id);
      const marker = mapMarkers[id];

      if (place && marker) {
        map.setCenter([place.lat, place.lon], 16, { duration: 300 });
        marker.balloon.open();
      }
      if (userLocation) {
        showRouteToPlace(place);
      }
    });
  });

  // Book button
  document.querySelectorAll(".book-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openBookingModal(Number(btn.dataset.placeId));
    })
  );

  // Rate button
  document.querySelectorAll(".rate-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRatingModal(Number(btn.dataset.placeId));
    })
  );

  // Favorite toggle
  document.querySelectorAll(".fav-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.placeId);
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      saveFavorites();
      renderUserPlaces();
    })
  );
}

typeFilter.addEventListener("change", renderUserPlaces);
favoritesToggleBtn.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  favoritesToggleBtn.classList.toggle("active-btn", favoritesOnly);
  renderUserPlaces();
});

// ---------- ROUTE MODE TOGGLE + ETA ----------
if (walkBtn && driveBtn) {
  walkBtn.addEventListener("click", () => {
    routeMode = "walk";
    walkBtn.classList.add("active-btn");
    driveBtn.classList.remove("active-btn");
    updateRouteEta();
  });

  driveBtn.addEventListener("click", () => {
    routeMode = "drive";
    driveBtn.classList.add("active-btn");
    walkBtn.classList.remove("active-btn");
    updateRouteEta();
  });
}

function updateRouteEta() {
  if (!routeEta) return;

  if (!userLocation || !currentRoutePlace) {
    routeEta.textContent = "No route selected";
    return;
  }

  const distKm = distanceKm(
    userLocation.lat,
    userLocation.lon,
    currentRoutePlace.lat,
    currentRoutePlace.lon
  );

  const walkingSpeed = 4.5; // km/h
  const drivingSpeed = 25;  // km/h (city)

  const walkMin = Math.round((distKm / walkingSpeed) * 60);
  const driveMin = Math.round((distKm / drivingSpeed) * 60);

  if (routeMode === "walk") {
    routeEta.textContent = `🚶 ~${walkMin} min (${distKm.toFixed(1)} km)`;
  } else {
    routeEta.textContent = `🚗 ~${driveMin} min (${distKm.toFixed(1)} km)`;
  }
}

// ---------- LOGIN ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username-input").value.trim();
  const password = document.getElementById("password-input").value.trim();

  try {
    const res = await fetch(`${API_BASE}/manager/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      alert("Wrong login");
      return;
    }

    const data = await res.json();
    managerToken = data.token;
    managerPlaceId = data.place_id;
    isAdmin = data.is_admin;
    isManagerLoggedIn = true;

    loginSection.classList.add("hidden");
    logoutBtn.classList.remove("hidden");

    if (isAdmin) {
      adminSection.classList.remove("hidden");
      await loadAdminOverview();
    } else {
      managerSection.classList.remove("hidden");
      await renderManagerPlaces();
      await loadManagerBookings();
    }
  } catch (err) {
    console.error(err);
    alert("Login failed");
  }
});

logoutBtn.addEventListener("click", () => {
  isAdmin = false;
  isManagerLoggedIn = false;
  managerToken = null;
  managerPlaceId = null;

  adminSection.classList.add("hidden");
  managerSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
  logoutBtn.classList.add("hidden");
});

// ---------- MANAGER ----------
function renderManagerPlaces() {
  const p = places.find((p) => p.id === managerPlaceId);
  if (!p) {
    managerPlacesContainer.innerHTML = "Not found";
    return;
  }

  managerPlacesContainer.innerHTML = `
    <div class="place-card">
      <h3>${p.name}</h3>
      <p>Total seats: ${p.total_seats}</p>
      <label>
        Free seats:
        <input type="number"
          class="manager-input"
          min="0"
          max="${p.total_seats}"
          value="${p.free_seats}">
      </label>
      <button class="save-btn">Save</button>
    </div>
  `;

  document.querySelector(".save-btn").addEventListener("click", async () => {
    const val = Number(document.querySelector(".manager-input").value);

    try {
      const res = await fetch(`${API_BASE}/places/${p.id}/seats`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Manager-Token": managerToken,
        },
        body: JSON.stringify({ free_seats: val }),
      });

      if (!res.ok) {
        alert("Error updating seats");
        return;
      }

      await loadPlacesAndRatings();
    } catch (err) {
      console.error(err);
      alert("Error updating seats");
    }
  });
}

async function loadManagerBookings() {
  if (!managerPlaceId || !managerToken) return;

  try {
    const res = await fetch(
      `${API_BASE}/places/${managerPlaceId}/bookings`,
      { headers: { "X-Manager-Token": managerToken } }
    );
    if (!res.ok) {
      managerBookingsContainer.innerHTML = "Error loading bookings";
      return;
    }
    const bookings = await res.json();

    if (!bookings.length) {
      managerBookingsContainer.innerHTML = "No bookings";
      return;
    }

    managerBookingsContainer.innerHTML = bookings
      .map(
        (b) => `
      <div class="booking-card">
        <b>${b.name}</b> (${b.people})<br>
        Time: ${b.time}<br>
        Status: ${b.status}
      </div>
    `
      )
      .join("");
  } catch (err) {
    console.error(err);
    managerBookingsContainer.innerHTML = "Error loading bookings";
  }
}

// ---------- ADMIN ----------
async function loadAdminOverview() {
  try {
    const [pRes, rRes, bRes] = await Promise.all([
      fetch(`${API_BASE}/places`),
      fetch(`${API_BASE}/ratings/summary`),
      fetch(`${API_BASE}/admin/bookings`, {
        headers: { "X-Manager-Token": managerToken },
      }),
    ]);

    const allPlaces = await pRes.json();
    const sums = await rRes.json();
    const allBookings = await bRes.json();

    adminOverviewContainer.innerHTML = `
      <table class="admin-table">
        <tr>
          <th>Name</th><th>Rating</th><th>Seats</th><th>Bookings</th>
        </tr>
        ${allPlaces
          .map((p) => {
            const s = sums.find((x) => x.place_id === p.id);
            const b = allBookings.filter((x) => x.place_id === p.id).length;

            return `
              <tr>
                <td>${p.name}</td>
                <td>${s ? s.avg_rating.toFixed(1) : "-"}</td>
                <td>${p.free_seats}/${p.total_seats}</td>
                <td>${b}</td>
              </tr>
            `;
          })
          .join("")}
      </table>
    `;
  } catch (err) {
    console.error(err);
    adminOverviewContainer.innerHTML = "Error loading admin data";
  }
}

// ---------- BOOKING ----------
function openBookingModal(id) {
  currentBookingPlaceId = id;
  bookingForm.reset();
  bookingModal.classList.remove("hidden");
  modalBackdrop.classList.remove("hidden");
}

bookingCancelBtn.addEventListener("click", () => {
  bookingModal.classList.add("hidden");
  modalBackdrop.classList.add("hidden");
});

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = bookingNameInput.value.trim();
  const people = Number(bookingPeopleInput.value);
  const time = bookingTimeInput.value.trim();

  if (!name || !people || !time) {
    alert("Fill all fields");
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/places/${currentBookingPlaceId}/bookings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, people, time }),
      }
    );

    if (!res.ok) {
      alert("Error creating booking");
      return;
    }

    alert("Booking created!");
    bookingModal.classList.add("hidden");
    modalBackdrop.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Error creating booking");
  }
});

// ---------- RATING ----------
async function openRatingModal(id) {
  currentRatingPlaceId = id;
  ratingForm.reset();
  ratingModal.classList.remove("hidden");
  modalBackdrop.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/places/${id}/ratings`);
    if (!res.ok) {
      ratingHistoryContainer.innerHTML = "Error loading history";
      return;
    }
    const history = await res.json();

    ratingHistoryContainer.innerHTML = history
      .slice(-5)
      .reverse()
      .map(
        (r) => `
      <div class="rating-item">
        <div><b>${r.name || "Anon"}</b> — ⭐${r.rating} — ${r.status}</div>
        <div>${r.comment || ""}</div>
      </div>
    `
      )
      .join("");
  } catch (err) {
    console.error(err);
    ratingHistoryContainer.innerHTML = "Error loading history";
  }
}

ratingCancelBtn.addEventListener("click", () => {
  ratingModal.classList.add("hidden");
  modalBackdrop.classList.add("hidden");
});

ratingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rating = Number(ratingSelect.value);
  const status = statusSelect.value;
  const name = ratingNameInput.value.trim();
  const comment = ratingCommentInput.value.trim();

  if (!rating || !status) {
    alert("Choose rating and status");
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/places/${currentRatingPlaceId}/ratings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, status, name, comment }),
      }
    );

    if (!res.ok) {
      alert("Error sending rating");
      return;
    }

    alert("Thanks!");
    ratingModal.classList.add("hidden");
    modalBackdrop.classList.add("hidden");
    await loadPlacesAndRatings();
  } catch (err) {
    console.error(err);
    alert("Error sending rating");
  }
});

// ---------- NEAR ME (LIVE TRACKING) ----------
nearMeBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  // Stop previous watch if any
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      userLocation = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };
      nearMeActive = true;

      updateUserMarkerOnMap(false);
      renderUserPlaces();
      updateRouteEta();

      // If we have active target, update route as we move
      if (currentRoutePlace) {
        showRouteToPlace(currentRoutePlace);
      }
    },
    (err) => {
      console.error(err);
      alert("Could not get your location");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }
  );
});

clearNearMeBtn.addEventListener("click", () => {
  nearMeActive = false;

  // stop live tracking
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  userLocation = null;
  currentRoutePlace = null;

  if (userMarker) {
    map.geoObjects.remove(userMarker);
    userMarker = null;
  }
  if (currentRoute) {
    map.geoObjects.remove(currentRoute);
    currentRoute = null;
  }

  updateRouteEta();
  renderUserPlaces();
});

// Focus on me button
if (focusMeBtn) {
  focusMeBtn.addEventListener("click", () => {
    if (userLocation) {
      updateUserMarkerOnMap(true);
    } else {
      nearMeBtn.click();
    }
  });
}

// ---------- MAP ----------
ymaps.ready(initMap);

function initMap() {
  map = new ymaps.Map("map", {
    center: [41.315, 69.33],
    zoom: 13,
  });

  clusterer = new ymaps.Clusterer({
    preset: "islands#invertedBlueClusterIcons",
  });
  map.geoObjects.add(clusterer);

  // Map click: center on user if we know, else ask Near me
  map.events.add("click", () => {
    if (userLocation) {
      updateUserMarkerOnMap(true);
    } else {
      nearMeBtn.click();
    }
  });

  loadFavorites();
  loadPlacesAndRatings();
}

// ---------- MARKERS ----------
function loadMarkersOnMap() {
  if (!clusterer) return;
  clusterer.removeAll();
  mapMarkers = {};

  const markers = places.map((place) => {
    const marker = new ymaps.Placemark(
      [place.lat, place.lon],
      {
        balloonContent: `
          <b>${place.name}</b><br>
          Free: ${place.free_seats}/${place.total_seats}<br>
          ${place.address}
        `,
      },
      {
        preset:
          place.free_seats > 0
            ? "islands#greenCircleDotIcon"
            : "islands#redCircleDotIcon",
      }
    );

    marker.events.add("click", () => {
      if (userLocation) {
        showRouteToPlace(place);
      }
    });

    mapMarkers[place.id] = marker;
    return marker;
  });

  clusterer.add(markers);
}

// ---------- USER MARKER (SMOOTH ANIMATION) ----------
function updateUserMarkerOnMap(center = false) {
  if (!map || !userLocation || !window.ymaps) return;

  const newCoords = [userLocation.lat, userLocation.lon];

  if (!userMarker) {
    userMarker = new ymaps.Placemark(
      newCoords,
      { balloonContent: "You are here" },
      { preset: "islands#bluePersonIcon" }
    );
    map.geoObjects.add(userMarker);
    lastUserMarkerCoords = newCoords;
  } else {
    // smooth animation from lastUserMarkerCoords to newCoords
    if (!lastUserMarkerCoords) {
      lastUserMarkerCoords = userMarker.geometry.getCoordinates();
    }
    animateMarkerMove(lastUserMarkerCoords, newCoords, 400);
    lastUserMarkerCoords = newCoords;
  }

  if (center) {
    map.setCenter(newCoords, 15, { duration: 300 });
    userMarker.balloon.open();
  }
}

function animateMarkerMove(from, to, durationMs) {
  if (!userMarker) return;
  if (markerAnimationId) {
    cancelAnimationFrame(markerAnimationId);
    markerAnimationId = null;
  }

  const start = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const lat = from[0] + (to[0] - from[0]) * t;
    const lon = from[1] + (to[1] - from[1]) * t;
    userMarker.geometry.setCoordinates([lat, lon]);

    if (t < 1) {
      markerAnimationId = requestAnimationFrame(frame);
    }
  }

  markerAnimationId = requestAnimationFrame(frame);
}

// ---------- FALLBACK: STRAIGHT LINE ----------
function drawSimpleRoute(place) {
  if (!map || !userLocation || !window.ymaps) return;

  if (currentRoute) {
    map.geoObjects.remove(currentRoute);
    currentRoute = null;
  }

  currentRoute = new ymaps.Polyline(
    [
      [userLocation.lat, userLocation.lon],
      [place.lat, place.lon],
    ],
    {},
    {
      strokeColor: "#0000FF",
      strokeWidth: 4,
      strokeOpacity: 0.8,
    }
  );

  map.geoObjects.add(currentRoute);

  const bounds = currentRoute.geometry.getBounds();
  if (bounds) {
    map.setBounds(bounds, { checkZoomRange: true, duration: 300 });
  }
}

// ---------- ROAD ROUTE WITH FALLBACK ----------
function showRouteToPlace(place) {
  if (!map || !userLocation || !window.ymaps) return;

  currentRoutePlace = place; // remember target for ETA + live updates
  updateUserMarkerOnMap(false);

  if (currentRoute) {
    map.geoObjects.remove(currentRoute);
    currentRoute = null;
  }

  ymaps
    .route(
      [
        [userLocation.lat, userLocation.lon],
        [place.lat, place.lon],
      ],
      { mapStateAutoApply: false }
    )
    .then((route) => {
      currentRoute = route;
      map.geoObjects.add(route);

      const bounds = route.getBounds();
      if (bounds) {
        map.setBounds(bounds, { checkZoomRange: true, duration: 300 });
      }

      updateRouteEta();
    })
    .catch((err) => {
      console.error("Yandex routing failed:", err);

      drawSimpleRoute(place);
      updateRouteEta();
    });
}

// ---------- UTIL: DISTANCE ----------
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

