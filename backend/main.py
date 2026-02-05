from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from typing import Optional, List
from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import os
from dotenv import load_dotenv
from websocket_manager import sio, broadcast_new_event, broadcast_booking_update, broadcast_seats_update
import socketio
from payment_service import create_payment_intent, confirm_payment
import qrcode
import io
from fastapi.responses import StreamingResponse
from fastapi import BackgroundTasks
from email_service import send_ticket_email
from sqlalchemy import func

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/event_booking")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Initialize FastAPI app
app = FastAPI(title="Event Booking API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    # allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://event-booking-frontend.onrender.com"],
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
socket_app = socketio.ASGIApp(sio, app)

# ============= DATABASE MODELS =============

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    bookings = relationship("Booking", back_populates="user")

class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String)
    venue = Column(String)
    date = Column(DateTime, nullable=False)
    price = Column(Float, default=0.0)
    total_seats = Column(Integer, default=100)
    available_seats = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    bookings = relationship("Booking", back_populates="event")

class Booking(Base):
    __tablename__ = "bookings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    event_id = Column(Integer, ForeignKey("events.id"))
    seats = Column(Integer, default=1)
    total_amount = Column(Float)
    booking_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="pending")  # pending, paid, cancelled
    payment_intent_id = Column(String, nullable=True)
    
    user = relationship("User", back_populates="bookings")
    event = relationship("Event", back_populates="bookings")

# Create tables
Base.metadata.create_all(bind=engine)

# ============= PYDANTIC SCHEMAS =============

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    full_name: Optional[str]
    is_active: bool
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    venue: Optional[str] = None
    date: datetime
    price: float = 0.0
    total_seats: int = 100

class EventResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    venue: Optional[str]
    date: datetime
    price: float
    total_seats: int
    available_seats: int
    
    class Config:
        from_attributes = True

class BookingCreate(BaseModel):
    event_id: int
    seats: int = 1

class BookingResponse(BaseModel):
    id: int
    event_id: int
    seats: int
    total_amount: float
    booking_date: datetime
    status: str
    payment_intent_id: Optional[str] = None  # Add this
    
    class Config:
        from_attributes = True

# ============= UTILITY FUNCTIONS =============

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# ============= API ENDPOINTS =============

@app.get("/")
def root():
    return {"message": "Event Booking API", "version": "1.0.0"}

# ------------- AUTH ENDPOINTS -------------

@app.post("/register", response_model=UserResponse)
def register(user: UserCreate, db: Session = Depends(get_db)):
    # Check if user exists
    db_user = db.query(User).filter(
        (User.email == user.email) | (User.username == user.username)
    ).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email or username already registered")
    
    # Create new user
    hashed_password = get_password_hash(user.password)
    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=hashed_password,
        full_name=user.full_name
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    return current_user

# ------------- EVENT ENDPOINTS -------------

@app.get("/events", response_model=List[EventResponse])
def get_events(skip: int = 0, limit: int = 10, db: Session = Depends(get_db)):
    events = db.query(Event).offset(skip).limit(limit).all()
    return events

