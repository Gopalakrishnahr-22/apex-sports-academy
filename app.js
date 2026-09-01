// --- Navigation Scroll State (Optimized with requestAnimationFrame & Cached Offsets) ---
document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('header');
  const sections = Array.from(document.querySelectorAll('section[id]'));
  const navLinks = Array.from(document.querySelectorAll('nav a'));

  let scrollTicking = false;
  let cachedSectionTops = [];

  function recalculateOffsets() {
    cachedSectionTops = sections.map(sec => ({
      id: sec.getAttribute('id'),
      top: sec.offsetTop,
      height: sec.offsetHeight
    }));
  }

  recalculateOffsets();
  window.addEventListener('resize', recalculateOffsets, { passive: true });

  function updateNavState() {
    const scrollY = window.scrollY;

    // Header shadow toggle
    if (header) {
      if (scrollY > 50) {
        if (!header.classList.contains('scrolled')) header.classList.add('scrolled');
      } else {
        if (header.classList.contains('scrolled')) header.classList.remove('scrolled');
      }
    }

    // Active nav link based on precalculated offsets
    let currentId = '';
    for (let i = cachedSectionTops.length - 1; i >= 0; i--) {
      if (scrollY >= cachedSectionTops[i].top - 140) {
        currentId = cachedSectionTops[i].id;
        break;
      }
    }

    navLinks.forEach(link => {
      const isTarget = link.getAttribute('href') === `#${currentId}`;
      if (isTarget && !link.classList.contains('active')) {
        link.classList.add('active');
      } else if (!isTarget && link.classList.contains('active')) {
        link.classList.remove('active');
      }
    });

    scrollTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      window.requestAnimationFrame(updateNavState);
      scrollTicking = true;
    }
  }, { passive: true });
});

// --- Mobile Navigation Menu Toggle ---
const mobileToggle = document.getElementById('mobile-toggle');
const navMenu = document.getElementById('nav-menu');

function closeMobileNav() {
  if (navMenu && navMenu.classList.contains('open')) {
    navMenu.classList.remove('open');
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', 'false');
      const spans = mobileToggle.querySelectorAll('span');
      if (spans.length >= 3) {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      }
    }
  }
}

if (mobileToggle && navMenu) {
  mobileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    navMenu.classList.toggle('open');
    const isOpen = navMenu.classList.contains('open');
    mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    const spans = mobileToggle.querySelectorAll('span');
    if (spans.length >= 3) {
      spans[0].style.transform = isOpen ? 'rotate(45deg) translate(6px, 6px)' : 'none';
      spans[1].style.opacity = isOpen ? '0' : '1';
      spans[2].style.transform = isOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none';
    }
  });

  // Close menu when clicking any nav link, button, or CTA inside nav
  navMenu.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('click', () => {
      closeMobileNav();
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
      closeMobileNav();
    }
  });

  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileNav();
    }
  });
}

// --- Under-20 Tournament Countdown Timer ---
function initCountdown() {
  const timerEl = document.getElementById('countdown');
  if (!timerEl) return;

  const deadlineStr = timerEl.getAttribute('data-deadline');
  const deadline = new Date(deadlineStr).getTime();
  let interval = null;

  function updateTimer() {
    const now = new Date().getTime();
    const diff = deadline - now;

    if (diff <= 0) {
      if (interval) clearInterval(interval);
      const daysEl = document.getElementById('days');
      const hoursEl = document.getElementById('hours');
      const minsEl = document.getElementById('minutes');
      const secsEl = document.getElementById('seconds');
      if (daysEl) daysEl.innerText = '00';
      if (hoursEl) hoursEl.innerText = '00';
      if (minsEl) minsEl.innerText = '00';
      if (secsEl) secsEl.innerText = '00';
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    const daysEl = document.getElementById('days');
    const hoursEl = document.getElementById('hours');
    const minsEl = document.getElementById('minutes');
    const secsEl = document.getElementById('seconds');
    if (daysEl) daysEl.innerText = d.toString().padStart(2, '0');
    if (hoursEl) hoursEl.innerText = h.toString().padStart(2, '0');
    if (minsEl) minsEl.innerText = m.toString().padStart(2, '0');
    if (secsEl) secsEl.innerText = s.toString().padStart(2, '0');
  }

  updateTimer();
  interval = setInterval(updateTimer, 1000);
}

// --- Pricing Tier & Form Synchronizer ---
function selectCoachingTier(tierId, price) {
  // Highlight pricing card (kept for safety/compatibility)
  document.querySelectorAll('.pricing-item').forEach(card => {
    card.classList.remove('active');
  });

  const selectedCard = document.getElementById(`tier-${tierId}`);
  if (selectedCard) {
    selectedCard.classList.add('active');
  }

  // Synchronize new dropdowns and radio buttons UI if elements exist
  const tournamentRadio = document.getElementById('radio-tournament');
  const weekdayRadio = document.getElementById('radio-weekday');
  const weekendRadio = document.getElementById('radio-weekend');

  const tournamentRow = document.getElementById('row-tournament');
  const weekdayRow = document.getElementById('row-weekday');
  const weekendRow = document.getElementById('row-weekend');

  const weekdaySelect = document.getElementById('weekday-select');
  const weekendSelect = document.getElementById('weekend-select');

  // Remove active from all rows
  [tournamentRow, weekdayRow, weekendRow].forEach(row => {
    if (row) row.classList.remove('active');
  });

  if (tierId === 'tournament') {
    if (tournamentRadio) tournamentRadio.checked = true;
    if (tournamentRow) tournamentRow.classList.add('active');
  } else if (tierId.startsWith('weekday')) {
    if (weekdayRadio) weekdayRadio.checked = true;
    if (weekdayRow) weekdayRow.classList.add('active');
    if (weekdaySelect) weekdaySelect.value = tierId;
  } else if (tierId.startsWith('weekend')) {
    if (weekendRadio) weekendRadio.checked = true;
    if (weekendRow) weekendRow.classList.add('active');
    if (weekendSelect) weekendSelect.value = tierId;
  }

  let finalPrice = price;
  let finalTierName = tierId;

  const weekdayPriceTag = document.getElementById('weekday-price-tag');
  const weekendPriceTag = document.getElementById('weekend-price-tag');

  if (tierId === 'tournament') {
    finalTierName = 'ASA Cup Tournament Entry';
    finalPrice = 1200;
  } else if (tierId === 'weekday-1') {
    finalTierName = 'Weekday Coaching (Batch 1 - 1 Month(s))';
    finalPrice = 2500;
    if (weekdayPriceTag) weekdayPriceTag.innerText = '₹2,500';
  } else if (tierId === 'weekday-2') {
    finalTierName = 'Weekday Coaching (Batch 1 - 2 Month(s))';
    finalPrice = 4500;
    if (weekdayPriceTag) weekdayPriceTag.innerText = '₹4,500';
  } else if (tierId === 'weekday-3') {
    finalTierName = 'Weekday Coaching (Batch 1 - 3 Month(s))';
    finalPrice = 7000;
    if (weekdayPriceTag) weekdayPriceTag.innerText = '₹7,000';
  } else if (tierId === 'weekend-1') {
    finalTierName = 'Weekend Coaching (Batch 2 - 1 Month(s))';
    finalPrice = 1600;
    if (weekendPriceTag) weekendPriceTag.innerText = '₹1,600';
  } else if (tierId === 'weekend-2') {
    finalTierName = 'Weekend Coaching (Batch 2 - 2 Month(s))';
    finalPrice = 2500;
    if (weekendPriceTag) weekendPriceTag.innerText = '₹2,500';
  } else if (tierId === 'weekend-3') {
    finalTierName = 'Weekend Coaching (Batch 2 - 3 Month(s))';
    finalPrice = 4000;
    if (weekendPriceTag) weekendPriceTag.innerText = '₹4,000';
  }

  // Update hidden inputs
  document.getElementById('selected-tier').value = finalTierName;
  document.getElementById('selected-price').value = finalPrice;

  // Format price output
  const formattedPrice = `₹${finalPrice.toLocaleString('en-IN')}`;
  document.getElementById('btn-price-display').innerText = formattedPrice;

  // Toggle active fields tab automatically
  if (tierId.startsWith('weekday') || tierId.startsWith('weekend')) {
    toggleFormType('coaching');
  } else {
    toggleFormType('tournament');
  }
}

// Handlers for the 3 separate select dropdowns
function activateProgram(category) {
  const radio = document.getElementById(`radio-${category}`);
  if (radio) radio.checked = true;

  document.querySelectorAll('.program-select-row').forEach(row => {
    row.classList.remove('active');
  });
  const activeRow = document.getElementById(`row-${category}`);
  if (activeRow) activeRow.classList.add('active');

  if (category === 'tournament') {
    selectCoachingTier('tournament', 1200);
  } else if (category === 'weekday') {
    const val = document.getElementById('weekday-select').value;
    selectCoachingTier(val);
  } else if (category === 'weekend') {
    const val = document.getElementById('weekend-select').value;
    selectCoachingTier(val);
  }
}

function onTournamentSelectChange(val) {
  activateProgram('tournament');
}

function onWeekdaySelectChange(val) {
  activateProgram('weekday');
}

function onWeekendSelectChange(val) {
  activateProgram('weekend');
}

// Helper to scroll to register section and auto-select a tier
function scrollToRegisterAndSelect(tierId) {
  selectCoachingTier(tierId);
  const regSection = document.getElementById('register');
  if (regSection) {
    regSection.scrollIntoView({ behavior: 'smooth' });
  }
}

function toggleFormType(type) {
  const tourTab = document.getElementById('tab-tournament-btn');
  const coachTab = document.getElementById('tab-coaching-btn');
  const tourFields = document.getElementById('tournament-fields');
  const coachFields = document.getElementById('coaching-fields');

  if (type === 'tournament') {
    tourTab.classList.add('active');
    coachTab.classList.remove('active');
    tourFields.style.display = 'block';
    coachFields.style.display = 'none';

    // Set fields as required
    document.getElementById('team-name').setAttribute('required', 'true');
    document.getElementById('coach-name').setAttribute('required', 'true');
    document.getElementById('coach-phone').setAttribute('required', 'true');
    document.getElementById('coach-email').setAttribute('required', 'true');

    // Remove required from coaching fields
    document.getElementById('student-name').removeAttribute('required');
    document.getElementById('student-dob').removeAttribute('required');
    document.getElementById('student-gender').removeAttribute('required');
    document.getElementById('student-phone').removeAttribute('required');
    document.getElementById('student-email').removeAttribute('required');

    // Update pricing cards if coaching card was selected
    const currentTier = document.getElementById('selected-tier').value;
    if (currentTier.includes('Coaching')) {
      selectCoachingTier('tournament', 1200);
    }
  } else {
    coachTab.classList.add('active');
    tourTab.classList.remove('active');
    coachFields.style.display = 'block';
    tourFields.style.display = 'none';

    // Set fields as required
    document.getElementById('student-name').setAttribute('required', 'true');
    document.getElementById('student-dob').setAttribute('required', 'true');
    document.getElementById('student-gender').setAttribute('required', 'true');
    document.getElementById('student-phone').setAttribute('required', 'true');
    document.getElementById('student-email').setAttribute('required', 'true');

    // Remove required from tournament fields
    document.getElementById('team-name').removeAttribute('required');
    document.getElementById('coach-name').removeAttribute('required');
    document.getElementById('coach-phone').removeAttribute('required');
    document.getElementById('coach-email').removeAttribute('required');

    // Update pricing cards if tournament card was selected
    const currentTier = document.getElementById('selected-tier').value;
    if (currentTier.includes('Tournament')) {
      selectCoachingTier('weekday-1');
    }
  }
}

// Helper to scroll down to register section
function scrollToRegister(targetType) {
  const registerSec = document.getElementById('register');
  if (registerSec) {
    registerSec.scrollIntoView({ behavior: 'smooth' });

    // Auto toggle to correct view
    if (targetType === 'coaching') {
      selectCoachingTier('weekday-1');
    } else {
      selectCoachingTier('tournament', 1200);
    }
  }
}

// --- Payment Portal Dialog Controller ---
let currentFormData = {}; // Holds validated form details before charge confirmation

function handleRegistrationSubmit(event) {
  event.preventDefault();

  const isAgreeChecked = document.getElementById('terms-agree').checked;
  if (!isAgreeChecked) {
    alert("Please check the terms and conditions checkbox to proceed.");
    return;
  }

  const tier = document.getElementById('selected-tier').value;
  const amount = parseInt(document.getElementById('selected-price').value);

  // Capture details
  const isTournament = tier.includes('Tournament') || tier === 'tournament' || tier === 'ASA Cup Tournament Entry';
  if (isTournament) {
    currentFormData = {
      type: 'Tournament',
      entityName: document.getElementById('team-name').value,
      contactPerson: document.getElementById('coach-name').value,
      phone: document.getElementById('coach-phone').value,
      email: document.getElementById('coach-email').value,
      details: `${document.getElementById('player-count').value} Squad Players`,
      amount: amount
    };
  } else {
    // Determine period based on duration selection in tier name
    let period = 'Monthly';
    if (tier.includes('3 Month')) {
      period = 'Quarterly';
    } else if (tier.includes('2 Month')) {
      period = '2-Month';
    }
    currentFormData = {
      type: `Coaching (${period})`,
      entityName: document.getElementById('student-name').value,
      contactPerson: document.getElementById('student-name').value,
      phone: document.getElementById('student-phone').value,
      email: document.getElementById('student-email').value,
      details: `Group: ${document.getElementById('student-experience').value} | DOB: ${document.getElementById('student-dob').value} | Gen: ${document.getElementById('student-gender').value}`,
      amount: amount
    };
  }

  initiateRazorpayPayment(currentFormData);
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.remove('open');
}

// --- Secure Razorpay Payment Checkout & Verification ---
let lastVerifiedRegistration = null;

function initiateRazorpayPayment(data) {
  // Show checkout loading modal step 2
  document.getElementById('payment-modal').classList.add('open');
  document.getElementById('payment-gateway-step2').style.display = 'block';
  document.getElementById('payment-gateway-step3').style.display = 'none';

  document.querySelector('#payment-gateway-step2 .processing-title').innerText = "Preparing Secure Checkout";
  document.querySelector('#payment-gateway-step2 .processing-desc').innerText = "Connecting to payment gateway. Please do not refresh or close the page...";

  // Call backend to create Razorpay secure order
  fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: data.amount })
  })
    .then(res => res.json())
    .then(orderResult => {
      if (!orderResult.success) {
        alert("Error initiating payment: " + orderResult.error);
        closePaymentModal();
        return;
      }

      // Check if the key is placeholder
      if (orderResult.key_id === "rzp_test_placeholder_key_id" || !orderResult.key_id) {
        alert("Payment Gateway Notice:\n\nNo valid Razorpay Key ID is configured in the Admin Dashboard. Please log in to the Admin Dashboard (admin / Gopala@2026) and update the Razorpay Key ID & Secret under Payment Settings.");
        closePaymentModal();
        return;
      }

      // Configure Razorpay Options
      const options = {
        "key": orderResult.key_id,
        "amount": orderResult.amount * 100, // paise
        "currency": "INR",
        "name": "Apex Sports Academy",
        "description": data.type + " Registration",
        "image": "logo2.png",
        "order_id": orderResult.order_id,
        "handler": function (response) {
          verifyRazorpayPayment(response, data, orderResult.mock);
        },
        "prefill": {
          "name": data.contactPerson,
          "email": data.email,
          "contact": data.phone
        },
        "theme": {
          "color": "#00b4d8"
        },
        "modal": {
          "ondismiss": function () {
            console.log("Razorpay checkout dismissed by user.");
            closePaymentModal();
          }
        }
      };

      // Hide our loading modal step since Razorpay covers the viewport
      closePaymentModal();

      const rzp = new Razorpay(options);
      rzp.open();
    })
    .catch(err => {
      console.error("Order creation fetch failed:", err);
      alert("Network error: Failed to reach checkout server API.");
      closePaymentModal();
    });
}

