from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Dict, List
import json
import os
import secrets
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PLACES_FILE = "places.json"
DATA_BOOKINGS_FILE = "bookings.json"
DATA_RATINGS_FILE = "ratings.json"


# ---------- MODELS ----------
class Place(BaseModel):
    id: int
    name: str
    type: str
    total_seats: int
    free_seats: int
    address: str
    lat: float
    lon: float
    open_time: str
    close_time: str


class SeatsUpdate(BaseModel):
    free_seats: int


class Manager(BaseModel):
    username: str
    password: str
    place_id: int  # which place this manager controls (0 for admin)
    is_admin: bool = False


class ManagerLoginRequest(BaseModel):
    username: str
    password: str


class ManagerLoginResponse(BaseModel):
    token: str
    place_id: int
    place_name: str
    is_admin: bool


class BookingCreate(BaseModel):
    name: str      # user name
    people: int    # how many people
    time: str      # e.g. "Today 19:00"


class Booking(BaseModel):
    id: int
    place_id: int
    name: str
    people: int
    time: str
    status: str  # "pending", "confirmed", "cancelled"


class BookingStatusUpdate(BaseModel):
    status: str  # new status


class RatingCreate(BaseModel):
    rating: int             # 1–5
    status: str             # "busy", "free", "normal"
    name: Optional[str] = None
    comment: Optional[str] = None


class Rating(BaseModel):
    id: int
    place_id: int
    rating: int
    status: str
    name: Optional[str] = None
    comment: Optional[str] = None
    created_at: str


class RatingSummary(BaseModel):
    place_id: int
    avg_rating: float
    rating_count: int
    last_status: Optional[str]


# ---------- MANAGERS (one per place + admin) ----------
MANAGERS: List[Manager] = [
    Manager(username="admin",      password="admin123",      place_id=0, is_admin=True),
    Manager(username="anhor",      password="anhor123",      place_id=1),
    Manager(username="gameon",     password="gameon123",     place_id=2),
    Manager(username="blackbear",  password="blackbear123",  place_id=3),
    Manager(username="coffeeboom", password="coffeeboom123", place_id=4),
    Manager(username="toronto",    password="toronto123",    place_id=5),
    Manager(username="cyberzone",  password="cyberzone123",  place_id=6),
]

# token -> Manager
SESSIONS: Dict[str, Manager] = {}


def get_manager_from_token(token: Optional[str]) -> Optional[Manager]:
    if not token:
        return None
    return SESSIONS.get(token)


# ---------- DEFAULT PLACES (fallback if no JSON yet) ----------
DEFAULT_PLACES: List[Place] = [
    Place(
        id=1,
        name="Anhor Coffee & Bakery",
        type="Cafe",
        total_seats=25,
        free_seats=12,
        address="Ahmad Donish, Yashnobod",
        lat=41.330877,
        lon=69.335044,
        open_time="08:00",
        close_time="23:00",
    ),
    Place(
        id=2,
        name="Game On Esports Club",
        type="Game Club",
        total_seats=40,
        free_seats=20,
        address="Qo‘yliq 5, Yashnobod",
        lat=41.314218,
        lon=69.329901,
        open_time="10:00",
        close_time="05:00",
    ),
    Place(
        id=3,
        name="Black Bear Kofi",
        type="Cafe",
        total_seats=20,
        free_seats=5,
        address="Ahmad Donish, Yashnobod",
        lat=41.330597,
        lon=69.337418,
        open_time="09:00",
        close_time="23:00",
    ),
    Place(
        id=4,
        name="Coffee Boom",
        type="Cafe",
        total_seats=18,
        free_seats=10,
        address="Aviasozlar, Yashnobod",
        lat=41.296298,
        lon=69.283850,
        open_time="08:00",
        close_time="22:00",
    ),
    Place(
        id=5,
        name="Toronto Lounge",
        type="Cafe",
        total_seats=30,
        free_seats=17,
        address="Bratsev street, Yashnobod",
        lat=41.324820,
        lon=69.333510,
        open_time="12:00",
        close_time="02:00",
    ),
    Place(
        id=6,
        name="Cyber Zone Gaming",
        type="Game Club",
        total_seats=32,
        free_seats=16,
        address="Parkent street, Yashnobod",
        lat=41.317187,
        lon=69.343702,
        open_time="00:00",
        close_time="23:59",
    ),
]


