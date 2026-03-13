// State
let currentFilter = 'all';
let events = [];
let currentUser = null;
let authToken = null;

// DOM Elements
const eventsList = document.getElementById('eventsList');
const filterButtons = document.querySelectorAll('.filter-btn');
const eventModal = document.getElementById('eventModal');
const confirmationModal = document.getElementById('confirmationModal');
const authOverlay = document.getElementById('authOverlay');
const mainContent = document.getElementById('mainContent');
const userInfo = document.getElementById('userInfo');
const welcomeMessage = document.getElementById('welcomeMessage');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    setupFilterButtons();
    setupModals();
    initCookieBanner();
    // Untick 'No marketing please' if a channel is ticked
    ['mktEmail', 'mktSms', 'mktPhone', 'mktPost'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            if (el.checked) {
                const none = document.getElementById('mktNone');
                if (none) none.checked = false;
            }
        });
    });
});

// ─── Auth ──────────────────────────────────────────────────────────────────

function getStoredToken() {
    return sessionStorage.getItem('authToken');
}

function storeToken(token) {
    sessionStorage.setItem('authToken', token);
}

function clearToken() {
    sessionStorage.removeItem('authToken');
}

async function checkSession() {
    const token = getStoredToken();
    if (!token) {
        showAuthOverlay();
        return;
    }
    try {
        const res = await fetch('/api/auth/session', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const data = await res.json();
            setLoggedIn(data.user, token);
        } else {
            clearToken();
            showAuthOverlay();
        }
    } catch {
        showAuthOverlay();
    }
}

function showAuthOverlay() {
    authOverlay.style.display = 'flex';
    mainContent.style.display = 'none';
    userInfo.style.display = 'none';
}

function setLoggedIn(user, token) {
    currentUser = user;
    authToken = token;
    storeToken(token);
    authOverlay.style.display = 'none';
    mainContent.style.display = 'block';
    userInfo.style.display = 'flex';
    welcomeMessage.textContent = 'Welcome, ' + (user.knownAs || user.firstName) + '!';
    loadEvents();
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');

    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
    }
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
}

// ─── Cookie Consent ──────────────────────────────────────────────────────────

const COOKIE_KEY = 'cookieConsent';

function initCookieBanner() {
    const stored = localStorage.getItem(COOKIE_KEY);
    if (!stored) {
        document.getElementById('cookieBanner').style.display = 'block';
    }
}

function handleCookieChoice(choice) {
    localStorage.setItem(COOKIE_KEY, choice);
    const banner = document.getElementById('cookieBanner');
    banner.classList.add('cookie-banner--hiding');
    banner.addEventListener('animationend', () => {
        banner.style.display = 'none';
        banner.classList.remove('cookie-banner--hiding');
    }, { once: true });
}

// Returns the stored consent value ('accepted', 'rejected', or null if not yet set)
function getCookieConsent() {
    return localStorage.getItem(COOKIE_KEY);
}

// ─── Registration — Form Helpers & Validation ────────────────────────────────

// Reveals the free-text field when 'Prefer to self-describe' is chosen
function toggleGenderDescribe(value) {
    const describeInput = document.getElementById('regGenderDescribe');
    if (!describeInput) return;
    const show = value === 'self-describe';
    describeInput.style.display = show ? 'block' : 'none';
    describeInput.required = show;
    if (!show) describeInput.value = '';
}

// When 'No marketing please' is ticked, uncheck all channels (and vice versa)
function toggleMarketingNone(noneChecked) {
    const channels = ['mktEmail', 'mktSms', 'mktPhone', 'mktPost'];
    if (noneChecked) {
        channels.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });
    }
}

// Resolves the final gender string from select + optional free-text field
function resolveGender() {
    const select = document.getElementById('regGender');
    if (!select || !select.value) return '';
    if (select.value === 'self-describe') {
        const custom = document.getElementById('regGenderDescribe').value.trim();
        return custom || 'self-describe';
    }
    return select.value;
}

