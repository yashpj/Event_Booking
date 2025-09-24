import React, { useState, useEffect, createContext, useContext } from 'react';
import axios from 'axios';
import './App.css';
import socketService from './services/socketService';
import NotificationBar from './components/NotificationBar';
import PaymentForm from './components/PaymentForm';

// API Configuration
const API_BASE_URL = 'http://localhost:8000';
axios.defaults.baseURL = API_BASE_URL;

// Auth Context
const AuthContext = createContext(null);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Auth Provider Component
const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Connect to WebSocket when app loads
    socketService.connect();
    
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
    
    // Cleanup on unmount
    return () => {
      socketService.disconnect();
    };
  }, [token]);

  const fetchUser = async () => {
    try {
      const response = await axios.get('/me');
      setUser(response.data);
      // Authenticate WebSocket connection
      socketService.authenticate(response.data.username);
    } catch (error) {
      console.error('Error fetching user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await axios.post('/token', formData);
    const { access_token } = response.data;
    
    localStorage.setItem('token', access_token);
    setToken(access_token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    
    await fetchUser();
    
    // Authenticate WebSocket after login
    socketService.authenticate(username);
    
    return response.data;
  };


  const register = async (userData) => {
    const response = await axios.post('/register', userData);
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Navigation Component
const Navigation = () => {
  const { user, logout } = useAuth();
  
  return (
    <nav className="navbar">
      <div className="nav-content">
        <h1 className="logo">🎫 EventBook</h1>
        <div className="nav-links">
          {user ? (
            <>
              <span className="welcome-text">Welcome, {user.username}!</span>
              <button onClick={logout} className="nav-button">Logout</button>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
};

// Login/Register Component
const AuthForm = ({ onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    full_name: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(formData.username, formData.password);
        onSuccess();
      } else {
        await register(formData);
        await login(formData.username, formData.password);
        onSuccess();
      }
    } catch (error) {
      setError(error.response?.data?.detail || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        
        {error && <div className="error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            name="username"
            placeholder="Username"
            value={formData.username}
            onChange={handleChange}
            required
          />
          
          {!isLogin && (
            <>
              <input
                type="email"
                name="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
                required
              />
              <input
                type="text"
                name="full_name"
                placeholder="Full Name (optional)"
                value={formData.full_name}
                onChange={handleChange}
              />
            </>
          )}
          
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            required
          />
          
          <button type="submit" disabled={loading}>
            {loading ? 'Processing...' : (isLogin ? 'Login' : 'Register')}
          </button>
        </form>
        
        <p className="switch-text">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => setIsLogin(!isLogin)} className="switch-button">
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};

// Events List Component
const EventsList = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { user } = useAuth();

  const fetchEvents = async () => {
    try {
      const response = await axios.get('/events');
      setEvents(response.data);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  };

  // Define handleEventCreated function
  const handleEventCreated = () => {
    setShowCreateForm(false);
    fetchEvents(); // Refresh the events list
  };

  useEffect(() => {
    fetchEvents();

    // Listen for new events
    socketService.on('new_event', (eventData) => {
      setEvents(prev => [eventData, ...prev]);
    });

    // Listen for seat updates
    socketService.on('seats_updated', (data) => {
      setEvents(prev => prev.map(event => 
        event.id === data.event_id 
          ? { ...event, available_seats: data.available_seats }
          : event
      ));
    });

    // Cleanup
    return () => {
      socketService.off('new_event');
      socketService.off('seats_updated');
    };
  }, []);

  if (loading) return <div className="loading">Loading events...</div>;

  return (
    <div className="container">
      <div className="header">
        <h2>Upcoming Events</h2>
        {user && (
          <button 
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="create-button"
          >
            {showCreateForm ? 'Cancel' : '+ Create Event'}
          </button>
        )}
      </div>

      {showCreateForm && <CreateEventForm onSuccess={handleEventCreated} />}

      <div className="events-grid">
        {events.length === 0 ? (
          <p>No events available</p>
        ) : (
          events.map(event => (
            <EventCard key={event.id} event={event} onBooked={fetchEvents} />
          ))
        )}
      </div>
    </div>
  );
};

// Event Card Component
const EventCard = ({ event, onBooked }) => {
  const [booking, setBooking] = useState(false);
  const [seats, setSeats] = useState(1);
  const [error, setError] = useState('');
  const { user } = useAuth();
  
  const [showPayment, setShowPayment] = useState(false);

  const handlePaymentSuccess = (bookingId) => {
    alert(`Booking confirmed! ID: ${bookingId}`);
    setShowPayment(false);
    onBooked();
  };
  
  if (showPayment) {
    return (
      <PaymentForm 
        event={event}
        seats={seats}
        onSuccess={(bookingId) => {
          alert(`Payment successful! Booking ID: ${bookingId}`);
          setShowPayment(false);
          onBooked();
        }}
        onCancel={() => setShowPayment(false)}
      />
    );
  }


  // REPLACE your handleBooking function with this:
  const handleBooking = async () => {
    if (!user) {
      setError('Please login to book');
      return;
    }
    setShowPayment(true); // Show payment form instead of direct booking
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="event-card">
      <h3>{event.title}</h3>
      <p className="event-description">{event.description}</p>
      <div className="event-details">
        <p>📍 {event.venue || 'Venue TBA'}</p>
        <p>📅 {formatDate(event.date)}</p>
        <p>💰 {event.price === 0 ? 'Free' : `${event.price}`}</p>
        <p>🎫 {event.available_seats} / {event.total_seats} seats available</p>
      </div>
      
      {user && event.available_seats > 0 && (
        <div className="booking-section">
          <div className="seat-selector">
            <label>Seats: </label>
            <input
              type="number"
              min="1"
              max={Math.min(event.available_seats, 10)}
              value={seats}
              onChange={(e) => setSeats(parseInt(e.target.value))}
              className="seat-input"
            />
          </div>
          <button 
            onClick={handleBooking} 
            disabled={booking}
            className="book-button"
          >
            {booking ? 'Booking...' : `Book Now (${event.price * seats})`}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
      
      {!user && (
        <p className="login-prompt">Please login to book this event</p>
      )}
      
      {event.available_seats === 0 && (
        <p className="sold-out">SOLD OUT</p>
      )}
    </div>
  );
};

// Create Event Form Component
const CreateEventForm = ({ onSuccess }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    venue: '',
    date: '',
    price: 0,
    total_seats: 100
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const eventData = {
        ...formData,
        date: new Date(formData.date).toISOString(),
        price: parseFloat(formData.price),
        total_seats: parseInt(formData.total_seats)
      };
      
      await axios.post('/events', eventData);
      onSuccess();
    } catch (error) {
      setError(error.response?.data?.detail || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="create-form">
      <h3>Create New Event</h3>
      {error && <div className="error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          name="title"
          placeholder="Event Title"
          value={formData.title}
          onChange={handleChange}
          required
        />
        
        <textarea
          name="description"
          placeholder="Event Description"
          value={formData.description}
          onChange={handleChange}
        />
        
        <input
          type="text"
          name="venue"
          placeholder="Venue"
          value={formData.venue}
          onChange={handleChange}
        />
        
        <input
          type="datetime-local"
          name="date"
          value={formData.date}
          onChange={handleChange}
          required
        />
        
        <input
          type="number"
          name="price"
          placeholder="Price"
          value={formData.price}
          onChange={handleChange}
          min="0"
          step="0.01"
        />
        
        <input
          type="number"
          name="total_seats"
          placeholder="Total Seats"
          value={formData.total_seats}
          onChange={handleChange}
          min="1"
        />
        
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Event'}
        </button>
      </form>
    </div>
  );
};

// My Bookings Component
const MyBookings = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const response = await axios.get('/my-bookings');
      setBookings(response.data);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading bookings...</div>;

  return (
    <div className="container">
      <h2>My Bookings</h2>
      {bookings.length === 0 ? (
        <p>You haven't made any bookings yet.</p>
      ) : (
        <div className="bookings-list">
          { bookings.map(booking => (
            <div key={booking.id} className="booking-card">
              <p><strong>Booking ID:</strong> #{booking.id}</p>
              <p><strong>Event ID:</strong> {booking.event_id}</p>
              <p><strong>Seats:</strong> {booking.seats}</p>
              <p><strong>Total Amount:</strong> ${booking.total_amount}</p>
              <p><strong>Status:</strong> <span className="status">{booking.status}</span></p>
              <p><strong>Booked on:</strong> {new Date(booking.booking_date).toLocaleDateString()}</p>
            </div>
          ))
        }
        </div>
      )}
    </div>
  );
};

// Main App Component
// Main App Component
function App() {
  const [showBookings, setShowBookings] = useState(false);

  return (
    <AuthProvider>
      <AppContent showBookings={showBookings} setShowBookings={setShowBookings} />
    </AuthProvider>
  );
}

const AppContent = ({ showBookings, setShowBookings }) => {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="App">
      <Navigation />
      
      {/* Add NotificationBar for real-time notifications */}
      {user && <NotificationBar />}
      
      <div className="main-content">
        {user && (
          <div className="tabs">
            <button 
              onClick={() => setShowBookings(false)}
              className={`tab ${!showBookings ? 'active' : ''}`}
            >
              Events
            </button>
            <button 
              onClick={() => setShowBookings(true)}
              className={`tab ${showBookings ? 'active' : ''}`}
            >
              My Bookings
            </button>
          </div>
        )}
        
        {!user && !showAuth && (
          <div className="hero">
            <h1>Welcome to EventBook</h1>
            <p>Discover and book amazing events in your area</p>
            <button onClick={() => setShowAuth(true)} className="hero-button">
              Get Started
            </button>
          </div>
        )}
        
        {!user && showAuth && (
          <AuthForm onSuccess={() => setShowAuth(false)} />
        )}
        
        {(user || !showAuth) && !showBookings && <EventsList />}
        {user && showBookings && <MyBookings />}
      </div>
    </div>
  );
};

export default App;