function verifyRazorpayPayment(rzpResponse, regData, isMock) {
  // Show backend signature verification loading
  document.getElementById('payment-modal').classList.add('open');
  document.getElementById('payment-gateway-step2').style.display = 'block';
  document.getElementById('payment-gateway-step3').style.display = 'none';

  document.querySelector('#payment-gateway-step2 .processing-title').innerText = "Verifying Transaction Details";
  document.querySelector('#payment-gateway-step2 .processing-desc').innerText = "Authenticating signature securely with merchant server. Please wait...";

  // Call server to verify payment signature securely
  fetch('/api/verify-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_payment_id: rzpResponse.razorpay_payment_id,
      razorpay_order_id: rzpResponse.razorpay_order_id,
      razorpay_signature: rzpResponse.razorpay_signature,
      registration_data: regData,
      is_mock: isMock
    })
  })
    .then(res => res.json())
    .then(verifyResult => {
      if (!verifyResult.success) {
        alert("Payment signature verification failed securely: " + verifyResult.error);
        closePaymentModal();
        return;
      }

      // Store verified details
      const reg = verifyResult.registration;
      lastVerifiedRegistration = reg;

      // Populate receipt page fields
      document.getElementById('receipt-id').innerText = reg.id;
      document.getElementById('receipt-date').innerText = reg.date;
      document.getElementById('receipt-name').innerText = reg.entityName;
      document.getElementById('receipt-program').innerText = reg.type;
      document.getElementById('receipt-ref').innerText = reg.txnId;
      document.getElementById('receipt-amount').innerText = `₹${reg.amount.toLocaleString('en-IN')}.00`;

      // Switch to step 3 success screen
      document.getElementById('payment-gateway-step2').style.display = 'none';
      document.getElementById('payment-gateway-step3').style.display = 'block';

      // Clear forms
      document.getElementById('registration-form').reset();

      // Sync dashboard
      renderDashboard();
    })
    .catch(err => {
      console.error("Payment verification API fetch failed:", err);
      alert("Network error: Server signature verification failed.");
      closePaymentModal();
    });
}

