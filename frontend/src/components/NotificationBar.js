// src/components/NotificationBar.js
import React, { useState, useEffect } from 'react';
import socketService from '../services/socketService';
import './NotificationBar.css';

const NotificationBar = () => {
  const [notifications, setNotifications] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(0);

  useEffect(() => {
    // Listen for various socket events
    socketService.on('users_online', (data) => {
      setOnlineUsers(data.count);
    });

    socketService.on('new_event', (eventData) => {
      addNotification({
        id: Date.now(),
        type: 'new_event',
        message: `New event: ${eventData.title} by ${eventData.created_by}`,
        timestamp: new Date()
      });
    });

    socketService.on('booking_update', (data) => {
      addNotification({
        id: Date.now(),
        type: 'booking',
        message: `${data.booked_by} booked ${data.seats_booked} seat(s) for ${data.event_title}`,
        timestamp: new Date()
      });
    });

    socketService.on('seats_updated', (data) => {
      addNotification({
        id: Date.now(),
        type: 'seats',
        message: `Seats update: ${data.available_seats}/${data.total_seats} available for Event #${data.event_id}`,
        timestamp: new Date()
      });
    });

    // Cleanup
    return () => {
      socketService.off('users_online');
      socketService.off('new_event');
      socketService.off('booking_update');
      socketService.off('seats_updated');
    };
  }, []);

  const addNotification = (notification) => {
    setNotifications(prev => [notification, ...prev].slice(0, 5)); // Keep only last 5
    
    // Auto-remove notification after 5 seconds
    setTimeout(() => {
      removeNotification(notification.id);
    }, 5000);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <div className="notification-container">
      <div className="online-indicator">
        <span className="online-dot"></span>
        {onlineUsers} users online
      </div>
      
      <div className="notifications-list">
        {notifications.map(notification => (
          <div 
            key={notification.id} 
            className={`notification notification-${notification.type}`}
            onClick={() => removeNotification(notification.id)}
          >
            {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationBar;