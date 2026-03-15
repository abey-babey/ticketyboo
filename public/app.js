// State
let currentFilter = 'all';
let events = [];
let currentUser = null;
let authToken = null;
let pendingChallengeId = null;

// DOM Elements
const eventsList = document.getElementById('eventsList');
const filterButtons = document.querySelectorAll('.filter-btn');
const eventModal = document.getElementById('eventModal');
const confirmationModal = document.getElementById('confirmationModal');
const accountModal = document.getElementById('accountModal');
const authOverlay = document.getElementById('authOverlay');
const mainContent = document.getElementById('mainContent');
const userInfo = document.getElementById('userInfo');
const authActions = document.getElementById('authActions');
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
        showAsGuest();
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
            showAsGuest();
        }
    } catch {
        showAsGuest();
    }
}

function showAuthOverlay(tab) {
    authOverlay.style.display = 'flex';
    if (tab) switchAuthTab(tab);
}

function closeAuthOverlay() {
    authOverlay.style.display = 'none';
}

function showAsGuest() {
    currentUser = null;
    authToken = null;
    authOverlay.style.display = 'none';
    mainContent.style.display = 'block';
    authActions.style.display = 'flex';
    userInfo.style.display = 'none';
    loadEvents();
}

function setLoggedIn(user, token) {
    currentUser = user;
    authToken = token;
    storeToken(token);
    authOverlay.style.display = 'none';
    mainContent.style.display = 'block';
    authActions.style.display = 'none';
    userInfo.style.display = 'flex';
    welcomeMessage.textContent = 'Welcome, ' + (user.knownAs || user.firstName) + '!';
    loadEvents();
}

function switchAuthPanel(panel) {
    const allPanels = ['loginForm', 'registerForm', 'resetRequestPanel', 'resetConfirmPanel', 'twoFaPanel'];
    const tabPanels = ['login', 'register'];
    const authTabs = document.querySelector('.auth-tabs');

    allPanels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const showTabs = tabPanels.includes(panel);
    if (authTabs) authTabs.style.display = showTabs ? 'flex' : 'none';

    if (panel === 'login') {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('tabLogin').classList.add('active');
        document.getElementById('tabRegister').classList.remove('active');
        document.getElementById('loginError').style.display = 'none';
    } else if (panel === 'register') {
        document.getElementById('registerForm').style.display = 'block';
        document.getElementById('tabLogin').classList.remove('active');
        document.getElementById('tabRegister').classList.add('active');
        document.getElementById('registerError').style.display = 'none';
    } else if (panel === 'reset-request') {
        const el = document.getElementById('resetRequestPanel');
        if (el) el.style.display = 'block';
    } else if (panel === 'reset-confirm') {
        const el = document.getElementById('resetConfirmPanel');
        if (el) el.style.display = 'block';
    } else if (panel === '2fa') {
        const el = document.getElementById('twoFaPanel');
        if (el) el.style.display = 'block';
    }
}

function switchAuthTab(tab) { switchAuthPanel(tab); }

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

// ─── Password / Passphrase validation ────────────────────────────────────────
// Mirrors lib/passwordValidator.js — two valid credential styles:
//   Traditional password : 8+ chars, upper, lower, digit, special char
//   Passphrase           : 20+ chars, 2+ uppercase letters, 1+ digit

const PASSPHRASE_MIN = 20;

// Audit object for the traditional password rules
function validatePassword(password) {
    return {
        length:  password.length >= 8,
        upper:   /[A-Z]/.test(password),
        lower:   /[a-z]/.test(password),
        number:  /[0-9]/.test(password),
        special: /[!@#$%^&*]/.test(password)
    };
}

// Audit object for the passphrase rules
function validatePassphrase(password) {
    const upperCount = (password.match(/[A-Z]/g) || []).length;
    return {
        length: password.length >= PASSPHRASE_MIN,
        upper:  upperCount >= 2,
        number: /[0-9]/.test(password)
    };
}

// Returns true if either credential style passes — used in submit guards
function isValidCredential(password) {
    if (Object.values(validatePassword(password)).every(Boolean)) return true;
    return Object.values(validatePassphrase(password)).every(Boolean);
}

/**
 * Updates a dual-mode password checklist.
 * @param {string} value   Current input value
 * @param {string} prefix  ID prefix: 'pc' | 'apc' | 'rpc'
 */
function updateChecklistForPrefix(value, prefix) {
    const isPassphrase = value.length >= PASSPHRASE_MIN;
    const pwRules = validatePassword(value);
    const ppRules = validatePassphrase(value);

    // Traditional items
    const pwMap = {
        [`${prefix}-length`]:  pwRules.length,
        [`${prefix}-upper`]:   pwRules.upper,
        [`${prefix}-lower`]:   pwRules.lower,
        [`${prefix}-number`]:  pwRules.number,
        [`${prefix}-special`]: pwRules.special
    };
    for (const [id, passed] of Object.entries(pwMap)) {
        const el = document.getElementById(id);
        if (!el) continue;
        const icon = el.querySelector('.pc-icon');
        if (isPassphrase) {
            // Fade traditional section — neither pass nor fail
            el.classList.remove('pc-pass', 'pc-fail');
            el.classList.add('pc-muted');
            icon.textContent = '○';
        } else {
            el.classList.remove('pc-muted');
            el.classList.toggle('pc-pass', passed);
            el.classList.toggle('pc-fail', !passed);
            icon.textContent = passed ? '✓' : '✗';
        }
    }

    // Mode label
    const labelEl = document.getElementById(`${prefix}-mode-label`);
    if (labelEl) {
        labelEl.textContent = isPassphrase ? 'Passphrase (active):' : 'Traditional password:';
        labelEl.classList.toggle('pc-mode-active', true);
    }

    // Passphrase items
    const ppMap = {
        [`${prefix}-pp-length`]: ppRules.length,
        [`${prefix}-pp-upper`]:  ppRules.upper,
        [`${prefix}-pp-number`]: ppRules.number
    };
    for (const [id, passed] of Object.entries(ppMap)) {
        const el = document.getElementById(id);
        if (!el) continue;
        const icon = el.querySelector('.pc-icon');
        if (!isPassphrase) {
            el.classList.remove('pc-pass', 'pc-fail');
            el.classList.add('pc-muted');
            icon.textContent = '○';
        } else {
            el.classList.remove('pc-muted');
            el.classList.toggle('pc-pass', passed);
            el.classList.toggle('pc-fail', !passed);
            icon.textContent = passed ? '✓' : '✗';
        }
    }
}

// Public wrappers — called from HTML oninput handlers
function updatePasswordChecklist(value)       { updateChecklistForPrefix(value, 'pc');  }
function updateResetPasswordChecklist(value)   { updateChecklistForPrefix(value, 'rpc'); }
function updateAccountPasswordChecklist(value) { updateChecklistForPrefix(value, 'apc'); }

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
            if (data.requiresTwoFa) {
                pendingChallengeId = data.challengeId;
                const notice = document.getElementById('twoFaEmailNotice');
                if (notice) {
                    notice.innerHTML = data.previewUrl
                        ? `📧 A verification code has been sent. <a href="${data.previewUrl}" target="_blank" rel="noopener">View it in Ethereal →</a>`
                        : '📧 A verification code has been sent to your registered email address.';
                    notice.style.display = 'block';
                }
                switchAuthPanel('2fa');
            } else {
                setLoggedIn(data.user, data.token);
            }
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

    // Client-side password complexity guard (traditional OR passphrase)
    if (!isValidCredential(password)) {
        errorEl.textContent = 'Please ensure your password meets the requirements shown below (traditional password or passphrase).';
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

// ─── Password Reset ──────────────────────────────────────────────────────────

async function handleResetRequest(e) {
    e.preventDefault();
    const btn     = document.getElementById('resetRequestBtn');
    const errorEl = document.getElementById('resetRequestMsg');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    errorEl.style.display = 'none';

    const username      = document.getElementById('resetUsername').value.trim();
    const customerEmail = document.getElementById('resetEmail').value.trim();

    try {
        const res  = await fetch('/api/auth/reset-password/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, customerEmail })
        });
        const data = await res.json();
        if (res.ok) {
            const notice = document.getElementById('resetEmailSentNotice');
            if (notice) {
                notice.innerHTML = data.previewUrl
                    ? `📧 Reset email sent! <a href="${data.previewUrl}" target="_blank" rel="noopener">View it in Ethereal →</a>`
                    : '📧 Reset email sent! Check your inbox for the reset token.';
                notice.style.display = 'block';
            }
            switchAuthPanel('reset-confirm');
        } else {
            errorEl.textContent = data.error || 'Request failed.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Unable to connect. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Reset Email';
    }
}

async function handleResetConfirm(e) {
    e.preventDefault();
    const btn     = document.getElementById('resetConfirmBtn');
    const errorEl = document.getElementById('resetConfirmMsg');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    errorEl.style.display = 'none';

    const token    = document.getElementById('resetToken').value.trim();
    const newPw    = document.getElementById('resetNewPw').value;
    const confirmPw = document.getElementById('resetConfirmPw').value;

    if (!isValidCredential(newPw)) {
        errorEl.textContent = 'Password does not meet the requirements (traditional password or 20+ character passphrase).';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Reset Password';
        return;
    }
    if (newPw !== confirmPw) {
        errorEl.textContent = 'Passwords do not match.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Reset Password';
        return;
    }

    try {
        const res  = await fetch('/api/auth/reset-password/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword: newPw })
        });
        const data = await res.json();
        if (res.ok) {
            switchAuthPanel('login');
            const loginError = document.getElementById('loginError');
            if (loginError) {
                loginError.textContent = '✓ Password reset successfully. Please sign in with your new password.';
                loginError.style.cssText = 'display:block; color: #2e7d32; background:#e8f5e9; border-color:#a5d6a7;';
            }
        } else {
            errorEl.textContent = data.error || 'Reset failed.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Unable to connect. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Password';
    }
}

// ─── Two-Factor Authentication ───────────────────────────────────────────────

async function handleTwoFaVerify(e) {
    e.preventDefault();
    const btn     = document.getElementById('twoFaBtn');
    const errorEl = document.getElementById('twoFaError');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    errorEl.style.display = 'none';

    const code = document.getElementById('twoFaCode').value.trim();

    try {
        const res  = await fetch('/api/auth/verify-2fa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeId: pendingChallengeId, otp: code })
        });
        const data = await res.json();
        if (res.ok) {
            pendingChallengeId = null;
            setLoggedIn(data.user, data.token);
        } else {
            errorEl.textContent = data.error || 'Verification failed.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Unable to connect. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify Code';
    }
}

function updateResetPasswordMatch() {
    const pw      = document.getElementById('resetNewPw').value;
    const confirm = document.getElementById('resetConfirmPw').value;
    const msg     = document.getElementById('resetPasswordMatchMsg');
    if (!msg) return;
    if (!confirm) { msg.style.display = 'none'; return; }
    const matched = pw === confirm;
    msg.style.display = 'block';
    msg.className = 'password-match-msg ' + (matched ? 'pc-pass' : 'pc-fail');
    msg.textContent = matched ? '✓ Passwords match' : '✗ Passwords do not match';
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
    pendingChallengeId = null;
    switchAuthPanel('login');
    showAsGuest();
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
        if (e.target === authOverlay) {
            closeAuthOverlay();
        }
        if (e.target === eventModal) {
            eventModal.style.display = 'none';
        }
        if (e.target === confirmationModal) {
            confirmationModal.style.display = 'none';
        }
        if (e.target === accountModal) {
            closeAccountModal();
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
                <h3>Purchase Tickets</h3>                ${!currentUser ? `
                <div class="guest-purchase-notice">
                    <span class="guest-purchase-notice__icon">💡</span>
                    <p><a href="#" onclick="eventModal.style.display='none'; showAuthOverlay('login'); return false;">Sign in or create an account</a> to save your details and view purchase history &mdash; or fill in the form below to continue as a guest.</p>
                </div>` : ''}                <form id="purchaseForm" onsubmit="handlePurchase(event, ${event.id})">
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
                        ${currentUser && currentUser.savedCards && currentUser.savedCards.length > 0 ? `
                        <div class="form-group">
                            <label for="savedCardSelect">Payment Method:</label>
                            <select id="savedCardSelect" onchange="handleCardSelectChange()">
                                <option value="">&plus; Enter a new card</option>
                                ${currentUser.savedCards.map(card => `<option value="${card.id}">${card.nickname ? escapeHtml(card.nickname) + ' \u2014 ' : ''}${card.cardMasked} &bull; ${escapeHtml(card.cardholderName)} &bull; Exp ${card.cardExpiry}</option>`).join('')}
                            </select>
                        </div>
                        <div id="savedCardConfirmBanner" class="saved-card-confirm-banner" style="display:none">
                            <span>&#10003; Using saved card: </span><strong id="savedCardConfirmLabel"></strong>
                        </div>` : ''}
                        <div id="newCardFields">
                        <div class="form-group">
                            <label for="cardNumber">Card Number:</label>
                            <input 
                                type="text" 
                                id="cardNumber" 
                                name="cardNumber" 
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
                                placeholder="JOHN DOE"
                                autocomplete="cc-name"
                            >
                        </div>
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

// Toggle new-card fields when a saved card is selected
function handleCardSelectChange() {
    const select = document.getElementById('savedCardSelect');
    const newCardFields = document.getElementById('newCardFields');
    const banner = document.getElementById('savedCardConfirmBanner');
    const label  = document.getElementById('savedCardConfirmLabel');

    if (select && select.value) {
        if (newCardFields) newCardFields.style.display = 'none';
        if (banner)        banner.style.display = 'block';
        const cardId = parseInt(select.value);
        const card   = currentUser && currentUser.savedCards
            ? currentUser.savedCards.find(c => c.id === cardId)
            : null;
        if (card && label) {
            label.textContent = (card.nickname ? card.nickname + ' \u2014 ' : '') +
                card.cardMasked + ' \u00B7 ' + card.cardholderName +
                ' \u00B7 Exp ' + card.cardExpiry;
        }
    } else {
        if (newCardFields) newCardFields.style.display = 'block';
        if (banner)        banner.style.display = 'none';
    }
}

// Handle purchase
async function handlePurchase(event, eventId) {
    event.preventDefault();
    
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';

    // Check if a saved card is selected
    const savedCardSelect = document.getElementById('savedCardSelect');
    const savedCardId = savedCardSelect ? savedCardSelect.value : '';

    // Validate raw card fields if not using a saved card
    if (!savedCardId) {
        const cardNumber     = form.cardNumber     ? form.cardNumber.value.trim()     : '';
        const cardExpiry     = form.cardExpiry     ? form.cardExpiry.value.trim()     : '';
        const cardCvv        = form.cardCvv        ? form.cardCvv.value.trim()        : '';
        const cardholderName = form.cardholderName ? form.cardholderName.value.trim() : '';
        if (!cardNumber || !cardExpiry || !cardCvv || !cardholderName) {
            alert('Please enter your payment card details.');
            submitButton.disabled = false;
            submitButton.textContent = 'Complete Purchase';
            return;
        }
    }

    const purchaseData = {
        eventId:       eventId,
        quantity:      parseInt(form.quantity.value),
        customerName:  form.customerName.value,
        customerEmail: form.customerEmail.value
    };

    if (savedCardId) {
        purchaseData.savedCardId = parseInt(savedCardId);
    } else {
        purchaseData.cardNumber     = form.cardNumber.value;
        purchaseData.cardExpiry     = form.cardExpiry.value;
        purchaseData.cardCvv        = form.cardCvv.value;
        purchaseData.cardholderName = form.cardholderName.value;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    
    try {
        const response = await fetch('/api/tickets/purchase', {
            method: 'POST',
            headers,
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
            
            <div class="confirmation-actions">
                <a class="btn btn-secondary"
                   href="/api/tickets/${purchase.id}/pdf"
                   target="_blank"
                   download="ticket-${purchase.id}.pdf">&#128229; Download Ticket PDF</a>
                <button class="btn btn-primary" onclick="confirmationModal.style.display='none'">Close</button>
            </div>
        </div>
    `;
    
    confirmationModal.style.display = 'block';
}

// ─── My Account Modal ──────────────────────────────────────────────────────

function openAccountModal() {
    accountModal.style.display = 'block';
    // Always land on Profile tab and populate it
    switchAccountTab('profile');
}

function closeAccountModal() {
    accountModal.style.display = 'none';
}

function switchAccountTab(tab) {
    ['profile', 'security', 'cards', 'purchases', 'support'].forEach(t => {
        const tabBtn   = document.getElementById('accountTab'   + t.charAt(0).toUpperCase() + t.slice(1));
        const tabPanel = document.getElementById('accountPanel' + t.charAt(0).toUpperCase() + t.slice(1));
        if (!tabBtn || !tabPanel) return;
        const active   = t === tab;
        tabBtn.classList.toggle('active', active);
        tabPanel.style.display = active ? 'block' : 'none';
    });
    if (tab === 'profile')   loadAccountProfile();
    if (tab === 'security' && currentUser) {
        document.getElementById('acctUsername').value = currentUser.username || '';
        const toggle = document.getElementById('acctTwoFaToggle');
        if (toggle) toggle.checked = currentUser.twoFactorEnabled || false;
    }
    if (tab === 'cards')     loadSavedCards();
    if (tab === 'purchases') loadPurchaseHistory();
    if (tab === 'support')   loadSupportHistory();
}

function loadAccountProfile() {
    if (!currentUser) return;
    document.getElementById('acctTitle').value        = currentUser.title        || '';
    document.getElementById('acctFirstName').value    = currentUser.firstName    || '';
    document.getElementById('acctMiddleName').value   = currentUser.middleName   || '';
    document.getElementById('acctLastName').value     = currentUser.lastName     || '';
    document.getElementById('acctKnownAs').value      = currentUser.knownAs      || '';
    document.getElementById('acctEmail').value        = currentUser.customerEmail || '';
    document.getElementById('acctPhone').value        = currentUser.phone        || '';
    document.getElementById('acctAddressLine1').value = currentUser.addressLine1 || '';
    document.getElementById('acctAddressLine2').value = currentUser.addressLine2 || '';
    document.getElementById('acctPostcode').value     = currentUser.postcode     || '';
    document.getElementById('acctCity').value         = currentUser.city         || '';
    document.getElementById('acctCounty').value       = currentUser.county       || '';
    document.getElementById('acctCountry').value      = currentUser.country      || '';
}

async function saveProfile(e) {
    e.preventDefault();
    const btn   = e.target.querySelector('button[type="submit"]');
    const msgEl = document.getElementById('acctProfileMsg');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    msgEl.style.display = 'none';

    const payload = {
        title:        document.getElementById('acctTitle').value,
        firstName:    document.getElementById('acctFirstName').value,
        middleName:   document.getElementById('acctMiddleName').value,
        lastName:     document.getElementById('acctLastName').value,
        knownAs:      document.getElementById('acctKnownAs').value,
        customerEmail: document.getElementById('acctEmail').value,
        phone:        document.getElementById('acctPhone').value,
        addressLine1: document.getElementById('acctAddressLine1').value,
        addressLine2: document.getElementById('acctAddressLine2').value,
        postcode:     document.getElementById('acctPostcode').value,
        city:         document.getElementById('acctCity').value,
        county:       document.getElementById('acctCounty').value,
        country:      document.getElementById('acctCountry').value
    };

    try {
        const res  = await fetch('/api/account', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = { ...currentUser, ...data.user };
            welcomeMessage.textContent = 'Welcome, ' + (currentUser.knownAs || currentUser.firstName) + '!';
            showAccountMsg('acctProfileMsg', 'Profile saved successfully.', 'success');
        } else {
            showAccountMsg('acctProfileMsg', data.error || 'Failed to save profile.', 'error');
        }
    } catch {
        showAccountMsg('acctProfileMsg', 'Could not connect to server.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile';
    }
}

async function saveUsername(e) {
    e.preventDefault();
    const btn         = e.target.querySelector('button[type="submit"]');
    const newUsername = document.getElementById('acctUsername').value.trim();
    if (!newUsername) return;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res  = await fetch('/api/account', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({
                username:     newUsername,
                firstName:    currentUser.firstName,
                lastName:     currentUser.lastName,
                customerEmail: currentUser.customerEmail
            })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = { ...currentUser, ...data.user };
            showAccountMsg('acctUsernameMsg', 'Username updated successfully.', 'success');
        } else {
            showAccountMsg('acctUsernameMsg', data.error || 'Failed to update username.', 'error');
        }
    } catch {
        showAccountMsg('acctUsernameMsg', 'Could not connect to server.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Change Username';
    }
}

async function savePassword(e) {
    e.preventDefault();
    const btn   = e.target.querySelector('button[type="submit"]');
    const msgEl = document.getElementById('acctPasswordMsg');
    const currentPw = document.getElementById('acctCurrentPw').value;
    const newPw     = document.getElementById('acctNewPw').value;
    const confirmPw = document.getElementById('acctConfirmPw').value;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    msgEl.style.display = 'none';

    if (!isValidCredential(newPw)) {
        showAccountMsg('acctPasswordMsg', 'New password does not meet requirements (traditional password or 20+ character passphrase).', 'error');
        btn.disabled = false;
        btn.textContent = 'Change Password';
        return;
    }
    if (newPw !== confirmPw) {
        showAccountMsg('acctPasswordMsg', 'New passwords do not match.', 'error');
        btn.disabled = false;
        btn.textContent = 'Change Password';
        return;
    }

    try {
        const res  = await fetch('/api/account/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('accountPasswordForm').reset();
            updateAccountPasswordChecklist('');
            showAccountMsg('acctPasswordMsg', 'Password changed successfully.', 'success');
        } else {
            showAccountMsg('acctPasswordMsg', data.error || 'Failed to change password.', 'error');
        }
    } catch {
        showAccountMsg('acctPasswordMsg', 'Could not connect to server.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Change Password';
    }
}

function updateAccountPasswordMatch() {
    const pw      = document.getElementById('acctNewPw').value;
    const confirm = document.getElementById('acctConfirmPw').value;
    const msg     = document.getElementById('acctPasswordMatchMsg');
    if (!msg) return;
    if (!confirm) { msg.style.display = 'none'; return; }
    const matched = pw === confirm;
    msg.style.display = 'block';
    msg.className = 'password-match-msg ' + (matched ? 'pc-pass' : 'pc-fail');
    msg.textContent = matched ? '✓ Passwords match' : '✗ Passwords do not match';
}

async function saveTwoFaSetting(enabled) {
    const msgEl = document.getElementById('acctTwoFaMsg');
    if (msgEl) msgEl.style.display = 'none';
    try {
        const res  = await fetch('/api/account', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({
                twoFactorEnabled: enabled,
                firstName:        currentUser.firstName,
                lastName:         currentUser.lastName,
                customerEmail:    currentUser.customerEmail
            })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = { ...currentUser, ...data.user };
            showAccountMsg('acctTwoFaMsg', enabled ? '2FA enabled.' : '2FA disabled.', 'success');
        } else {
            showAccountMsg('acctTwoFaMsg', data.error || 'Failed to update 2FA setting.', 'error');
            // Revert toggle on failure
            const toggle = document.getElementById('acctTwoFaToggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch {
        showAccountMsg('acctTwoFaMsg', 'Could not connect to server.', 'error');
        const toggle = document.getElementById('acctTwoFaToggle');
        if (toggle) toggle.checked = !enabled;
    }
}

// ─── Saved Cards ───────────────────────────────────────────────────────────

async function loadSavedCards() {
    const listEl = document.getElementById('savedCardsList');
    listEl.innerHTML = '<p class="form-section-note">Loading...</p>';
    try {
        const res  = await fetch('/api/account/cards', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        renderSavedCards(data.cards || []);
    } catch {
        listEl.innerHTML = '<p class="account-feedback account-feedback--error">Failed to load cards.</p>';
    }
}

function renderSavedCards(cards) {
    const listEl = document.getElementById('savedCardsList');
    if (!cards || cards.length === 0) {
        listEl.innerHTML = '<p class="form-section-note saved-cards-empty">No saved cards yet.</p>';
        return;
    }
    listEl.innerHTML = cards.map(card => `
        <div class="saved-card-item" data-card-id="${card.id}">
            <div class="saved-card-info">
                <span class="saved-card-icon">💳</span>
                <div>
                    <strong class="saved-card-name">${card.nickname ? escapeHtml(card.nickname) + ' \u2014 ' : ''}${card.cardMasked}</strong>
                    <span class="saved-card-meta">${escapeHtml(card.cardholderName)} &bull; Exp: ${card.cardExpiry}</span>
                </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deleteCard(${card.id})">Remove</button>
        </div>
    `).join('');
}

async function handleAddCard(e) {
    e.preventDefault();
    const btn   = document.getElementById('addCardBtn');
    const msgEl = document.getElementById('addCardMsg');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    msgEl.style.display = 'none';

    const payload = {
        nickname:       document.getElementById('cardNickname').value.trim(),
        cardNumber:     document.getElementById('savedCardNumber').value,
        cardExpiry:     document.getElementById('savedCardExpiry').value,
        cardholderName: document.getElementById('savedCardholderName').value.trim()
    };

    try {
        const res  = await fetch('/api/account/cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('addCardForm').reset();
            showAccountMsg('addCardMsg', 'Card saved successfully.', 'success');
            // Keep currentUser.savedCards in sync so the purchase form sees the new card
            if (currentUser && data.card) {
                if (!currentUser.savedCards) currentUser.savedCards = [];
                currentUser.savedCards.push(data.card);
            }
            loadSavedCards();
        } else {
            showAccountMsg('addCardMsg', data.error || 'Failed to save card.', 'error');
        }
    } catch {
        showAccountMsg('addCardMsg', 'Could not connect to server.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Card';
    }
}

async function deleteCard(cardId) {
    if (!confirm('Remove this card from your account?')) return;
    try {
        const res = await fetch('/api/account/cards/' + cardId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (res.ok) {
            // Keep currentUser.savedCards in sync so the purchase form reflects the removal
            if (currentUser && currentUser.savedCards) {
                currentUser.savedCards = currentUser.savedCards.filter(c => c.id !== cardId);
            }
            loadSavedCards();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to remove card.');
        }
    } catch {
        alert('Could not connect to server.');
    }
}

// ─── Purchase History ──────────────────────────────────────────────────────

async function loadPurchaseHistory() {
    const listEl = document.getElementById('purchaseHistoryList');
    if (!listEl) return;
    listEl.innerHTML = '<p class="form-section-note">Loading...</p>';
    try {
        const res  = await fetch('/api/account/purchases', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        renderPurchaseHistory(data.purchases || []);
    } catch {
        listEl.innerHTML = '<p class="account-feedback account-feedback--error">Failed to load purchase history.</p>';
    }
}

function renderPurchaseHistory(purchases) {
    const listEl = document.getElementById('purchaseHistoryList');
    if (!purchases || purchases.length === 0) {
        listEl.innerHTML = '<p class="form-section-note purchase-history-empty">No purchases yet. Go grab some tickets!</p>';
        return;
    }
    listEl.innerHTML = purchases.map(p => `
        <div class="purchase-history-item">
            <div class="purchase-history-info">
                <strong class="purchase-history-name">${escapeHtml(p.eventName)}</strong>
                <span class="purchase-history-meta">
                    ${p.quantity} ticket${p.quantity !== 1 ? 's' : ''} &bull;
                    &pound;${p.totalPrice.toFixed(2)} &bull;
                    ${new Date(p.purchaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span class="purchase-history-ref">Ref: #${p.id} &bull; ${escapeHtml(p.cardMasked)}</span>
            </div>
            <a class="btn btn-secondary btn-sm"
               href="/api/tickets/${p.id}/pdf"
               target="_blank"
               download="ticket-${p.id}.pdf"
               title="Download ticket PDF">&#128229; PDF</a>
        </div>
    `).join('');
}

// ─── Account feedback helpers ──────────────────────────────────────────────

function showAccountMsg(elId, text, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.className = 'account-feedback account-feedback--' + type;
    el.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ────────────────────────────────────────────────────────────
// Support
// ────────────────────────────────────────────────────────────

let currentThreadTicketId = null;

function openSupportModal() {
    const modal = document.getElementById('supportModal');
    if (!modal) return;
    // Reset form
    document.getElementById('supportForm').reset();
    document.getElementById('supportFormMsg').textContent = '';
    document.getElementById('supportSuccessState').style.display = 'none';
    document.getElementById('supportForm').style.display = '';
    // Show/hide guest fields
    const guestNameG  = document.getElementById('supportGuestNameGroup');
    const guestEmailG = document.getElementById('supportGuestEmailGroup');
    if (guestNameG)  guestNameG.style.display  = currentUser ? 'none' : '';
    if (guestEmailG) guestEmailG.style.display = currentUser ? 'none' : '';
    modal.style.display = 'flex';
}

function closeSupportModal() {
    const modal = document.getElementById('supportModal');
    if (modal) modal.style.display = 'none';
}

async function submitSupportRequest(e) {
    e.preventDefault();
    const btn     = document.getElementById('supportSubmitBtn');
    const msgEl   = document.getElementById('supportFormMsg');
    const subject = document.getElementById('supportSubject').value;
    const message = document.getElementById('supportMessage').value;
    const bookingRef = document.getElementById('supportBookingRef').value.trim();

    msgEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const body = { subject, message, bookingRef };
    if (!currentUser) {
        body.name  = document.getElementById('supportGuestName').value.trim();
        body.email = document.getElementById('supportGuestEmail').value.trim();
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        const token   = getStoredToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res  = await fetch('/api/support/tickets', { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();

        if (!res.ok) {
            msgEl.textContent = data.error || 'Failed to submit request.';
            msgEl.className   = 'account-feedback account-feedback--error';
        } else {
            document.getElementById('supportForm').style.display = 'none';
            const successMsg = document.getElementById('supportSuccessMsg');
            successMsg.textContent = `Your request has been received (Ref #${data.ticketId}).` +
                (data.previewUrl ? ' A confirmation email has been sent.' : '');
            document.getElementById('supportSuccessState').style.display = '';
        }
    } catch (err) {
        msgEl.textContent = 'Network error, please try again.';
        msgEl.className   = 'account-feedback account-feedback--error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Request';
    }
}

async function loadSupportHistory() {
    const list = document.getElementById('supportHistoryList');
    if (!list || !currentUser) return;
    list.innerHTML = '<p>Loading…</p>';
    try {
        const res     = await fetch('/api/support/tickets', { headers: { 'Authorization': 'Bearer ' + getStoredToken() } });
        const tickets = await res.json();
        if (!res.ok) { list.innerHTML = '<p>Could not load support history.</p>'; return; }
        if (!tickets.length) { list.innerHTML = '<p>No support requests yet.</p>'; return; }

        const statusBadge = s => {
            const map = { open: '#e53e3e', in_progress: '#dd6b20', resolved: '#38a169', closed: '#718096' };
            return `<span style="background:${map[s]||'#718096'};color:#fff;padding:2px 8px;border-radius:4px;font-size:.75rem">${s.replace('_', ' ')}</span>`;
        };

        list.innerHTML = tickets.map(t => `
          <div class="purchase-history-item" style="cursor:pointer" onclick="openSupportThread(${t.id})">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
              <strong>${escapeHtml(t.subject)}</strong>
              ${statusBadge(t.status)}
            </div>
            <div style="font-size:.8rem;color:#666;margin-top:.25rem">
              Ref #${t.id} &nbsp;·&nbsp; ${new Date(t.createdAt).toLocaleDateString('en-GB')} &nbsp;·&nbsp; ${t.messageCount} message${t.messageCount !== 1 ? 's' : ''}
              &mdash; <a href="#" onclick="openSupportThread(${t.id}); return false;">View thread &rsaquo;</a>
            </div>
          </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<p>Error loading support history.</p>';
    }
}

async function openSupportThread(ticketId) {
    currentThreadTicketId = ticketId;
    const modal = document.getElementById('supportThreadModal');
    if (!modal) return;
    document.getElementById('supportThreadMessages').innerHTML = '<p>Loading…</p>';
    document.getElementById('supportThreadMeta').innerHTML = '';
    document.getElementById('supportReplyBody').value = '';
    document.getElementById('supportReplyMsg').textContent = '';
    modal.style.display = 'flex';

    try {
        const res    = await fetch(`/api/support/tickets/${ticketId}`, { headers: { 'Authorization': 'Bearer ' + getStoredToken() } });
        const ticket = await res.json();
        if (!res.ok) { document.getElementById('supportThreadMessages').innerHTML = '<p>Could not load ticket.</p>'; return; }

        document.getElementById('supportThreadTitle').textContent = `Ref #${ticket.id}: ${ticket.subject}`;
        document.getElementById('supportThreadMeta').innerHTML =
            `<span>Status: <strong>${ticket.status.replace('_',' ')}</strong></span>`;

        const msgs = ticket.messages || [];
        const replyForm = document.getElementById('supportReplyForm');
        const canReply  = ticket.status !== 'resolved' && ticket.status !== 'closed';
        replyForm.style.display = canReply ? '' : 'none';

        document.getElementById('supportThreadMessages').innerHTML = msgs.length
            ? msgs.map(m => {
                const align = m.isAdmin ? 'right' : 'left';
                const bg    = m.isAdmin ? '#eef2ff' : '#f7fafc';
                const label = m.isAdmin ? 'Support Team' : (m.authorName || 'You');
                return `<div style="text-align:${align};margin:.75rem 0">
                  <div style="display:inline-block;max-width:80%;background:${bg};border-radius:8px;padding:.6rem .9rem;text-align:left">
                    <div style="font-size:.75rem;color:#666;margin-bottom:.3rem">${escapeHtml(label)} &bull; ${new Date(m.createdAt).toLocaleString('en-GB')}</div>
                    <div>${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>
                  </div>
                </div>`;
              }).join('')
            : '<p style="color:#999">No messages yet.</p>';
    } catch (err) {
        document.getElementById('supportThreadMessages').innerHTML = '<p>Error loading thread.</p>';
    }
}

function closeSupportThread() {
    const modal = document.getElementById('supportThreadModal');
    if (modal) modal.style.display = 'none';
    currentThreadTicketId = null;
}

async function submitSupportReply(e) {
    e.preventDefault();
    const btn   = document.getElementById('supportReplyBtn');
    const msgEl = document.getElementById('supportReplyMsg');
    const body  = document.getElementById('supportReplyBody').value.trim();
    if (!body) return;

    btn.disabled = true;
    btn.textContent = 'Sending…';
    msgEl.textContent = '';

    try {
        const res  = await fetch(`/api/support/tickets/${currentThreadTicketId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getStoredToken() },
            body: JSON.stringify({ body })
        });
        const data = await res.json();
        if (!res.ok) {
            msgEl.textContent = data.error || 'Failed to send reply.';
            msgEl.className   = 'account-feedback account-feedback--error';
        } else {
            document.getElementById('supportReplyBody').value = '';
            openSupportThread(currentThreadTicketId); // Reload thread
        }
    } catch (err) {
        msgEl.textContent = 'Network error, please try again.';
        msgEl.className   = 'account-feedback account-feedback--error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Reply';
    }
}