// Generate client-side PDF document dynamically and trigger download
function downloadReceiptPDF() {
  if (!lastVerifiedRegistration) return;
  const reg = lastVerifiedRegistration;
  const isTournament = reg.type.includes('Tournament') || reg.type === 'Tournament';

  const element = document.createElement('div');
  element.style.padding = '40px';
  element.style.fontFamily = 'Arial, sans-serif';
  element.style.color = '#111827';
  element.style.backgroundColor = '#ffffff';
  element.style.width = '650px';

  element.innerHTML = `
    <div style="border: 2px solid #e5e7eb; border-radius: 12px; padding: 30px; position: relative;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f3f4f6; padding-bottom: 20px; margin-bottom: 30px;">
        <div style="display: flex; align-items: center; gap: 15px;">
          <img src="logo.jpeg" alt="Apex Logo" style="height: 60px; width: 60px; object-fit: contain;" onerror="this.src='logo2.png'; this.onerror=null;">
          <div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: 0.5px;">APEX SPORTS ACADEMY</h1>
            <p style="margin: 3px 0 0 0; font-size: 11px; color: #64748b; font-weight: 600;">BANGALORE, KARNATAKA</p>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="display: inline-block; background-color: #ecfdf5; color: #047857; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 6px; text-transform: uppercase;">${reg.status}</span>
        </div>
      </div>
      
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="margin: 0; font-size: 15px; font-weight: 800; color: #1e293b; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; display: inline-block; padding-bottom: 5px;">TOURNAMENT REGISTRATION PAYMENT RECEIPT</h2>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 13px; line-height: 1.6;">
        <div>
          <p style="margin: 0 0 8px 0; color: #64748b;">Registration ID:</p>
          <p style="margin: 0 0 16px 0; font-weight: 700; font-family: monospace; font-size: 14px; color: #0f172a;">${reg.id}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Tournament Name:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #0f172a;">${isTournament ? 'ASA Cup Season 1' : reg.type}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Team Name:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #0f172a;">${reg.entityName}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Captain Name:</p>
          <p style="margin: 0 0 0 0; font-weight: 600; color: #0f172a;">${reg.contactPerson}</p>
        </div>
        
        <div>
          <p style="margin: 0 0 8px 0; color: #64748b;">Mobile Number:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #0f172a;">${reg.phone}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Email Address:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #0f172a;">${reg.email}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Number of Players:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #0f172a;">${isTournament ? reg.details.split(' ')[0] : 'N/A'}</p>
          
          <p style="margin: 0 0 8px 0; color: #64748b;">Payment Date & Time:</p>
          <p style="margin: 0 0 0 0; font-weight: 600; color: #0f172a;">${reg.date}</p>
        </div>
      </div>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 45px;">
        <div>
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Razorpay Payment ID</p>
          <p style="margin: 0; font-family: monospace; font-size: 13px; font-weight: 700; color: #334155;">${reg.txnId}</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Amount Paid</p>
          <p style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">₹${reg.amount.toLocaleString('en-IN')}.00</p>
        </div>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 11px; color: #64748b; font-weight: 500;">
        <p style="margin: 0 0 5px 0;">Thank you for registering with Apex Sports Academy.</p>
        <p style="margin: 0; font-size: 9px; color: #94a3b8;">This is a system-generated secure payment receipt.</p>
      </div>
    </div>
  `;

  const opt = {
    margin: 10,
    filename: `Apex_Sports_Receipt_${reg.id}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save();
}

function printReceiptPDF() {
  if (!lastVerifiedRegistration) return;
  const reg = lastVerifiedRegistration;
  const isTournament = reg.type.includes('Tournament') || reg.type === 'Tournament';

  const printWindow = window.open('', '_blank', 'height=700,width=650');
  printWindow.document.write('<html><head><title>Receipt - Apex Sports Academy</title>');
  printWindow.document.write('<style>');
  printWindow.document.write('body { font-family: sans-serif; padding: 20px; background-color: #fff; color: #111; }');
  printWindow.document.write('.receipt-border { border: 2px solid #e5e7eb; border-radius: 12px; padding: 30px; }');
  printWindow.document.write('.header-flex { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f3f4f6; padding-bottom: 20px; margin-bottom: 30px; }');
  printWindow.document.write('.details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 13px; line-height: 1.6; }');
  printWindow.document.write('.payment-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 45px; }');
  printWindow.document.write('.btn-print { display: block; text-align: center; margin-top: 30px; padding: 12px; background: #0084c7; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; }');
  printWindow.document.write('@media print { .btn-print { display: none; } }');
  printWindow.document.write('</style></head><body>');

  printWindow.document.write(`
    <div class="receipt-border">
      <div class="header-flex">
        <div style="display: flex; align-items: center; gap: 15px;">
          <img src="logo.jpeg" alt="Apex Logo" style="height: 60px; width: 60px; object-fit: contain;" onerror="this.src='logo2.png'; this.onerror=null;">
          <div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">APEX SPORTS ACADEMY</h1>
            <p style="margin: 3px 0 0 0; font-size: 11px; color: #64748b;">BANGALORE, KARNATAKA</p>
          </div>
        </div>
        <div>
          <span style="background-color: #ecfdf5; color: #047857; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 6px;">${reg.status}</span>
        </div>
      </div>
      
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="margin: 0; font-size: 16px; font-weight: 800; color: #1e293b; text-transform: uppercase;">TOURNAMENT REGISTRATION PAYMENT RECEIPT</h2>
      </div>
      
      <div class="details-grid">
        <div>
          <p style="margin: 0 0 4px 0; color: #64748b;">Registration ID:</p>
          <p style="margin: 0 0 16px 0; font-weight: 700; font-family: monospace;">${reg.id}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Tournament Name:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600;">${isTournament ? 'ASA Cup Season 1' : reg.type}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Team Name:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600;">${reg.entityName}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Captain Name:</p>
          <p style="margin: 0 0 0 0; font-weight: 600;">${reg.contactPerson}</p>
        </div>
        <div>
          <p style="margin: 0 0 4px 0; color: #64748b;">Mobile Number:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600;">${reg.phone}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Email Address:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600;">${reg.email}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Number of Players:</p>
          <p style="margin: 0 0 16px 0; font-weight: 600;">${isTournament ? reg.details.split(' ')[0] : 'N/A'}</p>
          <p style="margin: 0 0 4px 0; color: #64748b;">Payment Date & Time:</p>
          <p style="margin: 0 0 0 0; font-weight: 600;">${reg.date}</p>
        </div>
      </div>
      
      <div class="payment-box">
        <div>
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Razorpay Payment ID</p>
          <p style="margin: 0; font-family: monospace; font-size: 13px; font-weight: 700;">${reg.txnId}</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Amount Paid</p>
          <p style="margin: 0; font-size: 20px; font-weight: 800;">₹${reg.amount.toLocaleString('en-IN')}.00</p>
        </div>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 11px; color: #64748b;">
        <p style="margin: 0 0 5px 0;">Thank you for registering with Apex Sports Academy.</p>
      </div>
    </div>
    <a href="#" class="btn-print" onclick="window.print(); return false;">Print Receipt</a>
  `);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
}

// --- Local Dashboard Visualizer & Metrics ---
let activeDashboardFilter = 'all';

function toggleAdminDashboard() {
  const panel = document.getElementById('admin-panel');
  const btn = document.getElementById('db-toggle-btn');
  if (!panel) return;

  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    if (btn) {
      btn.style.color = 'var(--text-muted)';
      btn.style.background = 'transparent';
    }
  } else {
    // Check if token exists in sessionStorage
    const token = sessionStorage.getItem('asa_admin_token');
    if (!token) {
      openAdminLoginModal();
    } else {
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth' });
      if (btn) {
        btn.style.color = 'var(--primary)';
        btn.style.background = 'rgba(0, 180, 216, 0.1)';
      }
      renderDashboard();
    }
  }
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDashboard() {
  const tableBody = document.getElementById('admin-table-body');
  const enqTableBody = document.getElementById('enquiries-table-body');
  const token = sessionStorage.getItem('asa_admin_token');

  fetch('/api/dashboard-data', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(data => {
      const registrations = data.registrations || [];
      const enquiries = data.enquiries || [];

      // Sync to local storage
      localStorage.setItem('apex_sports_registrations', JSON.stringify(registrations));
      localStorage.setItem('apex_sports_enquiries', JSON.stringify(enquiries));

      // Filtered array
      const filteredRegs = registrations.filter(reg => {
        if (activeDashboardFilter === 'all') return true;
        if (activeDashboardFilter === 'tournament') return reg.type.includes('Tournament');
        if (activeDashboardFilter === 'coaching') return reg.type.includes('Coaching');
      });

      // Calculate Metrics
      let totalRevenue = 0;
      let tournamentCount = 0;
      let coachingCount = 0;

      registrations.forEach(reg => {
        totalRevenue += reg.amount;
        if (reg.type.includes('Tournament')) {
          tournamentCount++;
        } else if (reg.type.includes('Coaching')) {
          coachingCount++;
        }
      });

      // Render stats
      const statTotal = document.getElementById('stat-total');
      const statTeams = document.getElementById('stat-teams');
      const statStudents = document.getElementById('stat-students');
      const statEnquiries = document.getElementById('stat-enquiries');
      const statRevenue = document.getElementById('stat-revenue');

      if (statTotal) statTotal.innerText = registrations.length;
      if (statTeams) statTeams.innerText = tournamentCount;
      if (statStudents) statStudents.innerText = coachingCount;
      if (statEnquiries) statEnquiries.innerText = enquiries.length;
      if (statRevenue) statRevenue.innerText = `₹${totalRevenue.toLocaleString('en-IN')}`;

      // Populate Registrations Table rows
      if (tableBody) {
        if (filteredRegs.length === 0) {
          tableBody.innerHTML = `
            <tr>
              <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px 0;">No active registrations found.</td>
            </tr>
          `;
        } else {
          tableBody.innerHTML = filteredRegs.map(reg => {
            return `
              <tr>
                <td style="font-family: monospace; font-weight: 600; color: var(--primary);">${escapeHTML(reg.id)}</td>
                <td>
                  <div style="font-weight:700; color:#fff;">${escapeHTML(reg.entityName)}</div>
                  <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHTML(reg.details)}</div>
                </td>
                <td>
                  <span style="font-weight:600;">${escapeHTML(reg.type)}</span>
                </td>
                <td>
                  <div>${escapeHTML(reg.contactPerson)}</div>
                  <div style="font-size:0.8rem; color:var(--text-secondary);">${escapeHTML(reg.phone)}</div>
                </td>
                <td style="font-size:0.85rem;">${escapeHTML(reg.email)}</td>
                <td>
                  <div style="font-family: monospace; font-size:0.8rem;">${escapeHTML(reg.txnId)}</div>
                  <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHTML(reg.method)}</div>
                </td>
                <td style="font-weight:700; color:var(--secondary);">₹${Number(reg.amount || 0).toLocaleString('en-IN')}</td>
                <td>
                  <span class="status-indicator paid">
                    <span>●</span> ${escapeHTML(reg.status)}
                  </span>
                </td>
                <td style="font-size:0.8rem; color:var(--text-muted);">${escapeHTML((reg.date || '').split(',')[0])}</td>
              </tr>
            `;
          }).join('');
        }
      }

      // Populate Enquiries Table rows
      if (enqTableBody) {
        if (enquiries.length === 0) {
          enqTableBody.innerHTML = `
            <tr>
              <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px 0;">No quick callback enquiries submitted yet.</td>
            </tr>
          `;
        } else {
          enqTableBody.innerHTML = enquiries.map(enq => {
            const isResolved = enq.status === 'Resolved';
            const statusBadge = isResolved
              ? `<span class="status-indicator paid"><span>●</span> Resolved</span>`
              : `<span class="status-indicator pending" style="background: rgba(255, 179, 0, 0.1); color: #ffb300;"><span>●</span> Pending Callback</span>`;

            const actionButton = isResolved
              ? `<button class="btn-secondary" onclick="toggleEnquiryStatus('${escapeHTML(enq.id)}')" style="font-size:0.75rem; padding: 4px 8px; border-color: rgba(255,255,255,0.2);">Reopen</button>`
              : `<button class="btn-primary" onclick="toggleEnquiryStatus('${escapeHTML(enq.id)}')" style="font-size:0.75rem; padding: 4px 8px;">Mark Called</button>`;

            return `
              <tr>
                <td style="font-family: monospace; font-weight: 600; color: var(--primary);">${escapeHTML(enq.id)}</td>
                <td style="font-weight: 700; color: #fff;">${escapeHTML(enq.phone)}</td>
                <td>${statusBadge}</td>
                <td style="font-size: 0.85rem; color: var(--text-muted);">${escapeHTML(enq.date)}</td>
                <td>
                  <div style="display: flex; gap: 8px;">
                    ${actionButton}
                    <button class="btn-secondary" onclick="deleteEnquiry('${escapeHTML(enq.id)}')" style="font-size:0.75rem; padding: 4px 8px; border-color: #ff3366; color: #ff3366;">Delete</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
      loadAdminPaymentSettings();
      loadAdminDatabaseSettings();
    })
    .catch(err => {
      console.error("Dashboard fetch error:", err);
      // Fallback local storage rendering if server fails
      const registrations = JSON.parse(localStorage.getItem('apex_sports_registrations')) || [];
      const enquiries = JSON.parse(localStorage.getItem('apex_sports_enquiries')) || [];
      const filteredRegs = registrations.filter(reg => {
        if (activeDashboardFilter === 'all') return true;
        if (activeDashboardFilter === 'tournament') return reg.type.includes('Tournament');
        if (activeDashboardFilter === 'coaching') return reg.type.includes('Coaching');
      });
      let totalRevenue = 0, tournamentCount = 0, coachingCount = 0;
      registrations.forEach(reg => {
        totalRevenue += reg.amount;
        if (reg.type.includes('Tournament')) tournamentCount++;
        else if (reg.type.includes('Coaching')) coachingCount++;
      });
      const statTotal = document.getElementById('stat-total'), statTeams = document.getElementById('stat-teams'), statStudents = document.getElementById('stat-students'), statEnquiries = document.getElementById('stat-enquiries'), statRevenue = document.getElementById('stat-revenue');
      if (statTotal) statTotal.innerText = registrations.length;
      if (statTeams) statTeams.innerText = tournamentCount;
      if (statStudents) statStudents.innerText = coachingCount;
      if (statEnquiries) statEnquiries.innerText = enquiries.length;
      if (statRevenue) statRevenue.innerText = `₹${totalRevenue.toLocaleString('en-IN')}`;
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px 0;">Fallback mode: Server offline. Check server status.</td></tr>`;
      if (enqTableBody) enqTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px 0;">Fallback mode: Server offline. Check server status.</td></tr>`;
    });
}

