import os
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

async def send_ticket_email(email: str, username: str, event_title: str, booking_id: int):
    # This points to your local or deployed backend for the QR image
    ticket_url = f"http://localhost:8000/bookings/{booking_id}/ticket"
    
    message = Mail(
        from_email='your-verified-email@domain.com', # Use your SendGrid verified sender
        to_emails=email,
        subject=f'Ticket Confirmed: {event_title}',
        html_content=f'''
            <h3>Hello {username},</h3>
            <p>Your booking for <strong>{event_title}</strong> is successful!</p>
            <p>Your Booking ID is: #{booking_id}</p>
            <p>You can view your QR ticket here: <a href="{ticket_url}">View Ticket</a></p>
        '''
    )
    try:
        sg = SendGridAPIClient(os.getenv('SENDGRID_API_KEY'))
        sg.send(message)
    except Exception as e:
        print(f"SendGrid Error: {e}")
# Make sure to set SENDGRID_API_KEY in your environment variables
