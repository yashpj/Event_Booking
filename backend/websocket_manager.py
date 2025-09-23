# websocket_manager.py
import socketio
from typing import Dict, Set
import json

# Create AsyncServer instance
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins= '*'
)

# Track connected clients
connected_clients: Dict[str, str] = {}  # sid -> user_info
active_users: Set[str] = set()

@sio.event
async def connect(sid, environ):
    """Handle new client connections"""
    print(f"Client connected: {sid}")
    connected_clients[sid] = "anonymous"
    
    # Notify all clients about online users count
    await sio.emit('users_online', {
        'count': len(connected_clients),
        'users': list(active_users)
    })
    
    return True

@sio.event
async def disconnect(sid):
    """Handle client disconnections"""
    print(f"Client disconnected: {sid}")
    
    # Remove from tracking
    if sid in connected_clients:
        user = connected_clients[sid]
        del connected_clients[sid]
        if user != "anonymous" and user in active_users:
            active_users.remove(user)
    
    # Notify remaining clients
    await sio.emit('users_online', {
        'count': len(connected_clients),
        'users': list(active_users)
    })

@sio.event
async def authenticate(sid, data):
    """Handle user authentication for WebSocket"""
    username = data.get('username')
    if username:
        connected_clients[sid] = username
        active_users.add(username)
        
        await sio.emit('users_online', {
            'count': len(connected_clients),
            'users': list(active_users)
        })
        
        # Send confirmation to the specific client
        await sio.emit('authenticated', {'username': username}, to=sid)
        print(f"User {username} authenticated on socket {sid}")

@sio.event
async def join_event_room(sid, data):
    """Join a specific event room for updates"""
    event_id = data.get('event_id')
    if event_id:
        sio.enter_room(sid, f"event_{event_id}")
        await sio.emit('joined_room', {'event_id': event_id}, to=sid)
        print(f"Client {sid} joined event room: event_{event_id}")

@sio.event
async def leave_event_room(sid, data):
    """Leave a specific event room"""
    event_id = data.get('event_id')
    if event_id:
        sio.leave_room(sid, f"event_{event_id}")
        await sio.emit('left_room', {'event_id': event_id}, to=sid)

# Broadcast functions to be used from FastAPI endpoints
async def broadcast_new_event(event_data):
    """Broadcast when a new event is created"""
    await sio.emit('new_event', event_data)
    print(f"Broadcasting new event: {event_data.get('title')}")

async def broadcast_booking_update(event_id, booking_data):
    """Broadcast booking updates to specific event room"""
    await sio.emit('booking_update', booking_data, room=f"event_{event_id}")
    print(f"Broadcasting booking update for event {event_id}")

async def broadcast_seats_update(event_id, available_seats, total_seats):
    """Broadcast seat availability updates"""
    await sio.emit('seats_updated', {
        'event_id': event_id,
        'available_seats': available_seats,
        'total_seats': total_seats
    })
    print(f"Broadcasting seats update for event {event_id}: {available_seats}/{total_seats}")