// --- Razorpay API Settings Controls ---
function loadAdminPaymentSettings() {
  const rzpKeyElem = document.getElementById('admin-rzp-key-id');
  const rzpSecretElem = document.getElementById('admin-rzp-key-secret');
  if (!rzpKeyElem || !rzpSecretElem) return;

  const token = sessionStorage.getItem('asa_admin_token');
  fetch('/api/get-razorpay-keys', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        rzpKeyElem.value = data.key_id || '';
        rzpSecretElem.value = data.key_secret || '';

        const badge = document.getElementById('payment-status-badge');
        if (badge) {
          if (data.is_mock) {
            badge.style.background = 'rgba(255, 179, 0, 0.1)';
            badge.style.color = '#ffb300';
            badge.innerHTML = `<span>●</span> Mock Checkout Mode`;
          } else {
            badge.style.background = 'rgba(16, 185, 129, 0.1)';
            badge.style.color = '#10b981';
            badge.innerHTML = `<span>●</span> Razorpay Live/Test Mode`;
          }
        }
      }
    })
    .catch(err => {
      console.error("Failed to load Razorpay settings:", err);
    });
}

function saveAdminPaymentSettings(event) {
  event.preventDefault();

  const keyId = document.getElementById('admin-rzp-key-id').value.trim();
  const keySecret = document.getElementById('admin-rzp-key-secret').value.trim();

  const msgElem = document.getElementById('admin-settings-message');
  if (msgElem) {
    msgElem.style.display = 'inline-flex';
    msgElem.style.color = 'var(--text-secondary)';
    msgElem.innerText = "Saving settings...";
  }

  const token = sessionStorage.getItem('asa_admin_token');
  fetch('/api/save-razorpay-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ key_id: keyId, key_secret: keySecret })
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        if (msgElem) {
          msgElem.style.color = '#10b981';
          msgElem.innerText = "Settings saved successfully! ✓";
        }
        loadAdminPaymentSettings();
        setTimeout(() => {
          if (msgElem) msgElem.style.display = 'none';
        }, 3000);
      } else {
        if (msgElem) {
          msgElem.style.color = '#ff3366';
          msgElem.innerText = "Error: " + data.error;
        }
      }
    })
    .catch(err => {
      console.error("Error saving payment settings:", err);
      if (msgElem) {
        msgElem.style.color = '#ff3366';
        msgElem.innerText = "Network Error.";
      }
    });
}

// --- Supabase DB Settings Controls ---
function loadAdminDatabaseSettings() {
  const urlElem = document.getElementById('admin-sb-url');
  const keyElem = document.getElementById('admin-sb-key');
  if (!urlElem || !keyElem) return;

  const token = sessionStorage.getItem('asa_admin_token');
  fetch('/api/get-supabase-keys', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        urlElem.value = data.supabase_url || '';
        keyElem.value = data.supabase_key || '';

        const badge = document.getElementById('database-status-badge');
        if (badge) {
          if (data.is_local) {
            badge.style.background = 'rgba(255, 179, 0, 0.1)';
            badge.style.color = '#ffb300';
            badge.innerHTML = `<span>●</span> Local JSON Database`;
          } else {
            badge.style.background = 'rgba(16, 185, 129, 0.1)';
            badge.style.color = '#10b981';
            badge.innerHTML = `<span>●</span> Supabase Active`;
          }
        }
      }
    })
    .catch(err => {
      console.error("Failed to load Supabase settings:", err);
    });
}

function saveAdminDatabaseSettings(event) {
  event.preventDefault();

  const urlVal = document.getElementById('admin-sb-url').value.trim();
  const keyVal = document.getElementById('admin-sb-key').value.trim();

  const msgElem = document.getElementById('admin-db-settings-message');
  if (msgElem) {
    msgElem.style.display = 'inline-flex';
    msgElem.style.color = 'var(--text-secondary)';
    msgElem.innerText = "Saving settings...";
  }

  const token = sessionStorage.getItem('asa_admin_token');
  fetch('/api/save-supabase-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ supabase_url: urlVal, supabase_key: keyVal })
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        if (msgElem) {
          msgElem.style.color = '#10b981';
          msgElem.innerText = "Settings saved successfully! ✓";
        }
        loadAdminDatabaseSettings();
        // Reload dashboard data in case we switched database contexts
        renderDashboard();
        setTimeout(() => {
          if (msgElem) msgElem.style.display = 'none';
        }, 3000);
      } else {
        if (msgElem) {
          msgElem.style.color = '#ff3366';
          msgElem.innerText = "Error: " + data.error;
        }
      }
    })
    .catch(err => {
      console.error("Error saving database settings:", err);
      if (msgElem) {
        msgElem.style.color = '#ff3366';
        msgElem.innerText = "Network Error.";
      }
    });
}

function filterDashboard(type, btnElem) {
  activeDashboardFilter = type;

  // Toggle active styling
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  btnElem.classList.add('active');

  renderDashboard();
}

function clearAllData() {
  if (confirm("Are you sure you want to delete all registrations, payments, and quick enquiries from the local database? This cannot be undone.")) {
    const token = sessionStorage.getItem('asa_admin_token');
    fetch('/api/clear-db', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401) {
          handleTokenExpired();
          throw new Error("Unauthorized");
        }
        return res;
      })
      .then(() => {
        localStorage.removeItem('apex_sports_registrations');
        localStorage.removeItem('apex_sports_enquiries');
        localStorage.removeItem('apex_user_phone');

        // Reset home page form display
        const inputArea = document.getElementById('hero-input-area');
        const successArea = document.getElementById('hero-success-area');
        if (inputArea && successArea) {
          inputArea.style.display = 'flex';
          successArea.style.display = 'none';
        }

        renderDashboard();
      })
      .catch(err => console.error("Error clearing database on server:", err));
  }
}

// Download local registrations collection as CSV spreadsheet format
function exportRegistrationsToCSV() {
  const registrations = JSON.parse(localStorage.getItem('apex_sports_registrations')) || [];
  if (registrations.length === 0) {
    alert("No records found in database to export.");
    return;
  }

  // Header row
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "ID,Date,Registered Entity,Type,Contact Person,Phone,Email,Details,Amount (INR),Method,Transaction Reference,Status\n";

  // Build rows
  registrations.forEach(reg => {
    const row = [
      reg.id,
      reg.date.replace(/,/g, ''), // remove commas in dates
      `"${reg.entityName.replace(/"/g, '""')}"`,
      `"${reg.type}"`,
      `"${reg.contactPerson.replace(/"/g, '""')}"`,
      `"${reg.phone}"`,
      `"${reg.email}"`,
      `"${reg.details.replace(/"/g, '""')}"`,
      reg.amount,
      reg.method,
      reg.txnId,
      reg.status
    ].join(",");
    csvContent += row + "\n";
  });

  // Download trigger link simulation
  const encodedUri = encodeURI(csvContent);
  const downloadLink = document.createElement("a");
  downloadLink.setAttribute("href", encodedUri);
  downloadLink.setAttribute("download", `Apex_Academy_Registrations_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

// Quick callback enquiries CSV export
function exportEnquiriesToCSV() {
  const enquiries = JSON.parse(localStorage.getItem('apex_sports_enquiries')) || [];
  if (enquiries.length === 0) {
    alert("No callback enquiries found to export.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "ID,Phone Number,Status,Date Submitted\n";

  enquiries.forEach(enq => {
    const row = [
      enq.id,
      `"${enq.phone}"`,
      `"${enq.status}"`,
      `"${enq.date.replace(/,/g, '')}"`
    ].join(",");
    csvContent += row + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const downloadLink = document.createElement("a");
  downloadLink.setAttribute("href", encodedUri);
  downloadLink.setAttribute("download", `Apex_Quick_Enquiries_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

// --- Enquiry Modal & Leads Management Logic ---
let currentEnquiryPhone = "";

function handleHeroStart() {
  const mobileInput = document.getElementById('hero-mobile-input');
  const mobileVal = mobileInput ? mobileInput.value.trim() : "";

  // Validate if a 10-digit number is input
  if (!/^[0-9]{10}$/.test(mobileVal)) {
    alert("Please enter a valid 10-digit mobile number.");
    if (mobileInput) mobileInput.focus();
    return;
  }

  currentEnquiryPhone = mobileVal;

  const phoneDisplay = document.getElementById('enquiry-modal-phone');
  if (phoneDisplay) {
    phoneDisplay.textContent = "+91 " + mobileVal;
  }

  // Reset modal state elements
  const authCheck = document.getElementById('enquiry-auth-check');
  if (authCheck) {
    authCheck.checked = false;
  }
  const submitBtn = document.getElementById('enquiry-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.remove('active');
  }

  // Open Enquiry Modal
  const modal = document.getElementById('enquiry-modal');
  if (modal) {
    modal.classList.add('open');
  }
}

function closeEnquiryModal() {
  const modal = document.getElementById('enquiry-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  currentEnquiryPhone = "";
}

function toggleEnquirySubmitBtn(checkbox) {
  const submitBtn = document.getElementById('enquiry-submit-btn');
  if (checkbox.checked) {
    submitBtn.disabled = false;
    submitBtn.classList.add('active');
  } else {
    submitBtn.disabled = true;
    submitBtn.classList.remove('active');
  }
}

function submitEnquiry() {
  if (!currentEnquiryPhone) return;

  const leadRecord = {
    id: `ENQ-${Math.floor(100000 + Math.random() * 900000)}`,
    phone: currentEnquiryPhone,
    status: 'Pending Callback',
    date: new Date().toLocaleString('en-IN')
  };

  // Post callback lead to backend server
  fetch('/api/save-enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadRecord)
  })
    .then(() => {
      localStorage.setItem('apex_user_phone', currentEnquiryPhone);

      // Show success modal/notification
      alert(`Enquiry submitted successfully!\n\nThank you for choosing Apex Sports Academy. Our team will contact you shortly on ${currentEnquiryPhone}.`);

      // Toggle hero area visibility
      const inputArea = document.getElementById('hero-input-area');
      const successArea = document.getElementById('hero-success-area');
      const displayPhone = document.getElementById('submitted-phone-display');
      if (inputArea && successArea && displayPhone) {
        inputArea.style.display = 'none';
        displayPhone.innerText = currentEnquiryPhone;
        successArea.style.display = 'block';
      }

      closeEnquiryModal();

      // Clear hero input
      const mobileInput = document.getElementById('hero-mobile-input');
      if (mobileInput) {
        mobileInput.value = "";
      }

      // Refresh dashboard metrics
      renderDashboard();
    })
    .catch(err => {
      console.error("Error saving enquiry on server:", err);
      alert("Network error: Failed to submit callback request to server.");
    });
}

function toggleEnquiryStatus(enqId) {
  const token = sessionStorage.getItem('asa_admin_token');
  fetch('/api/toggle-enquiry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ id: enqId })
  })
    .then(res => {
      if (res.status === 401) {
        handleTokenExpired();
        return;
      }
      renderDashboard();
    })
    .catch(err => console.error("Error toggling enquiry status:", err));
}

function deleteEnquiry(enqId) {
  if (confirm("Delete this callback request?")) {
    const token = sessionStorage.getItem('asa_admin_token');
    fetch('/api/delete-enquiry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ id: enqId })
    })
      .then(res => {
        if (res.status === 401) {
          handleTokenExpired();
          return;
        }
        renderDashboard();
      })
      .catch(err => console.error("Error deleting enquiry:", err));
  }
}