@app.post("/events", response_model=EventResponse)
async def create_event(event: EventCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_event = Event(
        **event.dict(),
        available_seats=event.total_seats
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    # Add this broadcasting code:
    event_data = {
        "id": db_event.id,
        "title": db_event.title,
        "description": db_event.description,
        "venue": db_event.venue,
        "date": db_event.date.isoformat(),
        "price": db_event.price,
        "total_seats": db_event.total_seats,
        "available_seats": db_event.available_seats,
        "created_by": current_user.username
    }
    await broadcast_new_event(event_data)
    
    return db_event

@app.get("/events/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

# ------------- BOOKING ENDPOINTS -------------

@app.post("/bookings", response_model=BookingResponse)
async def create_booking(
    booking: BookingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check if event exists
    event = db.query(Event).filter(Event.id == booking.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Check seat availability
    if event.available_seats < booking.seats:
        raise HTTPException(status_code=400, detail="Not enough seats available")
    
    # Create booking
    total_amount = event.price * booking.seats
    db_booking = Booking(
        user_id=current_user.id,
        event_id=booking.event_id,
        seats=booking.seats,
        total_amount=total_amount
    )
    
    # Update available seats
    event.available_seats -= booking.seats
    
    db.add(db_booking)
    db.commit()
    db.refresh(db_booking)
    booking_data = {
        "event_id": event.id,
        "event_title": event.title,
        "booked_by": current_user.username,
        "seats_booked": booking.seats,
        "available_seats": event.available_seats,
        "total_seats": event.total_seats
    }
    await broadcast_booking_update(event.id, booking_data)
    await broadcast_seats_update(event.id, event.available_seats, event.total_seats)
    
    return db_booking

# ------------- PAYMENT ENDPOINTS -------------

@app.post("/create-payment-intent")
async def create_stripe_payment(
    booking: BookingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify event exists and has seats
    print("RRRRRRR")
    event = db.query(Event).filter(Event.id == booking.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    print('Inside')
    if event.available_seats < booking.seats:
        raise HTTPException(status_code=400, detail="Not enough seats available")
    
    # Calculate amount
    total_amount = event.price * booking.seats
    
    # Create payment intent with Stripe
    metadata = {
        "user_id": str(current_user.id),
        "event_id": str(event.id),
        "seats": str(booking.seats),
        "username": current_user.username
    }
    
    try:
        intent = await create_payment_intent(total_amount, metadata)
        print('Intent')
        # Create booking with pending status
        db_booking = Booking(
            user_id=current_user.id,
            event_id=booking.event_id,
            seats=booking.seats,
            total_amount=total_amount,
            status="pending",
            payment_intent_id=intent.id
        )
        
        db.add(db_booking)
        db.commit()
        db.refresh(db_booking)
        print('DB')
        return {
            "client_secret": intent.client_secret,
            "booking_id": db_booking.id,
            "amount": total_amount
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/confirm-payment/{booking_id}")
async def confirm_payment_status(
    booking_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Get booking
    booking = db.query(Booking).filter(
        Booking.id == booking_id,
        Booking.user_id == current_user.id
    ).first()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if await confirm_payment(booking.payment_intent_id):
        # ATOMIC UPDATE: Only update if seats are still available
        result = db.query(Event).filter(
            Event.id == booking.event_id,
            Event.available_seats >= booking.seats
        ).update(
            {"available_seats": Event.available_seats - booking.seats},
            synchronize_session=False
        )
        
        if result == 0:
            # This handles the rare case where payment succeeded but seats ran out
            # TODO: Handle a refund
            raise HTTPException(status_code=400, detail="Event sold out during payment processing")

        booking.status = "paid"
        db.commit()
    
    # # Verify payment with Stripe 
    # if await confirm_payment(booking.payment_intent_id):
    #     # Update booking status
    #     booking.status = "paid"
         
    #     # Update available seats
    #     event = db.query(Event).filter(Event.id == booking.event_id).first()
    #     event.available_seats -= booking.seats
        
    #     db.commit()
        event = db.query(Event).filter(Event.id == booking.event_id).first()
        # Broadcast updates
        await broadcast_seats_update(
            event.id, 
            event.available_seats, 
            event.total_seats
        )

        background_tasks.add_task(
            send_ticket_email, 
            current_user.email, 
            current_user.username, 
            event.title, 
            booking.id
        )
        
        return {"status": "success", "booking": booking}
    else:
        return {"status": "pending"}

@app.get("/my-bookings", response_model=List[BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bookings = db.query(Booking).filter(Booking.user_id == current_user.id).all()
    return bookings

@app.get("/bookings/{booking_id}/ticket")
async def get_ticket_qr(booking_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    booking = db.query(Booking).filter(Booking.id == booking_id, Booking.user_id == current_user.id).first()
    if not booking or booking.status != "paid":
        raise HTTPException(status_code=404, detail="Ticket not found or unpaid")
    
    # Data to encode in QR
    data = f"TICKET:{booking.id}:{current_user.username}:{booking.event_id}"
    qr = qrcode.make(data)
    
    buf = io.BytesIO()
    qr.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")

@app.get("/admin/stats")
def get_admin_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 1. Total Revenue from 'paid' bookings
    revenue = db.query(func.sum(Booking.total_amount)).filter(Booking.status == "paid").scalar() or 0
    
    # 2. Total Tickets Sold
    tickets_sold = db.query(func.count(Booking.id)).filter(Booking.status == "paid").count()
    
    # 3. Occupancy Data for Charting
    events = db.query(Event).all()
    chart_data = [
        {
            "name": e.title,
            "sold": e.total_seats - e.available_seats,
            "total": e.total_seats
        } for e in events
    ]
    
    return {
        "revenue": revenue,
        "tickets_sold": tickets_sold,
        "chart_data": chart_data
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(socket_app, host="0.0.0.0", port=8000)  # ← USE socket_app