# ---------- DATA LOAD / SAVE ----------
def load_places() -> List[Place]:
    if os.path.exists(DATA_PLACES_FILE):
        with open(DATA_PLACES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [Place(**p) for p in data]
    return DEFAULT_PLACES


def save_places():
    with open(DATA_PLACES_FILE, "w", encoding="utf-8") as f:
        json.dump([p.dict() for p in PLACES], f, ensure_ascii=False, indent=2)


def load_bookings() -> List[Booking]:
    if os.path.exists(DATA_BOOKINGS_FILE):
        with open(DATA_BOOKINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [Booking(**b) for b in data]
    return []


def save_bookings():
    with open(DATA_BOOKINGS_FILE, "w", encoding="utf-8") as f:
        json.dump([b.dict() for b in BOOKINGS], f, ensure_ascii=False, indent=2)


def load_ratings() -> List[Rating]:
    if os.path.exists(DATA_RATINGS_FILE):
        with open(DATA_RATINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [Rating(**r) for r in data]
    return []


def save_ratings():
    with open(DATA_RATINGS_FILE, "w", encoding="utf-8") as f:
        json.dump([r.dict() for r in RATINGS], f, ensure_ascii=False, indent=2)


PLACES: List[Place] = load_places()
BOOKINGS: List[Booking] = load_bookings()
RATINGS: List[Rating] = load_ratings()


def get_next_booking_id() -> int:
    if not BOOKINGS:
        return 1
    return max(b.id for b in BOOKINGS) + 1


def get_next_rating_id() -> int:
    if not RATINGS:
        return 1
    return max(r.id for r in RATINGS) + 1


def build_rating_summary() -> List[RatingSummary]:
    summaries: Dict[int, RatingSummary] = {}

    for rating in RATINGS:
        summary = summaries.get(rating.place_id)
        if not summary:
            summaries[rating.place_id] = RatingSummary(
                place_id=rating.place_id,
                avg_rating=rating.rating,
                rating_count=1,
                last_status=rating.status,
            )
        else:
            total = summary.avg_rating * summary.rating_count + rating.rating
            count = summary.rating_count + 1
            summary.avg_rating = total / count
            summary.rating_count = count
            summary.last_status = rating.status

    return list(summaries.values())


# ---------- API: PLACES ----------
@app.get("/api/places", response_model=List[Place])
def get_places():
    return PLACES


# ---------- API: MANAGER / ADMIN LOGIN ----------
@app.post("/api/manager/login", response_model=ManagerLoginResponse)
def manager_login(payload: ManagerLoginRequest):
    for manager in MANAGERS:
        if manager.username == payload.username and manager.password == payload.password:
            token = secrets.token_hex(16)
            SESSIONS[token] = manager

            if manager.is_admin:
                place_id = -1
                place_name = "Admin"
            else:
                place = next((p for p in PLACES if p.id == manager.place_id), None)
                place_id = manager.place_id
                place_name = place.name if place else ""

            return ManagerLoginResponse(
                token=token,
                place_id=place_id,
                place_name=place_name,
                is_admin=manager.is_admin,
            )

    raise HTTPException(status_code=401, detail="Invalid username or password")


# ---------- API: UPDATE SEATS (MANAGER OR ADMIN) ----------
@app.put("/api/places/{place_id}/seats", response_model=Place)
def update_seats(
    place_id: int,
    update: SeatsUpdate,
    x_manager_token: Optional[str] = Header(None, alias="X-Manager-Token"),
):
    manager = get_manager_from_token(x_manager_token)
    if manager is None:
        raise HTTPException(status_code=401, detail="Manager authentication required")

    if not manager.is_admin and manager.place_id != place_id:
        raise HTTPException(
            status_code=403,
            detail="You can only update seats for your own place",
        )

    for idx, place in enumerate(PLACES):
        if place.id == place_id:
            if update.free_seats < 0 or update.free_seats > place.total_seats:
                raise HTTPException(
                    status_code=400,
                    detail=f"free_seats must be between 0 and {place.total_seats}",
                )

            updated = place.copy(update={"free_seats": update.free_seats})
            PLACES[idx] = updated
            save_places()
            return updated

    raise HTTPException(status_code=404, detail="Place not found")


# ---------- API: USER CREATES BOOKING ----------
@app.post("/api/places/{place_id}/bookings", response_model=Booking)
def create_booking(place_id: int, payload: BookingCreate):
    place = next((p for p in PLACES if p.id == place_id), None)
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    if payload.people <= 0:
        raise HTTPException(status_code=400, detail="people must be > 0")

    booking = Booking(
        id=get_next_booking_id(),
        place_id=place_id,
        name=payload.name,
        people=payload.people,
        time=payload.time,
        status="pending",
    )
    BOOKINGS.append(booking)
    save_bookings()
    return booking


# ---------- API: MANAGER VIEWS BOOKINGS ----------
@app.get("/api/places/{place_id}/bookings", response_model=List[Booking])
def get_place_bookings(
    place_id: int,
    x_manager_token: Optional[str] = Header(None, alias="X-Manager-Token"),
):
    manager = get_manager_from_token(x_manager_token)
    if manager is None:
        raise HTTPException(status_code=401, detail="Manager authentication required")

    if not manager.is_admin and manager.place_id != place_id:
        raise HTTPException(
            status_code=403,
            detail="You can only view bookings for your own place",
        )

    return [b for b in BOOKINGS if b.place_id == place_id]


# ---------- API: ADMIN ALL BOOKINGS ----------
@app.get("/api/admin/bookings", response_model=List[Booking])
def admin_get_bookings(
    x_manager_token: Optional[str] = Header(None, alias="X-Manager-Token"),
):
    manager = get_manager_from_token(x_manager_token)
    if manager is None or not manager.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")

    return BOOKINGS


# ---------- API: MANAGER / ADMIN CHANGES BOOKING STATUS ----------
@app.put("/api/bookings/{booking_id}/status", response_model=Booking)
def update_booking_status(
    booking_id: int,
    payload: BookingStatusUpdate,
    x_manager_token: Optional[str] = Header(None, alias="X-Manager-Token"),
):
    manager = get_manager_from_token(x_manager_token)
    if manager is None:
        raise HTTPException(status_code=401, detail="Manager authentication required")

    allowed_status = {"pending", "confirmed", "cancelled"}
    if payload.status not in allowed_status:
        raise HTTPException(status_code=400, detail="Invalid status")

    for idx, booking in enumerate(BOOKINGS):
        if booking.id == booking_id:
            if not manager.is_admin and booking.place_id != manager.place_id:
                raise HTTPException(
                    status_code=403,
                    detail="You can only manage bookings for your own place",
                )

            updated = booking.copy(update={"status": payload.status})
            BOOKINGS[idx] = updated
            save_bookings()
            return updated

    raise HTTPException(status_code=404, detail="Booking not found")


# ---------- API: USER RATINGS + “I AM HERE NOW” ----------
@app.post("/api/places/{place_id}/ratings", response_model=Rating)
def create_rating(place_id: int, payload: RatingCreate):
    place = next((p for p in PLACES if p.id == place_id), None)
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    if payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be 1–5")

    allowed_status = {"busy", "free", "normal"}
    if payload.status not in allowed_status:
        raise HTTPException(status_code=400, detail="status must be busy/free/normal")

    rating = Rating(
        id=get_next_rating_id(),
        place_id=place_id,
        rating=payload.rating,
        status=payload.status,
        name=payload.name,
        comment=payload.comment,
        created_at=datetime.utcnow().isoformat(timespec="seconds"),
    )
    RATINGS.append(rating)
    save_ratings()
    return rating


@app.get("/api/places/{place_id}/ratings", response_model=List[Rating])
def get_place_ratings(place_id: int):
    return [r for r in RATINGS if r.place_id == place_id]


@app.get("/api/ratings/summary", response_model=List[RatingSummary])
def get_ratings_summary():
    return build_rating_summary()


# ---------- FRONTEND ----------
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