// Updates the confirm-password match indicator
function updatePasswordMatch() {
    const pw      = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    const msg     = document.getElementById('passwordMatchMsg');
    if (!msg) return;
    if (!confirm) {
        msg.style.display = 'none';
        return;
    }
    const matched = pw === confirm;
    msg.style.display = 'block';
    msg.className = 'password-match-msg ' + (matched ? 'pc-pass' : 'pc-fail');
    msg.textContent  = matched ? '✓ Passwords match' : '✗ Passwords do not match';
}

// Returns an object with each rule's result { length, upper, lower, number, special }
function validatePassword(password) {
    return {
        length:  password.length >= 8,
        upper:   /[A-Z]/.test(password),
        lower:   /[a-z]/.test(password),
        number:  /[0-9]/.test(password),
        special: /[!@#$%^&*]/.test(password)
    };
}

// Updates the live checklist UI beneath the password field
function updatePasswordChecklist(value) {
    const rules = validatePassword(value);
    const map = {
        'pc-length':  rules.length,
        'pc-upper':   rules.upper,
        'pc-lower':   rules.lower,
        'pc-number':  rules.number,
        'pc-special': rules.special
    };
    for (const [id, passed] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        const icon = el.querySelector('.pc-icon');
        el.classList.toggle('pc-pass', passed);
        el.classList.toggle('pc-fail', !passed);
        icon.textContent = passed ? '✓' : '✗';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    errorEl.style.display = 'none';

    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            setLoggedIn(data.user, data.token);
        } else {
            errorEl.textContent = data.error || 'Login failed.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Unable to connect. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('registerBtn');
    const errorEl = document.getElementById('registerError');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    errorEl.style.display = 'none';

    const title      = document.getElementById('regTitle').value;
    const firstName  = document.getElementById('regFirstName').value;
    const lastName   = document.getElementById('regLastName').value;
    const middleName = document.getElementById('regMiddleName').value;
    const knownAs    = document.getElementById('regKnownAs').value;
    const customerEmail = document.getElementById('regCustomerEmail').value;
    const gender = resolveGender();
    const marketingPrefs = {
        email: document.getElementById('mktEmail').checked,
        sms:   document.getElementById('mktSms').checked,
        phone: document.getElementById('mktPhone').checked,
        post:  document.getElementById('mktPost').checked
    };
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const phone = document.getElementById('regPhone').value;
    const addressLine1 = document.getElementById('regAddressLine1').value;
    const addressLine2 = document.getElementById('regAddressLine2').value;
    const postcode = document.getElementById('regPostcode').value;
    const city = document.getElementById('regCity').value;
    const county = document.getElementById('regCounty').value;
    const country = document.getElementById('regCountry').value;

    const passwordConfirm = document.getElementById('regPasswordConfirm').value;

    // Client-side password complexity guard
    const pwRules = validatePassword(password);
    if (!Object.values(pwRules).every(Boolean)) {
        errorEl.textContent = 'Please ensure your password meets all the requirements shown below the password field.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
    }

    // Confirm password match guard
    if (password !== passwordConfirm) {
        errorEl.textContent = 'Passwords do not match. Please re-enter your password.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, firstName, middleName, lastName, knownAs, gender, marketingPrefs, customerEmail, username, password,
                phone, addressLine1, addressLine2, postcode, city, county, country })
        });
        const data = await res.json();
        if (res.ok) {
            setLoggedIn(data.user, data.token);
        } else {
            errorEl.textContent = data.error || 'Registration failed.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Unable to connect. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}

function confirmLogout() {
    document.getElementById('logoutModal').style.display = 'block';
}

async function performLogout() {
    document.getElementById('logoutModal').style.display = 'none';
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
    } catch { /* best effort */ }
    currentUser = null;
    authToken = null;
    clearToken();
    // Reset forms
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    switchAuthTab('login');
    showAuthOverlay();
}

// Setup filter buttons
function setupFilterButtons() {
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.type;
            displayEvents();
        });
    });
}

// Setup modals
function setupModals() {
    const closeButtons = document.querySelectorAll('.close');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            eventModal.style.display = 'none';
            confirmationModal.style.display = 'none';
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target === eventModal) {
            eventModal.style.display = 'none';
        }
        if (e.target === confirmationModal) {
            confirmationModal.style.display = 'none';
        }
    });
}

