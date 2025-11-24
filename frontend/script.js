const API_BASE = "/api";

// simple demo password (frontend check only, not secure but ok for now)
const MANAGER_PASSWORD = "admin123";

let places = [];
let isManagerLoggedIn = false;

// DOM elements
const userTab = document.getElementById("user-tab");
const managerTab = document.getElementById("manager-tab");
const userView = document.getElementById("user-view");
const managerView = document.getElementById("manager-view");

const typeFilter = document.getElementById("type-filter");
const userPlacesContainer = document.getElementById("user-places");

const loginSection = document.getElementById("login-section");
const managerSection = document.getElementById("manager-section");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password-input");
const managerPlacesContainer = document.getElementById("manager-places");
const logoutBtn = document.getElementById("logout-btn");

// ---------- TAB SWITCHING ----------

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

// ---------- FETCH PLACES ----------

async function loadPlaces() {
  try {
    const res = await fetch(`${API_BASE}/places`);
    if (!res.ok) {
      throw new Error("Failed to load places");
    }
    places = await res.json();
    renderUserPlaces();
    if (isManagerLoggedIn) {
      renderManagerPlaces();
    }
  } catch (err) {
    console.error(err);
    userPlacesContainer.innerHTML = "<p>Error loading places.</p>";
  }
}

// ---------- USER VIEW RENDER ----------

function renderUserPlaces() {
  const filterValue = typeFilter.value;
  const filtered = places.filter((p) =>
    filterValue === "all" ? true : p.type === filterValue
  );

  if (filtered.length === 0) {
    userPlacesContainer.innerHTML = "<p>No places found.</p>";
    return;
  }

  userPlacesContainer.innerHTML = filtered
    .map((place) => {
      const statusClass = place.free_seats > 0 ? "ok" : "full";
      const statusText = place.free_seats > 0 ? "✅ Available" : "❌ Full";

      return `
        <div class="place-card">
          <h3>${place.name}</h3>
          <div class="place-type">${place.type}</div>
          <div class="place-address">${place.address}</div>
          <div class="place-seats">
            Free seats: <strong>${place.free_seats}</strong> / ${place.total_seats}
          </div>
          <div class="status ${statusClass}">${statusText}</div>
        </div>
      `;
    })
    .join("");
}

typeFilter.addEventListener("change", renderUserPlaces);

// ---------- MANAGER LOGIN ----------

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const pwd = passwordInput.value.trim();
  if (pwd === MANAGER_PASSWORD) {
    isManagerLoggedIn = true;
    passwordInput.value = "";
    loginSection.classList.add("hidden");
    managerSection.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    renderManagerPlaces();
    alert("Manager login successful");
  } else {
    alert("Wrong password");
  }
});

logoutBtn.addEventListener("click", () => {
  isManagerLoggedIn = false;
  loginSection.classList.remove("hidden");
  managerSection.classList.add("hidden");
  logoutBtn.classList.add("hidden");
});

// ---------- MANAGER VIEW RENDER ----------

function renderManagerPlaces() {
  if (!isManagerLoggedIn) return;

  if (places.length === 0) {
    managerPlacesContainer.innerHTML = "<p>No places to edit.</p>";
    return;
  }

  managerPlacesContainer.innerHTML = places
    .map((place) => {
      return `
        <div class="place-card">
          <h3>${place.name}</h3>
          <div class="place-type">${place.type}</div>
          <div class="place-seats">
            Total seats: <strong>${place.total_seats}</strong>
          </div>
          <label>
            Free seats:
            <input
              type="number"
              class="manager-input"
              min="0"
              max="${place.total_seats}"
              value="${place.free_seats}"
              data-place-id="${place.id}"
            />
          </label>
          <button class="save-btn" data-place-id="${place.id}">
            Save
          </button>
        </div>
      `;
    })
    .join("");

  // Attach event listeners for all save buttons
  const saveButtons = managerPlacesContainer.querySelectorAll(".save-btn");
  saveButtons.forEach((btn) => {
    btn.addEventListener("click", handleSaveClick);
  });
}

// ---------- SAVE HANDLER (PUT to API) ----------

async function handleSaveClick(event) {
  const placeId = Number(event.target.getAttribute("data-place-id"));
  const input = managerPlacesContainer.querySelector(
    `.manager-input[data-place-id="${placeId}"]`
  );

  const newValue = Number(input.value);
  if (Number.isNaN(newValue)) {
    alert("Please enter a number");
    return;
  }

  const place = places.find((p) => p.id === placeId);
  if (!place) {
    alert("Place not found");
    return;
  }

  if (newValue < 0 || newValue > place.total_seats) {
    alert(`Free seats must be between 0 and ${place.total_seats}`);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/places/${placeId}/seats`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ free_seats: newValue }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert("Error: " + (data.detail || "Unknown error"));
      return;
    }

    const updatedPlace = await res.json();

    // update local array
    places = places.map((p) => (p.id === placeId ? updatedPlace : p));

    // re-render both views
    renderUserPlaces();
    renderManagerPlaces();
    alert("Saved!");
  } catch (err) {
    console.error(err);
    alert("Network error while saving.");
  }
}

// ---------- INITIAL LOAD ----------

loadPlaces();