// --- Gallery and Lightbox Controls ---
function initGallery() {
  const container = document.getElementById('gallery-scroll-container');
  const prevBtn = document.getElementById('gallery-prev-btn');
  const nextBtn = document.getElementById('gallery-next-btn');
  const items = document.querySelectorAll('.gallery-item');

  const lightbox = document.getElementById('gallery-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxDesc = document.getElementById('lightbox-desc');
  const lightboxClose = document.getElementById('lightbox-close-btn');
  const lightboxPrev = document.getElementById('lightbox-prev-btn');
  const lightboxNext = document.getElementById('lightbox-next-btn');

  if (!container || items.length === 0) return;

  const fadeIndicator = document.getElementById('gallery-fade-indicator');
  const progressThumb = document.getElementById('gallery-progress-thumb');

  // 1. Navigation Button & Dynamic Scroll Meta Tracking
  function updateNavButtons() {
    const maxScroll = container.scrollWidth - container.clientWidth;
    const scrollRatio = maxScroll > 0 ? container.scrollLeft / maxScroll : 0;

    if (progressThumb) {
      const thumbWidth = Math.max(18, Math.min(45, (container.clientWidth / container.scrollWidth) * 100));
      progressThumb.style.width = thumbWidth + '%';
      const maxThumbLeft = 100 - thumbWidth;
      progressThumb.style.left = (scrollRatio * maxThumbLeft) + '%';
    }

    if (fadeIndicator) {
      fadeIndicator.style.opacity = (scrollRatio > 0.92 || maxScroll <= 15) ? '0' : '1';
    }

    if (prevBtn && nextBtn) {
      const isAtStart = container.scrollLeft <= 8;
      const isAtEnd = container.scrollLeft >= maxScroll - 8;

      prevBtn.style.opacity = isAtStart ? '0' : '1';
      prevBtn.style.pointerEvents = isAtStart ? 'none' : 'auto';

      nextBtn.style.opacity = isAtEnd ? '0.3' : '1';
      nextBtn.style.pointerEvents = isAtEnd ? 'none' : 'auto';
    }
  }

  function getScrollStep() {
    const firstItem = container.querySelector('.gallery-item');
    if (firstItem) {
      const gap = 16;
      return firstItem.offsetWidth + gap;
    }
    return container.clientWidth * 0.75;
  }

  if (prevBtn && nextBtn) {
    prevBtn.addEventListener('click', () => {
      container.scrollBy({ left: -getScrollStep(), behavior: 'smooth' });
    });

    nextBtn.addEventListener('click', () => {
      container.scrollBy({ left: getScrollStep(), behavior: 'smooth' });
    });

    container.addEventListener('scroll', updateNavButtons, { passive: true });
    window.addEventListener('resize', updateNavButtons, { passive: true });
    setTimeout(updateNavButtons, 120);
  }

  // 2. Click-and-Drag to Scroll (Desktop)
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let hasMoved = false;
  let dragTicking = false;
  let currentMouseX = 0;

  container.addEventListener('mousedown', (e) => {
    isDown = true;
    hasMoved = false;
    container.classList.add('dragging');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  const stopDrag = () => {
    isDown = false;
    container.classList.remove('dragging');
  };

  container.addEventListener('mouseleave', stopDrag);
  container.addEventListener('mouseup', stopDrag);

  container.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    currentMouseX = e.pageX;

    if (!dragTicking) {
      window.requestAnimationFrame(() => {
        if (!isDown) {
          dragTicking = false;
          return;
        }
        const x = currentMouseX - container.offsetLeft;
        const walk = (x - startX) * 1.5;
        if (Math.abs(walk) > 8) {
          hasMoved = true;
        }
        container.scrollLeft = scrollLeft - walk;
        dragTicking = false;
      });
      dragTicking = true;
    }
  });

  // 3. Lightbox Functionality
  let currentLightboxIndex = 0;

  // Apply quick transition styles for content swap inside lightbox
  if (lightboxImg && lightboxTitle && lightboxDesc) {
    const transitionStyle = 'opacity 0.15s ease-out, transform 0.15s ease-out';
    lightboxImg.style.transition = transitionStyle;
    lightboxTitle.style.transition = transitionStyle;
    lightboxDesc.style.transition = transitionStyle;
  }

  function openLightbox(index) {
    const item = items[index];
    if (!item) return;

    currentLightboxIndex = index;
    const imgSrc = item.querySelector('img').getAttribute('src');
    const title = item.getAttribute('data-title') || '';
    const desc = item.getAttribute('data-desc') || '';

    if (lightboxImg) lightboxImg.setAttribute('src', imgSrc);
    if (lightboxTitle) lightboxTitle.innerText = title;
    if (lightboxDesc) lightboxDesc.innerText = desc;

    if (lightbox) {
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeLightbox() {
    if (lightbox) {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function navigateLightbox(direction) {
    let newIndex = currentLightboxIndex + direction;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;

    // Fade out first
    if (lightboxImg && lightboxTitle && lightboxDesc) {
      lightboxImg.style.opacity = '0';
      lightboxImg.style.transform = 'scale(0.97)';
      lightboxTitle.style.opacity = '0';
      lightboxDesc.style.opacity = '0';

      setTimeout(() => {
        openLightbox(newIndex);
        lightboxImg.style.opacity = '1';
        lightboxImg.style.transform = 'scale(1)';
        lightboxTitle.style.opacity = '1';
        lightboxDesc.style.opacity = '1';
      }, 150);
    } else {
      openLightbox(newIndex);
    }
  }

  // Bind clicks on gallery items
  items.forEach((item, index) => {
    item.addEventListener('click', () => {
      // Only open if the user wasn't dragging the gallery
      if (!hasMoved) {
        openLightbox(index);
      }
    });
  });

  // Bind close buttons and overlay click
  if (lightboxClose) {
    lightboxClose.addEventListener('click', closeLightbox);
  }

  if (lightboxPrev) {
    lightboxPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(-1);
    });
  }

  if (lightboxNext) {
    lightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(1);
    });
  }

  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      // Close if clicking outside the image content area
      if (e.target === lightbox || e.target.classList.contains('lightbox-content')) {
        closeLightbox();
      }
    });
  }

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!lightbox || !lightbox.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      navigateLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      navigateLightbox(1);
    }
  });
}

// ============================================================
// UNIFIED AUTHENTICATION & USER PORTAL HANDLERS
// ============================================================

function openAuthModal(defaultTab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    switchAuthTab(defaultTab);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function switchAuthTab(tab) {
  const loginBtn = document.getElementById('tab-login-btn');
  const regBtn = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('auth-login-form');
  const regForm = document.getElementById('auth-register-form');
  const title = document.getElementById('auth-modal-title');
  const sub = document.getElementById('auth-modal-sub');

  if (!loginBtn || !regBtn || !loginForm || !regForm) return;

  const loginErr = document.getElementById('auth-login-error');
  const regErr = document.getElementById('auth-register-error');
  if (loginErr) loginErr.classList.remove('visible');
  if (regErr) regErr.classList.remove('visible');

  if (tab === 'login') {
    loginBtn.classList.add('active');
    regBtn.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
    if (title) title.textContent = 'Account Sign In';
    if (sub) sub.textContent = 'Sign in to manage registrations, teams, and schedules';
  } else {
    regBtn.classList.add('active');
    loginBtn.classList.remove('active');
    regForm.style.display = 'block';
    loginForm.style.display = 'none';
    if (title) title.textContent = 'Create Athlete Account';
    if (sub) sub.textContent = 'Join Apex Sports Academy for tournaments and training';
  }
}

function toggleAuthPw(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

async function handleAuthLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('auth-identifier').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-login-submit');
  const btnText = document.getElementById('auth-login-btn-text');
  const errBox = document.getElementById('auth-login-error');

  if (errBox) errBox.classList.remove('visible');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      if (data.role === 'admin') {
        // Admin authorization: Store admin token & redirect to Admin Console
        sessionStorage.setItem('asa_admin_token', data.token);
        sessionStorage.setItem('asa_admin_expiry', String(Date.now() + (data.expiresIn || 28800000)));
        sessionStorage.setItem('asa_admin_user', data.user.username || 'admin');
        if (btnText) btnText.textContent = '✓ Access Granted — Redirecting...';
        setTimeout(() => {
          window.location.href = data.redirectUrl || '/admin/dashboard';
        }, 400);
        return;
      } else {
        // Normal User authorization: Store user session & open User Dashboard
        sessionStorage.setItem('asa_user_token', data.token);
        sessionStorage.setItem('asa_user_data', JSON.stringify(data.user || {}));
        if (btnText) btnText.textContent = '✓ Signed In Successfully!';
        setTimeout(() => {
          closeAuthModal();
          updateNavbarAuth();
          openUserPortal();
        }, 400);
        return;
      }
    }

    if (errBox) {
      errBox.textContent = data.error || 'Invalid credentials. Please verify your details and try again.';
      errBox.classList.add('visible');
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Unable to connect to server. Please check your internet connection.';
      errBox.classList.add('visible');
    }
  } finally {
    if (btn) btn.disabled = false;
    if (btnText && btnText.textContent === 'Verifying...') btnText.textContent = 'Sign In';
  }
}

async function handleAuthRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('auth-register-submit');
  const btnText = document.getElementById('auth-reg-btn-text');
  const errBox = document.getElementById('auth-register-error');

  if (errBox) errBox.classList.remove('visible');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Creating Account...';

  try {
    const res = await fetch('/api/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      sessionStorage.setItem('asa_user_token', data.token);
      sessionStorage.setItem('asa_user_data', JSON.stringify(data.user || {}));
      if (btnText) btnText.textContent = '✓ Account Created!';
      setTimeout(() => {
        closeAuthModal();
        updateNavbarAuth();
        openUserPortal();
      }, 400);
      return;
    }

    if (errBox) {
      errBox.textContent = data.error || 'Registration failed. Please check your information.';
      errBox.classList.add('visible');
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Unable to connect to server. Please check your internet connection.';
      errBox.classList.add('visible');
    }
  } finally {
    if (btn) btn.disabled = false;
    if (btnText && btnText.textContent === 'Creating Account...') btnText.textContent = 'Create Account';
  }
}

function handleNavAuthClick() {
  const adminToken = sessionStorage.getItem('asa_admin_token');
  const userToken = sessionStorage.getItem('asa_user_token');

  if (adminToken) {
    window.location.href = '/admin/dashboard';
  } else if (userToken) {
    openUserPortal();
  } else {
    openAuthModal('login');
  }
}