// Load events from API
async function loadEvents() {
    try {
        const response = await fetch('/api/events');
        events = await response.json();
        displayEvents();
    } catch (error) {
        eventsList.innerHTML = '<div class="error-message">Failed to load events. Please try again later.</div>';
        console.error('Error loading events:', error);
    }
}

// Display events
function displayEvents() {
    let filteredEvents = events;
    
    if (currentFilter !== 'all') {
        filteredEvents = events.filter(event => event.type === currentFilter);
    }
    
    if (filteredEvents.length === 0) {
        eventsList.innerHTML = '<div class="loading">No events found.</div>';
        return;
    }
    
    eventsList.innerHTML = filteredEvents.map(event => `
        <div class="event-card" onclick="showEventDetails(${event.id})">
            <span class="event-type ${event.type}">${event.type}</span>
            <h3>${event.name}</h3>
            <p class="event-artist">${event.artist}</p>
            <p class="event-details">📍 ${event.venue}</p>
            <p class="event-details">📅 ${formatDate(event.date)} at ${event.time}</p>
            <p class="event-price">£${event.price.toFixed(2)}</p>
            <p class="event-availability">${event.availableTickets} tickets available</p>
        </div>
    `).join('');
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

// Show event details in modal
async function showEventDetails(eventId) {
    try {
        const response = await fetch(`/api/events/${eventId}`);
        const event = await response.json();
        
        const eventDetails = document.getElementById('eventDetails');
        eventDetails.innerHTML = `
            <div class="modal-event-header">
                <span class="event-type ${event.type}">${event.type}</span>
                <h2>${event.name}</h2>
                <p class="event-artist">${event.artist}</p>
            </div>
            
            <div class="event-info">
                <p><strong>📍 Venue:</strong> ${event.venue}</p>
                <p><strong>📅 Date:</strong> ${formatDate(event.date)}</p>
                <p><strong>🕐 Time:</strong> ${event.time}</p>
                <p><strong>💵 Price:</strong> £${event.price.toFixed(2)} per ticket</p>
                <p><strong>🎫 Available:</strong> ${event.availableTickets} tickets</p>
            </div>
            
            <div class="event-description">
                <p>${event.description}</p>
            </div>
            
            <div class="purchase-form">
                <h3>Purchase Tickets</h3>
                <form id="purchaseForm" onsubmit="handlePurchase(event, ${event.id})">
                    <div class="form-group">
                        <label for="quantity">Number of Tickets:</label>
                        <input 
                            type="number" 
                            id="quantity" 
                            name="quantity" 
                            min="1" 
                            max="${event.availableTickets}" 
                            value="1" 
                            required
                            onchange="updateTotalPrice(${event.price})"
                        >
                    </div>
                    
                    <div class="form-group">
                        <label for="customerName">Full Name:</label>
                        <input 
                            type="text" 
                            id="customerName" 
                            name="customerName" 
                            required
                            placeholder="John Doe"
                            value="${currentUser ? currentUser.customerName : ''}"
                        >
                    </div>
                    
                    <div class="form-group">
                        <label for="customerEmail">Email:</label>
                        <input 
                            type="email" 
                            id="customerEmail" 
                            name="customerEmail" 
                            required
                            placeholder="john@example.com"
                            value="${currentUser ? currentUser.customerEmail : ''}"
                        >
                    </div>
                    
                    <div class="payment-section">
                        <h4>💳 Payment Information</h4>
                        
                        <div class="form-group">
                            <label for="cardNumber">Card Number:</label>
                            <input 
                                type="text" 
                                id="cardNumber" 
                                name="cardNumber" 
                                required
                                placeholder="1234 5678 9012 3456"
                                maxlength="23"
                                autocomplete="cc-number"
                                oninput="formatCardNumber(this)"
                            >
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cardExpiry">Expiry Date:</label>
                                <input 
                                    type="text" 
                                    id="cardExpiry" 
                                    name="cardExpiry" 
                                    required
                                    placeholder="MM/YY"
                                    maxlength="5"
                                    autocomplete="cc-exp"
                                    oninput="formatCardExpiry(this)"
                                >
                            </div>
                            
                            <div class="form-group">
                                <label for="cardCvv">CVV:</label>
                                <input 
                                    type="text" 
                                    id="cardCvv" 
                                    name="cardCvv" 
                                    required
                                    placeholder="123"
                                    maxlength="4"
                                    autocomplete="cc-csc"
                                    oninput="formatCardCvv(this)"
                                >
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="cardholderName">Cardholder Name:</label>
                            <input 
                                type="text" 
                                id="cardholderName" 
                                name="cardholderName" 
                                required
                                placeholder="JOHN DOE"
                                autocomplete="cc-name"
                            >
                        </div>
                    </div>
                    
                    <p class="total-price">
                        Total: £<span id="totalPrice">${event.price.toFixed(2)}</span>
                    </p>
                    
                    <button type="submit" class="btn btn-primary">Complete Purchase</button>
                </form>
            </div>
        `;
        
        eventModal.style.display = 'block';
    } catch (error) {
        console.error('Error loading event details:', error);
        alert('Failed to load event details. Please try again.');
    }
}

// Update total price
function updateTotalPrice(pricePerTicket) {
    const quantity = document.getElementById('quantity').value;
    const total = pricePerTicket * quantity;
    document.getElementById('totalPrice').textContent = total.toFixed(2);
}

// Format card number with spaces
function formatCardNumber(input) {
    let value = input.value.replace(/\s/g, '').replace(/\D/g, '');
    let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value;
    input.value = formattedValue;
}

// Format card expiry as MM/YY
function formatCardExpiry(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length >= 2) {
        value = value.slice(0, 2) + '/' + value.slice(2, 4);
    }
    input.value = value;
}

