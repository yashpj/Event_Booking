import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import axios from 'axios';
import './PaymentForm.css';

// Replace with your publishable key
const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ event, seats, onSuccess, onCancel }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    try {
      // Create payment intent
      const { data } = await axios.post('/create-payment-intent', {
        event_id: event.id,
        seats: seats
      });

      // Confirm payment
      const result = await stripe.confirmCardPayment(data.client_secret, {
        payment_method: {
          card: elements.getElement(CardElement),
        }
      });

      if (result.error) {
        setError(result.error.message);
      } else {
        // Payment successful, confirm with backend
        await axios.post(`/confirm-payment/${data.booking_id}`);
        onSuccess(data.booking_id);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Payment failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <h3>Complete Payment</h3>
      <p>Event: {event.title}</p>
      <p>Seats: {seats}</p>
      <p>Total: ${(event.price * seats).toFixed(2)}</p>
      
      <div className="card-element">
        <CardElement />
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="payment-buttons">
        <button 
          type="submit" 
          disabled={!stripe || processing}
          className="pay-button"
        >
          {processing ? 'Processing...' : `Pay $${(event.price * seats).toFixed(2)}`}
        </button>
        <button 
          type="button" 
          onClick={onCancel}
          className="cancel-button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

const PaymentForm = (props) => {
return (
    <div className="payment-modal-overlay" onClick={(e) => {
      if (e.target.className === 'payment-modal-overlay') props.onCancel();
    }}>
      <Elements stripe={stripePromise}>
        <CheckoutForm {...props} />
      </Elements>
    </div>
    )
};

export default PaymentForm;
