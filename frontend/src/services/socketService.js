// src/services/socketService.js
import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = {};
  }

  connect() {
    if (!this.socket) {
      this.socket = io(process.env.REACT_APP_API_URL || 'http://localhost:8000', {
        transports: ['websocket'],
        upgrade: false,
      });

      this.socket.on('connect', () => {
        console.log('Connected to WebSocket server');
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server');
      });

      this.socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    }
    return this.socket;
  }

  authenticate(username) {
    if (this.socket) {
      this.socket.emit('authenticate', { username });
    }
  }

  joinEventRoom(eventId) {
    if (this.socket) {
      this.socket.emit('join_event_room', { event_id: eventId });
    }
  }

  leaveEventRoom(eventId) {
    if (this.socket) {
      this.socket.emit('leave_event_room', { event_id: eventId });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }
}

const socketService = new SocketService();
export default socketService;