// Format CVV (numbers only)
function formatCardCvv(input) {
    input.value = input.value.replace(/\D/g, '');
}

// Handle purchase
async function handlePurchase(event, eventId) {
    event.preventDefault();
    
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';
    
    const purchaseData = {
        eventId: eventId,
        quantity: parseInt(form.quantity.value),
        customerName: form.customerName.value,
        customerEmail: form.customerEmail.value,
        cardNumber: form.cardNumber.value,
        cardExpiry: form.cardExpiry.value,
        cardCvv: form.cardCvv.value,
        cardholderName: form.cardholderName.value
    };
    
    try {
        const response = await fetch('/api/tickets/purchase', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(purchaseData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showConfirmation(result.purchase);
            eventModal.style.display = 'none';
            loadEvents(); // Refresh events to show updated availability
        } else {
            alert('Error: ' + result.error);
            submitButton.disabled = false;
            submitButton.textContent = 'Complete Purchase';
        }
    } catch (error) {
        console.error('Error processing purchase:', error);
        alert('Failed to process purchase. Please try again.');
        submitButton.disabled = false;
        submitButton.textContent = 'Complete Purchase';
    }
}

// Show confirmation
function showConfirmation(purchase) {
    const confirmationDetails = document.getElementById('confirmationDetails');
    confirmationDetails.innerHTML = `
        <div class="confirmation-content">
            <div class="confirmation-icon">✅</div>
            <h2>Purchase Successful!</h2>
            <p>Thank you for your purchase. Your tickets have been confirmed.</p>
            
            <div class="confirmation-details">
                <p><strong>Confirmation ID:</strong> #${purchase.id}</p>
                <p><strong>Event:</strong> ${purchase.eventName}</p>
                <p><strong>Tickets:</strong> ${purchase.quantity}</p>
                <p><strong>Total Paid:</strong> £${purchase.totalPrice.toFixed(2)}</p>
                <p><strong>Name:</strong> ${purchase.customerName}</p>
                <p><strong>Email:</strong> ${purchase.customerEmail}</p>
                <p><strong>Payment Method:</strong> ${purchase.cardMasked}</p>
                <p><strong>Cardholder:</strong> ${purchase.cardholderName}</p>
            </div>
            
            <p>Thank you for your purchase!</p>
            
            <button class="btn btn-primary" onclick="confirmationModal.style.display='none'">Close</button>
        </div>
    `;
    
    confirmationModal.style.display = 'block';
}