function updateNavbarAuth() {
  const navLink = document.getElementById('nav-auth-link');
  if (!navLink) return;

  const adminToken = sessionStorage.getItem('asa_admin_token');
  const userToken = sessionStorage.getItem('asa_user_token');

  if (adminToken) {
    navLink.textContent = 'Admin Console';
    navLink.style.background = 'rgba(0, 180, 216, 0.15)';
    navLink.style.borderColor = 'var(--primary)';
  } else if (userToken) {
    try {
      const user = JSON.parse(sessionStorage.getItem('asa_user_data') || '{}');
      const firstName = (user.name || 'My Account').split(' ')[0];
      navLink.textContent = `👤 ${firstName}`;
    } catch (e) {
      navLink.textContent = 'My Account';
    }
    navLink.style.background = 'rgba(0, 180, 216, 0.12)';
  } else {
    navLink.textContent = 'Login';
    navLink.style.background = 'rgba(0, 180, 216, 0.08)';
  }
}

// --- User Dashboard Portal ---

function openUserPortal() {
  const modal = document.getElementById('user-portal-modal');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadUserPortalData();
  }
}

function closeUserPortal() {
  const modal = document.getElementById('user-portal-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

async function loadUserPortalData() {
  const token = sessionStorage.getItem('asa_user_token');
  if (!token) return;

  const avatarEl = document.getElementById('portal-user-avatar');
  const nameEl = document.getElementById('portal-user-name');
  const phoneEl = document.getElementById('portal-user-phone');
  const roleEl = document.getElementById('portal-user-role');
  const listEl = document.getElementById('user-portal-registrations');

  try {
    const res = await fetch('/api/user/portal', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const user = data.user || {};
      if (nameEl) nameEl.textContent = user.name || 'Athlete';
      if (phoneEl) phoneEl.textContent = user.phone || user.email || 'Apex Member';
      if (avatarEl) avatarEl.textContent = (user.name || 'A').charAt(0).toUpperCase();
      if (roleEl) roleEl.textContent = 'Verified Athlete';

      const regs = data.registrations || [];
      if (!listEl) return;

      if (regs.length === 0) {
        listEl.innerHTML = `
          <div class="portal-empty-state">
            <p>No active registrations found yet.</p>
            <p style="font-size: 0.85rem; color: #94A3B8;">Register for the upcoming ASA Cup Tournament or Coaching batches to view receipts and match schedules here.</p>
          </div>
        `;
      } else {
        listEl.innerHTML = regs.map(r => `
          <div class="user-reg-card">
            <div class="user-reg-info">
              <h5>${r.entityName || r.type}</h5>
              <p class="user-reg-meta"><strong>ID:</strong> ${r.id} • <strong>Date:</strong> ${r.date}</p>
              <p class="user-reg-meta"><strong>Type:</strong> ${r.type} • <strong>Amount:</strong> ₹${(r.amount || 0).toLocaleString('en-IN')}</p>
              <span class="user-reg-status-paid">✓ ${r.status || 'Paid'}</span>
            </div>
            <div>
              <button class="btn-download-rec" onclick="downloadReceiptForId('${r.id}')">
                Download Receipt 📄
              </button>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div class="portal-empty-state"><p>Error loading registrations. Please try again.</p></div>`;
    }
  }
}

function downloadReceiptForId(regId) {
  window.open(`/api/receipt/${regId}/pdf`, '_blank');
}

async function handleUserLogout() {
  const token = sessionStorage.getItem('asa_user_token') || sessionStorage.getItem('asa_admin_token');
  try {
    if (token) {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
  } catch (e) { }
  sessionStorage.removeItem('asa_user_token');
  sessionStorage.removeItem('asa_user_data');
  sessionStorage.removeItem('asa_admin_token');
  sessionStorage.removeItem('asa_admin_user');
  sessionStorage.removeItem('asa_admin_expiry');
  closeUserPortal();
  updateNavbarAuth();
}

// --- Newsletter Form Submission Handler ---
function initNewsletter() {
  const form = document.getElementById('newsletter-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('newsletter-email');
    const btn = document.getElementById('newsletter-btn');
    const statusEl = document.getElementById('newsletter-status');

    if (!emailInput) return;
    const email = emailInput.value.trim();

    if (!email) {
      if (statusEl) {
        statusEl.className = 'newsletter-status error';
        statusEl.textContent = 'Please enter a valid email address.';
        statusEl.style.display = 'block';
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (statusEl) {
      statusEl.className = 'newsletter-status info';
      statusEl.textContent = 'Processing subscription...';
      statusEl.style.display = 'block';
    }

    try {
      const res = await fetch('/api/subscribe-newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (statusEl) {
          if (data.alreadySubscribed || (data.message && data.message.includes('already subscribed'))) {
            statusEl.className = 'newsletter-status info';
            statusEl.textContent = data.message || 'This email is already subscribed.';
          } else {
            statusEl.className = 'newsletter-status success';
            statusEl.textContent = data.message || 'Please check your email to verify your subscription.';
          }
          statusEl.style.display = 'block';
        }
        form.reset();
      } else {
        if (statusEl) {
          statusEl.className = 'newsletter-status error';
          statusEl.textContent = (data && data.message) ? data.message : 'Unable to process your subscription right now. Please try again.';
          statusEl.style.display = 'block';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.className = 'newsletter-status error';
        statusEl.textContent = 'Unable to connect to server. Please try again later.';
        statusEl.style.display = 'block';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// --- Window Lifecycle Actions ---
window.onload = () => {
  initCountdown();
  initGallery();
  updateNavbarAuth();
  initNewsletter();
  initVenueBookingEngine();

  // Check if query parameter has pre-selections
  const urlParams = new URLSearchParams(window.location.search);
  const selectedProgram = urlParams.get('program');
  if (selectedProgram) {
    if (selectedProgram === 'coaching') {
      selectCoachingTier('weekday-1');
    } else {
      selectCoachingTier('tournament', 1200);
    }
  }

  // Check if user already submitted an enquiry
  const cachedUserPhone = localStorage.getItem('apex_user_phone');
  if (cachedUserPhone) {
    const inputArea = document.getElementById('hero-input-area');
    const successArea = document.getElementById('hero-success-area');
    const displayPhone = document.getElementById('submitted-phone-display');
    if (inputArea && successArea && displayPhone) {
      inputArea.style.display = 'none';
      displayPhone.innerText = cachedUserPhone;
      successArea.style.display = 'block';
    }
  }
};

// --- Tournament Rulebook Modal Handlers ---
function openRulebookModal() {
  const modal = document.getElementById('rulebook-modal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeRulebookModal() {
  const modal = document.getElementById('rulebook-modal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// Global escape key handler for all modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeRulebookModal();
    closeAuthModal();
    closeUserPortal();
    closeVenueConfirmModal();
  }
});

// ============================================================
// --- APEX SPORTS ACADEMY CLEAN MOBILE-FIRST BOOKING ENGINE ---
// ============================================================

let cleanBookingState = {
  venueId: 'apex-sports-academy',
  sport: 'volleyball',
  date: '',
  startTime: '',
  duration: 1,
  court: 'Volleyball Court 1',
  calculatedPrice: 500,
  availability: null,
  activeSlots: []
};

const VENUE_COURTS_CONFIG = {
  volleyball: ['Volleyball Court 1', 'Volleyball Court 2'],
  'box-cricket': ['Box Cricket Arena 1', 'Box Cricket Arena 2'],
  football: ['AstroTurf Ground 1 (5v5 / 7v7)', 'Small Ground 1']
};

function initVenueBookingEngine() {
  initCleanBookingEngine();
}

function openCleanBookingModal() {
  const engine = document.getElementById('slot-booking-engine');
  if (engine) {
    const topOffset = engine.getBoundingClientRect().top + window.pageYOffset - 80;
    window.scrollTo({ top: topOffset, behavior: 'smooth' });
    engine.style.transition = 'box-shadow 0.3s ease';
    engine.style.boxShadow = '0 0 0 4px rgba(0, 184, 107, 0.4), 0 20px 45px rgba(0,0,0,0.35)';
    setTimeout(() => {
      engine.style.boxShadow = '';
    }, 1500);
  }
}

function handleShareVenue() {
  if (navigator.share) {
    navigator.share({
      title: 'Apex Sports Academy - Electronic City, Bengaluru',
      text: 'Book Football, Box Cricket & Volleyball slots at Apex Sports Academy, Electronic City!',
      url: window.location.origin + '/#venue-booking'
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.origin + '/#venue-booking');
    alert('Venue booking link copied to clipboard!');
  }
}

function openBulkInquiryModal() {
  const subject = encodeURIComponent('Bulk / Corporate Slot Booking Inquiry - Apex Sports Academy');
  const body = encodeURIComponent('Hi Apex Sports Academy,\n\nI am interested in corporate/bulk slot bookings for our team.\n\nOrganization:\nPreferred Sport (Football / Cricket / Volleyball):\nEstimated Hours / Days:\nContact Phone:');
  window.location.href = `mailto:apexsportsacademy08@gmail.com?subject=${subject}&body=${body}`;
}

function initCleanBookingEngine() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  cleanBookingState.date = todayStr;

  const dateInput = document.getElementById('clean-date');
  if (dateInput) {
    dateInput.min = todayStr;
    dateInput.value = todayStr;
  }

  updateCleanCourtsDropdown(cleanBookingState.sport);
  fetchCleanSlotAvailability();
  prefillCleanAthleteInfo();
  syncAllBookingSummaries();
}

function formatBookingDateDisplay(dateStr) {
  if (!dateStr) return 'Today';
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function getSportDisplayName(sportKey) {
  const map = {
    volleyball: 'Volleyball',
    'box-cricket': 'Box Cricket',
    football: 'Football'
  };
  return map[sportKey] || sportKey || 'Volleyball';
}

function getSportIcon(sportKey) {
  const map = {
    volleyball: '🏐',
    'box-cricket': '🏏',
    football: '⚽'
  };
  return map[sportKey] || '🏐';
}

function formatSlotTimeDisplay(slotStr) {
  if (!slotStr) return '06:00 AM';
  const startHour = parseInt(slotStr.split(':')[0], 10);
  if (isNaN(startHour)) return slotStr;
  const ampm = startHour >= 12 ? 'PM' : 'AM';
  const hour12 = startHour % 12 === 0 ? 12 : startHour % 12;
  return `${String(hour12).padStart(2, '0')}:00 ${ampm}`;
}

function formatDurationDisplay(dur) {
  const num = Number(dur) || 1;
  return num === 1 ? '1 Hour' : (num % 1 === 0 ? `${num} Hours` : `${num} Hours`);
}

function syncAllBookingSummaries() {
  const { sport, date, startTime, duration, court, calculatedPrice } = cleanBookingState;
  const sportName = getSportDisplayName(sport);
  const sportIcon = getSportIcon(sport);
  const dateFormatted = formatBookingDateDisplay(date);
  const timeFormatted = formatSlotTimeDisplay(startTime);
  const durFormatted = formatDurationDisplay(duration);
  const priceFormatted = `₹${(calculatedPrice || 0).toLocaleString('en-IN')}`;

  // Step 1 Summary panel elements
  const s1Sport = document.getElementById('summary-s1-sport');
  const s1Date = document.getElementById('summary-s1-date');
  const s1Time = document.getElementById('summary-s1-time');
  const s1Dur = document.getElementById('summary-s1-duration');
  const s1Court = document.getElementById('summary-s1-court');
  const s1Price = document.getElementById('clean-price-val');

  if (s1Sport) s1Sport.innerText = sportName;
  if (s1Date) s1Date.innerText = dateFormatted;
  if (s1Time) s1Time.innerText = timeFormatted;
  if (s1Dur) s1Dur.innerText = durFormatted;
  if (s1Court) s1Court.innerText = court || 'Main Court';
  if (s1Price) s1Price.innerText = priceFormatted;

  // Step 2 Compact Strip elements
  const stripIcon = document.getElementById('strip-icon');
  const stripSport = document.getElementById('strip-sport');
  const stripDate = document.getElementById('strip-date');
  const stripTime = document.getElementById('strip-time');
  const stripDur = document.getElementById('strip-duration');
  const stripCourt = document.getElementById('strip-court');

  if (stripIcon) stripIcon.innerText = sportIcon;
  if (stripSport) stripSport.innerText = sportName;
  if (stripDate) stripDate.innerText = dateFormatted;
  if (stripTime) stripTime.innerText = timeFormatted;
  if (stripDur) stripDur.innerText = durFormatted;
  if (stripCourt) stripCourt.innerText = court || 'Main Court';

  // Step 2 Desktop Right Summary Card elements
  const s2Sport = document.getElementById('summary-s2-sport');
  const s2Date = document.getElementById('summary-s2-date');
  const s2Time = document.getElementById('summary-s2-time');
  const s2Dur = document.getElementById('summary-s2-duration');
  const s2Court = document.getElementById('summary-s2-court');
  const s2Total = document.getElementById('clean-step2-total-amount');
  const payBtnAmount = document.getElementById('btn-pay-amount-label');
  const proceedBtn = document.getElementById('btn-clean-proceed-pay');

  if (s2Sport) s2Sport.innerText = sportName;
  if (s2Date) s2Date.innerText = dateFormatted;
  if (s2Time) s2Time.innerText = timeFormatted;
  if (s2Dur) s2Dur.innerText = durFormatted;
  if (s2Court) s2Court.innerText = court || 'Main Court';
  if (s2Total) s2Total.innerText = priceFormatted;
  
  if (payBtnAmount) {
    payBtnAmount.innerText = priceFormatted;
  } else if (proceedBtn && !proceedBtn.disabled) {
    proceedBtn.innerHTML = `Proceed to Pay <span id="btn-pay-amount-label">${priceFormatted}</span> →`;
  }
}

function updateCleanCourtsDropdown(sport) {
  const select = document.getElementById('clean-court');
  if (!select) return;

  const courts = VENUE_COURTS_CONFIG[sport] || VENUE_COURTS_CONFIG['volleyball'];
  select.innerHTML = courts.map((c, idx) => `<option value="${c}" ${idx === 0 ? 'selected' : ''}>${c}</option>`).join('');
  cleanBookingState.court = courts[0];
  syncAllBookingSummaries();
}

function onCleanSportChange(sport) {
  cleanBookingState.sport = sport;
  updateCleanCourtsDropdown(sport);
  fetchCleanSlotAvailability();
  syncAllBookingSummaries();
}

function onCleanDateChange(dateVal) {
  if (!dateVal) return;
  cleanBookingState.date = dateVal;
  fetchCleanSlotAvailability();
  syncAllBookingSummaries();
}

function onCleanCourtChange(courtVal) {
  cleanBookingState.court = courtVal;
  syncAllBookingSummaries();
}

function setCleanDuration(durVal) {
  const dur = Number(durVal) || 1;
  cleanBookingState.duration = dur;

  // Update pills UI
  const buttons = document.querySelectorAll('.duration-pill-btn');
  buttons.forEach(btn => {
    const val = Number(btn.getAttribute('data-duration'));
    if (val === dur) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  updateCleanTimeDropdown();
  updateCleanPrice();
  syncAllBookingSummaries();
}

function fetchCleanSlotAvailability() {
  const hint = document.getElementById('clean-slot-hint-text');
  const timeSelect = document.getElementById('clean-start-time');
  if (hint) hint.innerText = 'Checking available slots...';
  if (timeSelect) timeSelect.disabled = true;

  const { venueId, sport, date } = cleanBookingState;

  fetch(`/api/venues/${venueId}/availability?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}`)
    .then(res => res.json())
    .then(data => {
      if (timeSelect) timeSelect.disabled = false;
      if (data.success) {
        cleanBookingState.availability = data;
        updateCleanTimeDropdown();
        updateCleanPrice();
      }
    })
    .catch(err => {
      console.error('Failed to fetch availability:', err);
      if (timeSelect) timeSelect.disabled = false;
      if (hint) hint.innerText = 'Unable to load slots. Please check connection.';
    });
}

function updateCleanTimeDropdown() {
  const select = document.getElementById('clean-start-time');
  const hint = document.getElementById('clean-slot-hint-text');
  if (!select || !cleanBookingState.availability) return;

  const { allSlots = [], bookedSlots = [], blockedSlots = [] } = cleanBookingState.availability;
  const duration = cleanBookingState.duration;
  const slotCountNeeded = Math.ceil(duration);

  select.innerHTML = '';
  let availableCount = 0;
  let firstAvailableStart = null;

  allSlots.forEach((slot, idx) => {
    // Check if consecutive slots for duration are available
    let canBook = true;
    const requiredSlots = [];

    for (let i = 0; i < slotCountNeeded; i++) {
      const targetSlot = allSlots[idx + i];
      if (!targetSlot) {
        canBook = false;
        break;
      }
      if (bookedSlots.includes(targetSlot) || blockedSlots.includes(targetSlot)) {
        canBook = false;
        break;
      }
      requiredSlots.push(targetSlot);
    }

    // Extract start time label (e.g. "06:00 - 07:00" -> "06:00 AM")
    const startHour = parseInt(slot.split(':')[0], 10);
    const ampm = startHour >= 12 ? 'PM' : 'AM';
    const hour12 = startHour % 12 === 0 ? 12 : startHour % 12;
    const startLabel = `${String(hour12).padStart(2, '0')}:00 ${ampm}`;

    const opt = document.createElement('option');
    opt.value = slot;

    if (canBook) {
      availableCount++;
      opt.textContent = `🕐 ${startLabel} (Available)`;
      if (!firstAvailableStart) firstAvailableStart = slot;
    } else {
      opt.textContent = `🔒 ${startLabel} (Unavailable)`;
      opt.disabled = true;
    }

    select.appendChild(opt);
  });

  if (firstAvailableStart) {
    select.value = firstAvailableStart;
    cleanBookingState.startTime = firstAvailableStart;
    if (hint) hint.innerText = `${availableCount} slot${availableCount !== 1 ? 's' : ''} available`;
  } else {
    cleanBookingState.startTime = '';
    if (hint) hint.innerText = 'No continuous slots available for this duration. Try reducing duration.';
  }

  syncAllBookingSummaries();
}

function onCleanStartTimeChange(timeVal) {
  cleanBookingState.startTime = timeVal;
  updateCleanPrice();
  syncAllBookingSummaries();
}

function updateCleanPrice() {
  const { sport, date, startTime, duration, availability } = cleanBookingState;
  const rateNote = document.getElementById('clean-rate-note');

  if (!startTime || !availability) {
    const fallbackBase = 500;
    const fallbackTotal = Math.round(fallbackBase * duration);
    cleanBookingState.calculatedPrice = fallbackTotal;
    syncAllBookingSummaries();
    return;
  }

  const allSlots = availability.allSlots || [];
  const startIdx = allSlots.indexOf(startTime);
  const consecutiveSlots = [];
  const slotCountNeeded = Math.ceil(duration);

  if (startIdx !== -1) {
    for (let i = 0; i < slotCountNeeded; i++) {
      if (allSlots[startIdx + i]) consecutiveSlots.push(allSlots[startIdx + i]);
    }
  } else {
    consecutiveSlots.push(startTime);
  }

  cleanBookingState.activeSlots = consecutiveSlots;

  fetch('/api/venues/calculate-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sport,
      date,
      timeSlots: consecutiveSlots,
      duration
    })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.calculation) {
        const c = data.calculation;
        cleanBookingState.calculatedPrice = c.totalAmount;
        syncAllBookingSummaries();

        const hasPeak = c.breakdown && c.breakdown.some(b => b.isPeak);
        if (rateNote) {
          rateNote.innerText = hasPeak
            ? `₹${c.baseHourlyRate}/hr base rate + peak hour surcharge`
            : `₹${c.baseHourlyRate}/hr rate • Inclusive of court lighting & GST`;
        }
      }
    })
    .catch(err => {
      console.warn('Price calculation error:', err);
    });
}

function prefillCleanAthleteInfo() {
  const token = localStorage.getItem('apex_auth_token');
  const userJson = localStorage.getItem('apex_auth_user');
  if (token && userJson) {
    try {
      const user = JSON.parse(userJson);
      const nameInput = document.getElementById('clean-player-name');
      const phoneInput = document.getElementById('clean-player-phone');
      const emailInput = document.getElementById('clean-player-email');

      if (nameInput && user.name) nameInput.value = user.name;
      if (phoneInput && user.phone) phoneInput.value = user.phone;
      if (emailInput && user.email) emailInput.value = user.email;
    } catch (e) { /* ignore */ }
  }
}

function setProgressStep(stepNumber) {
  const step1 = document.getElementById('prog-step-1');
  const step2 = document.getElementById('prog-step-2');
  const step3 = document.getElementById('prog-step-3');

  if (!step1 || !step2 || !step3) return;

  step1.className = 'progress-step';
  step2.className = 'progress-step';
  step3.className = 'progress-step';

  if (stepNumber === 1) {
    step1.classList.add('active');
  } else if (stepNumber === 2) {
    step1.classList.add('completed');
    step2.classList.add('active');
  } else if (stepNumber === 3) {
    step1.classList.add('completed');
    step2.classList.add('completed');
    step3.classList.add('active');
  }
}

function goToCleanStep2() {
  if (!cleanBookingState.startTime) {
    alert('Please select an available start time slot before continuing.');
    document.getElementById('clean-start-time')?.focus();
    return;
  }

  syncAllBookingSummaries();
  setProgressStep(2);

  const step1 = document.getElementById('clean-step-1');
  const step2 = document.getElementById('clean-step-2');
  const step3 = document.getElementById('clean-step-3');

  if (step1 && step2) {
    step1.style.display = 'none';
    if (step3) step3.style.display = 'none';
    step2.style.display = 'block';

    const cardEl = document.getElementById('slot-booking-engine');
    if (cardEl) {
      const topOffset = cardEl.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: topOffset, behavior: 'smooth' });
    }
  }
}

function goToCleanStep1() {
  syncAllBookingSummaries();
  setProgressStep(1);

  const step1 = document.getElementById('clean-step-1');
  const step2 = document.getElementById('clean-step-2');
  const step3 = document.getElementById('clean-step-3');

  if (step1 && step2) {
    step2.style.display = 'none';
    if (step3) step3.style.display = 'none';
    step1.style.display = 'block';

    const cardEl = document.getElementById('slot-booking-engine');
    if (cardEl) {
      const topOffset = cardEl.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: topOffset, behavior: 'smooth' });
    }
  }
}

function handleCleanProceedToPayment() {
  const name = (document.getElementById('clean-player-name')?.value || '').trim();
  const phone = (document.getElementById('clean-player-phone')?.value || '').trim();
  const email = (document.getElementById('clean-player-email')?.value || '').trim();
  const team = (document.getElementById('clean-team-name')?.value || '').trim();
  const players = document.getElementById('clean-player-count')?.value || 10;

  if (!name) {
    alert('Please enter your Full Name.');
    document.getElementById('clean-player-name')?.focus();
    return;
  }
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit mobile number.');
    document.getElementById('clean-player-phone')?.focus();
    return;
  }
  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address.');
    document.getElementById('clean-player-email')?.focus();
    return;
  }

  const proceedBtn = document.getElementById('btn-clean-proceed-pay');
  const amountStr = `₹${(cleanBookingState.calculatedPrice || 500).toLocaleString('en-IN')}`;
  if (proceedBtn) {
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = '<span>🔒 Securing Order...</span>';
  }

  const slotsToBook = cleanBookingState.activeSlots && cleanBookingState.activeSlots.length > 0
    ? cleanBookingState.activeSlots
    : [cleanBookingState.startTime];

  const bookingPayload = {
    venueId: cleanBookingState.venueId,
    sport: cleanBookingState.sport,
    court: cleanBookingState.court,
    date: cleanBookingState.date,
    timeSlots: slotsToBook,
    duration: cleanBookingState.duration,
    customerName: name,
    phone,
    email,
    teamName: team,
    playerCount: players
  };

  fetch('/api/venue-booking/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingPayload)
  })
    .then(res => res.json())
    .then(orderRes => {
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.innerHTML = `Proceed to Pay <span id="btn-pay-amount-label">${amountStr}</span> →`;
      }

      if (!orderRes.success) {
        alert(orderRes.error || 'Failed to create booking order.');
        goToCleanStep1();
        fetchCleanSlotAvailability();
        return;
      }

      // Check if sandbox test keys / simulation
      if (orderRes.mock || !orderRes.key_id || orderRes.key_id === 'rzp_test_placeholder_key_id') {
        const proceedMock = confirm(`[Razorpay Test Mode / Simulation]\n\nAmount: ₹${orderRes.amount}\nSport: ${bookingPayload.sport}\nCourt: ${bookingPayload.court}\nDate: ${bookingPayload.date}\nSlots: ${bookingPayload.timeSlots.join(', ')}\n\nClick OK to simulate successful Razorpay Payment, or Cancel.`);
        if (proceedMock) {
          verifyCleanVenuePayment({
            razorpay_payment_id: `pay_mock_${Date.now()}`,
            razorpay_order_id: orderRes.order_id,
            razorpay_signature: 'mock_signature'
          }, bookingPayload, true);
        }
        return;
      }

      // Standard Razorpay Modal
      const options = {
        key: orderRes.key_id,
        amount: orderRes.amount * 100,
        currency: 'INR',
        name: 'Apex Sports Academy',
        description: `${bookingPayload.sport.toUpperCase()} Booking on ${bookingPayload.date}`,
        image: 'Logo.jpeg',
        order_id: orderRes.order_id,
        handler: function (response) {
          verifyCleanVenuePayment(response, bookingPayload, false);
        },
        prefill: {
          name: bookingPayload.customerName,
          email: bookingPayload.email,
          contact: bookingPayload.phone
        },
        theme: {
          color: '#00b86b'
        },
        modal: {
          ondismiss: function () {
            console.log('Razorpay booking dismissed.');
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();
    })
    .catch(err => {
      console.error('Error creating venue order:', err);
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.innerHTML = `Proceed to Pay <span id="btn-pay-amount-label">${amountStr}</span> →`;
      }
      alert('Network error connecting to booking server.');
    });
}

function verifyCleanVenuePayment(rzpResponse, bookingData, isMock) {
  const proceedBtn = document.getElementById('btn-clean-proceed-pay');
  if (proceedBtn) {
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = '<span>Verifying Payment...</span>';
  }

  fetch('/api/venue-booking/verify-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_payment_id: rzpResponse.razorpay_payment_id,
      razorpay_order_id: rzpResponse.razorpay_order_id,
      razorpay_signature: rzpResponse.razorpay_signature,
      booking_data: bookingData,
      is_mock: isMock
    })
  })
    .then(res => res.json())
    .then(verifyRes => {
      const amountStr = `₹${(cleanBookingState.calculatedPrice || 500).toLocaleString('en-IN')}`;
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.innerHTML = `Proceed to Pay <span id="btn-pay-amount-label">${amountStr}</span> →`;
      }

      if (!verifyRes.success) {
        alert(verifyRes.error || 'Payment signature verification failed.');
        goToCleanStep1();
        fetchCleanSlotAvailability();
        return;
      }

      showCleanBookingConfirmation(verifyRes.booking);
    })
    .catch(err => {
      console.error('Verification error:', err);
      const amountStr = `₹${(cleanBookingState.calculatedPrice || 500).toLocaleString('en-IN')}`;
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.innerHTML = `Proceed to Pay <span id="btn-pay-amount-label">${amountStr}</span> →`;
      }
      alert('Error verifying booking with server.');
    });
}

