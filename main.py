from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()

# Allow browser JS to call our API (useful if needed later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # for development only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- DATA MODEL ----------

class Place(BaseModel):
    id: int
    name: str
    type: str          # "Cafe" or "Game Club"
    total_seats: int
    free_seats: int
    address: str


# In-memory "database" (resets when you restart the server)
PLACES = [
    Place(
        id=1,
        name="Coffee Time",
        type="Cafe",
        total_seats=20,
        free_seats=8,
        address="Andijan, Center street 5",
    ),
    Place(
        id=2,
        name="Game Club Pro",
        type="Game Club",
        total_seats=30,
        free_seats=12,
        address="Andijan, Youth street 10",
    ),
    Place(
        id=3,
        name="Study & Coffee",
        type="Cafe",
        total_seats=15,
        free_seats=3,
        address="Andijan, University area",
    ),
]


class SeatsUpdate(BaseModel):
    free_seats: int


# ---------- API ROUTES ----------

@app.get("/api/places", response_model=list[Place])
def get_places():
    """Return list of all places."""
    return PLACES


@app.put("/api/places/{place_id}/seats", response_model=Place)
def update_seats(place_id: int, update: SeatsUpdate):
    """Update free_seats for a place (for manager)."""
    for idx, place in enumerate(PLACES):
        if place.id == place_id:
            if update.free_seats < 0 or update.free_seats > place.total_seats:
                raise HTTPException(
                    status_code=400,
                    detail=f"free_seats must be between 0 and {place.total_seats}",
                )
            new_place = place.copy(update={"free_seats": update.free_seats})
            PLACES[idx] = new_place
            return new_place

    raise HTTPException(status_code=404, detail="Place not found")


# ---------- STATIC FRONTEND ----------

# We will create folder "frontend" with index.html, etc.
app.mount(
    "/", StaticFiles(directory="frontend", html=True), name="frontend"
)