function showCleanBookingConfirmation(bkg) {
  window.lastConfirmedVenueBooking = bkg;
  setProgressStep(3);

  const step1 = document.getElementById('clean-step-1');
  const step2 = document.getElementById('clean-step-2');
  const step3 = document.getElementById('clean-step-3');

  if (step1) step1.style.display = 'none';
  if (step2) step2.style.display = 'none';
  if (step3) step3.style.display = 'block';

  const recId = document.getElementById('c-rec-id');
  const recSport = document.getElementById('c-rec-sport');
  const recCourt = document.getElementById('c-rec-court');
  const recDatetime = document.getElementById('c-rec-datetime');
  const recName = document.getElementById('c-rec-name');
  const recPhone = document.getElementById('c-rec-phone');
  const recAmount = document.getElementById('c-rec-amount');
  const recPaymentId = document.getElementById('c-rec-payment-id');

  const slotStr = Array.isArray(bkg.timeSlots) ? bkg.timeSlots.join(', ') : (bkg.timeSlots || '—');

  if (recId) recId.innerText = bkg.id || 'ASA-BKG-XXXXXX';
  if (recSport) recSport.innerText = bkg.sport || 'Volleyball';
  if (recCourt) recCourt.innerText = bkg.court || 'Volleyball Court 1';
  if (recDatetime) recDatetime.innerText = `${formatBookingDateDisplay(bkg.date)} • ${slotStr} (${bkg.durationHours || bkg.duration || 1} Hr)`;
  if (recName) recName.innerText = bkg.customerName || 'Athlete';
  if (recPhone) recPhone.innerText = bkg.phone || '—';
  if (recAmount) recAmount.innerText = `₹${(bkg.amount || 0).toLocaleString('en-IN')}`;
  if (recPaymentId) recPaymentId.innerText = bkg.razorpayPaymentId || 'pay_test_verified';

  step3?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetCleanBookingForm() {
  setProgressStep(1);
  const step1 = document.getElementById('clean-step-1');
  const step2 = document.getElementById('clean-step-2');
  const step3 = document.getElementById('clean-step-3');

  if (step3) step3.style.display = 'none';
  if (step2) step2.style.display = 'none';
  if (step1) step1.style.display = 'block';

  fetchCleanSlotAvailability();
  syncAllBookingSummaries();
}

function printVenueReceipt() {
  const bkg = window.lastConfirmedVenueBooking;
  if (!bkg) {
    window.print();
    return;
  }

  const printWin = window.open('', '_blank', 'width=800,height=900');
  if (!printWin) {
    alert('Please allow popups to download/print the official receipt.');
    return;
  }

  const slotStr = Array.isArray(bkg.timeSlots) ? bkg.timeSlots.join(', ') : bkg.timeSlots;

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Apex Sports Academy - Venue Booking Receipt ${bkg.id}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #0f172a; background: #ffffff; }
        .receipt-card { border: 2px solid #10b981; border-radius: 12px; padding: 30px; max-width: 680px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 24px; }
        .logo-title { font-size: 24px; font-weight: 800; text-transform: uppercase; color: #0f172a; }
        .logo-title span { color: #10b981; }
        .badge { background: #10b981; color: #fff; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 12px; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .meta-table td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .meta-table td.label { color: #64748b; font-weight: 600; width: 38%; }
        .meta-table td.value { color: #0f172a; font-weight: 700; }
        .highlight { color: #059669; font-size: 16px; }
        .total-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; text-align: right; margin-bottom: 24px; }
        .total-box .amount { font-size: 22px; font-weight: 800; color: #059669; }
        .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="receipt-card">
        <div class="header">
          <div>
            <div class="logo-title">Apex <span>Sports</span> Academy</div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Electronic City, Bengaluru</div>
          </div>
          <div class="badge">PAID &amp; CONFIRMED</div>
        </div>

        <table class="meta-table">
          <tr><td class="label">Booking ID:</td><td class="value highlight">${bkg.id}</td></tr>
          <tr><td class="label">Sport:</td><td class="value">${bkg.sport}</td></tr>
          <tr><td class="label">Court / Ground:</td><td class="value">${bkg.court || 'Court 1'}</td></tr>
          <tr><td class="label">Match Date:</td><td class="value">${bkg.date}</td></tr>
          <tr><td class="label">Time Slot(s):</td><td class="value" style="color: #059669;">${slotStr} (${bkg.durationHours || 1} Hour)</td></tr>
          <tr><td class="label">Customer Name:</td><td class="value">${bkg.customerName}</td></tr>
          <tr><td class="label">Contact Phone:</td><td class="value">${bkg.phone}</td></tr>
          <tr><td class="label">Email:</td><td class="value">${bkg.email}</td></tr>
          <tr><td class="label">Team / Player:</td><td class="value">${bkg.teamName || 'N/A'}</td></tr>
          <tr><td class="label">Razorpay Payment ID:</td><td class="value" style="font-family: monospace;">${bkg.razorpayPaymentId || 'N/A'}</td></tr>
          <tr><td class="label">Venue Address:</td><td class="value">VM77+WGJ, Doddanagamangala Rd, Konappana Agrahara, Electronic City, Bengaluru, Karnataka 560100</td></tr>
        </table>

        <div class="total-box">
          <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Total Paid Amount</div>
          <div class="amount">₹${(bkg.amount || 0).toLocaleString('en-IN')}</div>
        </div>

        <div class="footer">
          <p>Thank you for choosing Apex Sports Academy. Please arrive 10 minutes prior to slot timing.</p>
          <p>Also listed on Playo: http://go.playo.app/PLAYOO/l51Ra</p>
        </div>
      </div>
      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}



