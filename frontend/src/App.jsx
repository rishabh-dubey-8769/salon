import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { formatSalonDistance, readStoredLocationFix, shouldAcceptLocationFix, storeLocationFix } from './location.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? 'https://salon-g34s.onrender.com' : '');
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const bookingStatusLabel = (status) => {
  const labels = {
    pending_payment: 'Booking: pending',
    waiting: 'Booking: waiting',
    in_service: 'Service: in progress',
    completed: 'Service: completed',
    cancelled: 'Booking: cancelled',
    rejected: 'Booking: rejected',
  };
  return labels[status] || `Booking: ${String(status || 'unknown').replaceAll('_', ' ')}`;
};
const paymentStatusLabel = (status, bookingStatus) =>
  `Payment: ${bookingStatus === 'cancelled' ? 'cancelled' : String(status || 'pending').replaceAll('_', ' ')}`;
const formatWaitDuration = (minutes) => {
  const totalMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  if (totalMinutes <= 60) return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${remainingMinutes ? ` ${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}` : ''}`;
};
const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const formatAppointmentDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};
const LIST_PAGE_SIZE = 10;
const PAGE_HASHES = {
  home: '#home',
  orders: '#orders',
  admin: '#dashboard',
  salon: '#owner',
  profile: '#profile',
};
const HASH_PAGES = Object.fromEntries(Object.entries(PAGE_HASHES).map(([page, hash]) => [hash, page]));
const getPageFromLocation = () => HASH_PAGES[window.location.hash] || 'home';
const SALON_SERVICES = [
  { name: 'Haircut', category: 'Haircut' },
  { name: 'Beard trim', category: 'Beard & Shave' },
  { name: 'Beard shave', category: 'Beard & Shave' },
  { name: 'Hair curl', category: 'Hair Styling' },
  { name: 'Hair color', category: 'Hair Color' },
  { name: 'Head massage', category: 'Head Massage' },
  { name: 'Face massage', category: 'Face Massage' },
];

function SalonServiceField({ service, onChange, id }) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!fieldRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectService = (option) => {
    onChange({ ...service, name: option.name, category: option.category });
    setOpen(false);
  };

  return (
    <div className="salon-service-picker" ref={fieldRef}>
      <input
        id={id}
        value={service.name}
        onChange={(event) => {
          const name = event.target.value;
          const option = SALON_SERVICES.find((item) => item.name === name);
          onChange({
            ...service,
            name,
            category: option?.category || service.category || 'Other',
          });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        maxLength={80}
        placeholder="Choose or type service"
        aria-label="Choose or type a service"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        autoComplete="off"
        required
      />
      {open && (
        <div className="salon-service-options" id={`${id}-options`} role="listbox" aria-label="Service options">
          <button type="button" className="salon-service-custom" onClick={() => {
            onChange({ ...service, category: service.category || 'Other' });
            setOpen(false);
          }}>＋ Add new service</button>
          {SALON_SERVICES
            .filter((option) => !service.name || option.name.toLowerCase().includes(service.name.toLowerCase()))
            .map((option) => (
              <button type="button" role="option" aria-selected={service.name === option.name} key={option.name} onClick={() => selectService(option)}>
                {option.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function useLoadMore(items, resetKey) {
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [resetKey]);
  return {
    visibleItems: items.slice(0, visibleCount),
    hasMore: items.length > visibleCount,
    loadMore: () => setVisibleCount((count) => Math.min(count + LIST_PAGE_SIZE, items.length)),
  };
}

function LoadMoreButton({ shown, total, onClick, label = 'items' }) {
  if (shown >= total) return null;
  return (
    <div className="load-more-row">
      <button className="button button-soft button-small" type="button" aria-label={`Load 10 more ${label}`} onClick={onClick}>
        Load 10 more
      </button>
    </div>
  );
}

function BackArrowButton({ onClick, label = 'Back to home', className = '' }) {
  return (
    <button className={`text-button back-navigation ${className}`.trim()} type="button" onClick={onClick} aria-label={label} title={label}>
      <svg className="back-navigation-icon" viewBox="0 0 32 24" aria-hidden="true"><path d="M13 3 3 12l10 9M4 12h25" /></svg>
    </button>
  );
}

function ConfirmationDialog({ confirmation, onResolve }) {
  useEffect(() => {
    if (!confirmation) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onResolve(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmation, onResolve]);

  if (!confirmation) return null;
  return (
    <div className="dialog-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onResolve(false);
    }}>
      <section className="auth-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
        <h2 id="confirmation-title">{confirmation.title}</h2>
        <p id="confirmation-message">{confirmation.message}</p>
        <div className="confirmation-actions">
          <button className="button button-soft" type="button" onClick={() => onResolve(false)}>{confirmation.cancelLabel}</button>
          <button className={`button ${confirmation.danger ? 'button-confirm-danger' : 'button-primary'}`} type="button" autoFocus onClick={() => onResolve(true)}>{confirmation.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status}).`);
  return payload;
}

function CoordinateFields({ latitude, longitude, pinCode = '', onChange, onError, required = true, currentLocationLabel = '◎ Use my current location', className = '' }) {
  const [locating, setLocating] = useState(false);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      onError('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      onChange('lat', coords.latitude.toFixed(7));
      onChange('lng', coords.longitude.toFixed(7));
      onError('');
      setLocating(false);
    }, () => {
      onError('Could not access location. Allow location access in your browser and try again.');
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  return (
    <div className={`coordinate-fields ${className}`}>
      <label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => onChange('lat', event.target.value)} required={required} /></label>
      <label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => onChange('lng', event.target.value)} required={required} /></label>
      <label>Area PIN code<input type="text" inputMode="numeric" autoComplete="postal-code" value={pinCode} onChange={(event) => onChange('pinCode', event.target.value)} maxLength={20} placeholder="Enter area PIN code" /></label>
      <button type="button" className="button button-soft current-location-button" onClick={useCurrentLocation} disabled={locating}>{locating ? 'Getting your location…' : currentLocationLabel}</button>
      <p className="fine-print">Coordinates are filled from your browser location. You can also enter them manually.</p>
    </div>
  );
}

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getSalonDirectionsUrl(salon, location) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${salon.lat},${salon.lng}`,
    travelmode: 'driving',
  });
  if (location) params.set('origin', `${location.lat},${location.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function MapsLocateLink({ salon, location, className = '', stopPropagation = false }) {
  return (
    <a
      className={`salon-map-link ${className}`.trim()}
      href={getSalonDirectionsUrl(salon, location)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Locate ${salon.name} in Google Maps`}
      title={`Locate ${salon.name} in Google Maps`}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      <svg className="maps-locate-logo" viewBox="0 0 32 36" aria-hidden="true">
        <path fill="#4285F4" d="M16 1.5C8.5 1.5 2.5 7.4 2.5 14.8c0 9.1 11.6 19.6 12.1 20.1a2 2 0 0 0 2.8 0c.5-.5 12.1-11 12.1-20.1C29.5 7.4 23.5 1.5 16 1.5Z" />
        <path fill="#34A853" d="M4.6 8.3 14.2 13l-6.1 9.1c-2.7-3.1-5.6-7-5.6-11.3 0-.9.1-1.7.3-2.5Z" />
        <path fill="#FBBC04" d="m14.2 13 13.7-1.2c.2 1 .3 2 .3 3 0 3-1.8 6.4-4.1 9.5L14.2 13Z" />
        <path fill="#EA4335" d="M16 1.5c5.8 0 10.8 3.6 12.6 8.7l-14.4 2.1L4.6 8.3A13.4 13.4 0 0 1 16 1.5Z" />
        <circle cx="16" cy="14" r="5.1" fill="#fff" />
      </svg>
      <span>Locate</span>
    </a>
  );
}

function getSalonProfileUrl(salonId) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('salon', salonId);
  url.hash = 'home';
  return url.toString();
}

function loadCardImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!source.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The salon logo could not be loaded for the visiting card. Check the image URL or upload the logo again.'));
    image.src = source;
  });
}

function roundCanvasRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

async function createSalonVisitingCard(salon) {
  const width = 1200;
  const height = 675;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the visiting card image.');

  const cardGradient = context.createLinearGradient(0, 0, width, height);
  cardGradient.addColorStop(0, '#fffaf7');
  cardGradient.addColorStop(0.55, '#fffdfd');
  cardGradient.addColorStop(1, '#f5efff');
  context.fillStyle = cardGradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = '#b86b91';
  context.lineWidth = 3;
  roundCanvasRect(context, 8, 8, width - 16, height - 16, 34);
  context.stroke();

  context.fillStyle = '#b44476';
  context.font = '800 30px Arial, sans-serif';
  context.fillText('SALONFLOW', 86, 90);
  context.fillStyle = '#857588';
  context.font = '600 19px Arial, sans-serif';
  context.fillText('SCAN TO VIEW SALON PROFILE', 86, 126);

  const logoX = 86;
  const logoY = 190;
  const logoSize = 142;
  if (salon.image) {
    const logo = await loadCardImage(salon.image);
    context.save();
    roundCanvasRect(context, logoX, logoY, logoSize, logoSize, 28);
    context.clip();
    const scale = Math.max(logoSize / logo.naturalWidth, logoSize / logo.naturalHeight);
    const drawnWidth = logo.naturalWidth * scale;
    const drawnHeight = logo.naturalHeight * scale;
    context.drawImage(logo, logoX + (logoSize - drawnWidth) / 2, logoY + (logoSize - drawnHeight) / 2, drawnWidth, drawnHeight);
    context.restore();
  } else {
    const logoGradient = context.createLinearGradient(logoX, logoY, logoX + logoSize, logoY + logoSize);
    logoGradient.addColorStop(0, '#dc4d83');
    logoGradient.addColorStop(1, '#7555c7');
    context.fillStyle = logoGradient;
    roundCanvasRect(context, logoX, logoY, logoSize, logoSize, 28);
    context.fill();
    context.fillStyle = '#fff';
    context.font = '800 66px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(salon.name || 'S').trim().charAt(0).toUpperCase(), logoX + logoSize / 2, logoY + logoSize / 2);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
  }

  const textX = 270;
  const textWidth = 445;
  let nameFontSize = 54;
  context.font = `800 ${nameFontSize}px Arial, sans-serif`;
  while (context.measureText(salon.name).width > textWidth && nameFontSize > 34) {
    nameFontSize -= 2;
    context.font = `800 ${nameFontSize}px Arial, sans-serif`;
  }
  context.fillStyle = '#2c1e30';
  context.textBaseline = 'alphabetic';
  context.fillText(salon.name || 'Salon', textX, 242, textWidth);

  context.fillStyle = '#a34577';
  context.font = '700 22px Arial, sans-serif';
  context.fillText('AREA', textX, 300);
  context.fillStyle = '#514857';
  context.font = '500 25px Arial, sans-serif';
  const areaLines = [salon.address, salon.city].filter(Boolean);
  areaLines.slice(0, 2).forEach((line, index) => context.fillText(line, textX, 342 + index * 36, textWidth));
  if (salon.pinCode) {
    context.fillStyle = '#a34577';
    context.font = '700 22px Arial, sans-serif';
    context.fillText('PIN CODE', textX, 440);
    context.fillStyle = '#514857';
    context.font = '600 25px Arial, sans-serif';
    context.fillText(String(salon.pinCode), textX, 477);
  }
  if (salon.phone) {
    context.fillStyle = '#a34577';
    context.font = '700 22px Arial, sans-serif';
    context.fillText('CALL', textX, 535);
    context.fillStyle = '#514857';
    context.font = '600 25px Arial, sans-serif';
    context.fillText(String(salon.phone), textX, 572, textWidth);
  }

  const qrDataUrl = await QRCode.toDataURL(getSalonProfileUrl(salon.id), {
    width: 360,
    margin: 3,
    errorCorrectionLevel: 'H',
    color: { dark: '#321f37', light: '#ffffff' },
  });
  const qrImage = await loadCardImage(qrDataUrl);
  const qrX = 790;
  const qrY = 154;
  const qrSize = 330;
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(57, 34, 64, .16)';
  context.shadowBlur = 24;
  context.shadowOffsetY = 8;
  roundCanvasRect(context, qrX - 18, qrY - 18, qrSize + 36, qrSize + 36, 24);
  context.fill();
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
  context.fillStyle = '#75406e';
  context.font = '800 20px Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText('SCAN TO OPEN THIS SALON', qrX + qrSize / 2, 552);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The visiting card image could not be downloaded.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function SalonVisitingCardButton({ salon }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const download = async (event) => {
    event.stopPropagation();
    setDownloading(true);
    setError('');
    try {
      const blob = await createSalonVisitingCard(salon);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${String(salon.name || 'salon').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-visiting-card.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      setError(downloadError.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="salon-visiting-card-action">
      <button className="salon-visiting-card-button" type="button" onClick={download} disabled={downloading} aria-label={`Download ${salon.name} visiting card`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4" /></svg>
        {downloading ? 'Preparing card…' : 'Download visiting card'}
      </button>
      {error && <span className="salon-visiting-card-error" role="alert">{error}</span>}
    </div>
  );
}

async function resizeProfileImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.82);
    if (result.length > 1_200_000) throw new Error('This image is too large. Choose a smaller image.');
    return result;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function resizeSalonImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.78);
    if (result.length > 400_000) throw new Error('This image is too large after compression. Choose another image.');
    return result;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

const toLocalDateTimeInput = (date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};
const announcementDurations = {
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

function AnnouncementManager({ onChanged }) {
  const [announcements, setAnnouncements] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [audience, setAudience] = useState('both');
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState('10m');
  const [startsAt, setStartsAt] = useState(() => toLocalDateTimeInput(new Date()));
  const [expiresAt, setExpiresAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + announcementDurations['10m'])));
  const [editingId, setEditingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAnnouncements = async () => {
    setError('');
    try {
      const result = await api('/api/admin/announcements');
      if (!Array.isArray(result.announcements)) throw new Error('The server returned an invalid announcement list.');
      setAnnouncements(result.announcements);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnnouncements();
    const timer = window.setInterval(loadAnnouncements, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const resetForm = () => {
    const now = new Date();
    setEditingId('');
    setAudience('both');
    setMessage('');
    setDuration('10m');
    setStartsAt(toLocalDateTimeInput(now));
    setExpiresAt(toLocalDateTimeInput(new Date(now.getTime() + announcementDurations['10m'])));
    setFormOpen(false);
  };

  const changeDuration = (nextDuration) => {
    setDuration(nextDuration);
    if (nextDuration !== 'custom') {
      const start = new Date();
      setStartsAt(toLocalDateTimeInput(start));
      setExpiresAt(toLocalDateTimeInput(new Date(start.getTime() + announcementDurations[nextDuration])));
    }
  };

  const editAnnouncement = (announcement) => {
    setFormOpen(true);
    setEditingId(announcement.id);
    setAudience(announcement.audience);
    setMessage(announcement.message);
    setDuration('custom');
    setStartsAt(toLocalDateTimeInput(new Date(announcement.startsAt)));
    setExpiresAt(toLocalDateTimeInput(new Date(announcement.expiresAt)));
    setError('');
    setNotice('');
    window.requestAnimationFrame(() => document.getElementById('admin-announcement-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const saveAnnouncement = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const start = duration === 'custom' ? new Date(startsAt) : new Date();
    const end = duration === 'custom'
      ? new Date(expiresAt)
      : new Date(start.getTime() + announcementDurations[duration]);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setError('Choose valid announcement start and end times.');
      return;
    }
    if (end <= start) {
      setError('The end time must be after the start time.');
      return;
    }
    if (end <= new Date()) {
      setError('The end time must be in the future.');
      return;
    }
    setSaving(true);
    try {
      const result = await api(editingId ? `/api/admin/announcements/${editingId}` : '/api/admin/announcements', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({ audience, message, startsAt: start.toISOString(), expiresAt: end.toISOString() }),
      });
      setNotice(result.message || (editingId ? 'Announcement updated.' : 'Announcement published.'));
      resetForm();
      await Promise.all([loadAnnouncements(), onChanged()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (announcementId) => {
    setError('');
    try {
      const result = await api(`/api/admin/announcements/${announcementId}`, { method: 'DELETE' });
      setNotice(result.message);
      setDeletingId('');
      if (editingId === announcementId) resetForm();
      await Promise.all([loadAnnouncements(), onChanged()]);
    } catch (requestError) {
      setError(requestError.message);
      setDeletingId('');
    }
  };

  return (
    <section className="admin-announcement-manager panel-box">
      {!formOpen && <button className="button button-primary admin-announcement-open-form" type="button" onClick={() => {
        resetForm();
        setFormOpen(true);
      }}>＋ Publish a general message</button>}
      {formOpen && <form className="admin-announcement-form" id="admin-announcement-form" onSubmit={saveAnnouncement}>
        <label>Show to
          <select value={audience} onChange={(event) => setAudience(event.target.value)}>
            <option value="customers">Customers</option>
            <option value="salon_owners">Salon owners</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label>Message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={4} required placeholder="Write the general message…" />
        </label>
        <label>Show duration
          <select value={duration} onChange={(event) => changeDuration(event.target.value)}>
            <option value="5m">5 minutes</option>
            <option value="10m">10 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
            <option value="1d">1 day</option>
            <option value="1w">1 week</option>
            <option value="custom">Choose start and end time</option>
          </select>
        </label>
        {duration === 'custom' ? (
          <div className="admin-announcement-datetime">
            <label>Starts at<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label>Ends at<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></label>
          </div>
        ) : (
          <p className="fine-print admin-announcement-expiry">Starts immediately · Ends {new Date(expiresAt).toLocaleString()}</p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="profile-success" role="status">{notice}</p>}
        <div className="admin-announcement-form-actions">
          <button className="button button-primary" type="submit" disabled={saving || !message.trim()}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Publish message'}</button>
          {editingId && <button className="button button-soft" type="button" onClick={resetForm} disabled={saving}>Cancel edit</button>}
          {!editingId && <button className="button button-soft" type="button" onClick={resetForm} disabled={saving}>Cancel</button>}
        </div>
      </form>}

      <div className="admin-announcement-list">
        <h3>Scheduled and published messages</h3>
        {loading && <p className="muted">Loading messages…</p>}
        {!loading && !announcements.length && <p className="muted">No scheduled or active messages.</p>}
        {announcements.map((announcement) => {
          const isLive = new Date(announcement.startsAt) <= new Date();
          return (
            <article className="admin-announcement-card" key={announcement.id}>
              <div className="admin-announcement-card-copy">
                <div className="admin-announcement-card-meta">
                  <span className={`status-pill ${isLive ? 'status-completed' : 'status-waiting'}`}>{isLive ? 'Published' : 'Scheduled'}</span>
                  <span>{announcement.audience === 'both' ? 'Customers & salon owners' : announcement.audience === 'customers' ? 'Customers' : 'Salon owners'}</span>
                </div>
                <p>{announcement.message}</p>
                <small>{new Date(announcement.startsAt).toLocaleString()} – {new Date(announcement.expiresAt).toLocaleString()}</small>
              </div>
              <div className="admin-announcement-card-actions">
                {deletingId === announcement.id ? (
                  <>
                    <button className="button button-confirm-danger button-small" type="button" onClick={() => deleteAnnouncement(announcement.id)}>Confirm delete</button>
                    <button className="button button-soft button-small" type="button" onClick={() => setDeletingId('')}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="button button-soft button-small" type="button" onClick={() => editAnnouncement(announcement)}>Edit</button>
                    <button className="text-button danger-text" type="button" onClick={() => setDeletingId(announcement.id)}>Delete</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProfilePage({ user, bookings, onUserUpdated, onBack, onSignOut, onCancelBooking, onOpenUpiPayment, onAnnouncementChanged }) {
  const [name, setName] = useState(user.name || '');
  const [gender, setGender] = useState(user.gender || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : '');
  const [locationLabel, setLocationLabel] = useState(user.location?.label || '');
  const [latitude, setLatitude] = useState(user.location?.lat ?? '');
  const [longitude, setLongitude] = useState(user.location?.lng ?? '');
  const [pinCode, setPinCode] = useState(user.location?.pinCode || '');
  const [profileImage, setProfileImage] = useState(user.profileImage || '');
  const [contactPhone, setContactPhone] = useState(user.contactPhone || '');
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [historyBookings, setHistoryBookings] = useState(bookings.slice(0, LIST_PAGE_SIZE));
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const historyRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++historyRequestId.current;
    setHistoryLoading(true);
    api(`/api/bookings/my-bookings?page=1&limit=${LIST_PAGE_SIZE}`)
      .then((result) => {
        if (requestId !== historyRequestId.current) return;
        if (!Array.isArray(result.bookings)) throw new Error('The server returned an invalid booking history.');
        setHistoryBookings(result.bookings);
        setHistoryPage(1);
        setHistoryPages(result.pages || 1);
        setProfileError('');
      })
      .catch((requestError) => {
        if (requestId === historyRequestId.current) setProfileError(requestError.message);
      })
      .finally(() => {
        if (requestId === historyRequestId.current) setHistoryLoading(false);
      });
    return () => { historyRequestId.current += 1; };
  }, [user.id]);

  useEffect(() => {
    setHistoryBookings((current) => current.map((booking) =>
      bookings.find((item) => item.id === booking.id) || booking
    ));
  }, [bookings]);

  const loadMoreHistory = async () => {
    if (historyLoadingMore || historyPage >= historyPages) return;
    const nextPage = historyPage + 1;
    setHistoryLoadingMore(true);
    try {
      const result = await api(`/api/bookings/my-bookings?page=${nextPage}&limit=${LIST_PAGE_SIZE}`);
      if (!Array.isArray(result.bookings)) throw new Error('The server returned an invalid booking history.');
      setHistoryBookings((current) => [
        ...current,
        ...result.bookings.filter((booking) => !current.some((item) => item.id === booking.id)),
      ]);
      setHistoryPage(result.page || nextPage);
      setHistoryPages(result.pages || 1);
    } catch (requestError) {
      setProfileError(requestError.message);
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const chooseImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProfileError('');
    try {
      setProfileImage(await resizeProfileImage(file));
    } catch (error) {
      setProfileError(error.message);
    } finally {
      event.target.value = '';
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const hasLocation = locationLabel.trim() || latitude !== '' || longitude !== '' || pinCode.trim();
      let location = null;
      if (hasLocation) {
        location = {
          label: locationLabel.trim(),
          pinCode: pinCode.trim(),
          ...(latitude !== '' && longitude !== '' ? { lat: Number(latitude), lng: Number(longitude) } : {}),
        };
      }
      const result = await api('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          contactPhone,
          gender,
          dateOfBirth,
          location,
          profileImage: profileImage || null,
        }),
      });
      onUserUpdated(result.user);
      setProfileMessage('Your profile has been saved.');
    } catch (error) {
      setProfileError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="profile-page">
      <div className="account-profile-header">
        <button className="text-button profile-back back-navigation" onClick={onBack} aria-label="Back to salons" title="Back to salons"><svg className="back-navigation-icon" viewBox="0 0 32 24" aria-hidden="true"><path d="M13 3 3 12l10 9M4 12h25" /></svg></button>
        <div className="profile-page-heading">
          <div><h1>Your profile</h1></div>
        </div>
        <button className="button button-soft profile-signout" onClick={onSignOut}>Sign out</button>
      </div>

      {user.role === 'admin' && <AnnouncementManager onChanged={onAnnouncementChanged} />}

      <form className="profile-details panel-box" onSubmit={saveProfile}>
        <div className="profile-photo-row">
          <div className="profile-photo profile-photo-large">
            {profileImage ? <img src={profileImage} alt={`${name || 'Your'} profile`} /> : <span>{getInitials(name)}</span>}
          </div>
          <div className="profile-photo-actions">
            <strong>Profile photo</strong>
            <small>Your photo is shown as a circle. Square and rectangular images both work.</small>
            <div className="profile-photo-buttons">
              <label className="button button-soft upload-photo">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} /></label>
              {profileImage && <button className="text-button danger-text" type="button" onClick={() => setProfileImage('')}>Remove photo</button>}
            </div>
          </div>
        </div>

        <div className="profile-form-grid">
          <label>Full name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
          <label>Mobile number (optional)<input type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="+91 98765 43210" maxLength={24} required /><small className="profile-field-hint">Required so the salon can contact you about your booking. No OTP verification needed.</small></label>
          <label>Gender (optional)<select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">(Select)</option><option value="Male">Male</option><option value="Female">Female</option><option value="Others">Others</option></select></label>
          <label>Date of birth<input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
          <label>Location / area<input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} maxLength={160} placeholder="Your area or address" /></label>
          <CoordinateFields
            latitude={latitude}
            longitude={longitude}
            pinCode={pinCode}
            onChange={(field, value) => {
              if (field === 'lat') setLatitude(value);
              else if (field === 'lng') setLongitude(value);
              else setPinCode(value);
            }}
            onError={setProfileError}
            required={false}
          />
        </div>

        <div className="profile-contact-details">
          <div><span>Email</span><strong>{user.email || 'Not added'}</strong></div>
          <div><span>Verified sign-in phone</span><strong>{user.phone || 'Not added'}</strong></div>
          <p>The mobile number above is saved as a contact number for salons and is not OTP-verified. Your sign-in email and phone cannot be changed here.</p>
        </div>
        {profileError && <p className="form-error" role="alert">{profileError}</p>}
        {profileMessage && <p className="profile-success" role="status">{profileMessage}</p>}
        <button className="button button-primary profile-save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>

      <section className="profile-bookings">
        <div className="section-heading"><div><span className="eyebrow">Your visits</span><h2>Order &amp; booking history</h2></div></div>
        <div className="booking-history">
          {user.walletCredits > 0 && <div className="credit-banner"><span>✦</span><p>You have <strong>{money(user.walletCredits)}</strong> in SalonFlow credits. These credits remain in your account; UPI reservation advances are paid separately.</p></div>}
          {!historyLoading && !historyBookings.length && <div className="panel-box profile-empty"><h3>No bookings yet</h3><p className="muted">Your salon bookings and order history will appear here.</p><button className="button button-soft" onClick={onBack}>Explore salons</button></div>}
          {historyBookings.map((booking) => (
            <article className="history-card" key={booking.id}>
              <div><span className={`status-pill status-${booking.status}`}>{bookingStatusLabel(booking.status)}</span><h3>{booking.salonId?.name || booking.salonSnapshot?.name || 'Salon visit'}</h3><p>{booking.services.map((service) => service.name).join(' · ')}</p>{booking.userUid && <p className="queue-position">Your UID: {booking.userUid}</p>}{booking.status === 'waiting' && booking.appointmentDate > getLocalDateString() && <p className="queue-position">Reserved for {formatAppointmentDate(booking.appointmentDate)}</p>}{booking.status === 'waiting' && (booking.appointmentDate || getLocalDateString()) <= getLocalDateString() && booking.queuePosition && <p className="queue-position">Queue #{booking.queuePosition} · about {formatWaitDuration(booking.estimatedWaitMinutes)}</p>}{booking.status === 'in_service' && <p className="queue-position">Your service is in progress</p>}{booking.status === 'rejected' && booking.rejectionReason && <p className="rejection-reason-display">Reason: {booking.rejectionReason}</p>}</div>
              <div className="history-meta"><strong>{booking.status === 'cancelled' ? `${money(booking.paymentAmount)} advance payment cancelled` : booking.paymentStatus === 'paid' ? `${money(booking.paymentAmount)} advance payment paid` : `${money(booking.paymentAmount)} advance payment pending`}</strong>{booking.paymentMethod === 'upi_manual' && <small>Service charge to pay at salon: {money(booking.total)}</small>}{booking.paymentMethod === 'upi_manual' && booking.upiReference && booking.paymentStatus === 'pending' && <small>UPI reference submitted: {booking.upiReference} · Awaiting verification</small>}{booking.paymentMethod !== 'upi_manual' && booking.paymentMode === 'token' && <small>{money(Math.max(0, booking.total - booking.paymentAmount))} balance at salon</small>}{booking.appointmentDate && <small>Appointment: {formatAppointmentDate(booking.appointmentDate)}</small>}<small>Booked: {new Date(booking.createdAt).toLocaleString()}</small>{booking.status === 'pending_payment' && booking.paymentMethod === 'upi_manual' && !booking.upiReference && booking.upiPayment && <button className="button button-soft button-small" onClick={() => onOpenUpiPayment(booking, booking.upiPayment)}>Pay ₹{booking.paymentAmount} advance</button>}{['waiting', 'pending_payment'].includes(booking.status) && !(booking.paymentMethod === 'upi_manual' && booking.upiReference && booking.paymentStatus === 'pending') && <button className="text-button danger-text" onClick={() => onCancelBooking(booking.id)}>Cancel booking</button>}</div>
            </article>
          ))}
          {historyLoading && <p className="muted">Loading booking history…</p>}
          {historyPage < historyPages && <div className="load-more-row"><button className="button button-soft button-small" type="button" onClick={loadMoreHistory} disabled={historyLoadingMore}>{historyLoadingMore ? 'Loading…' : 'Load 10 more'}</button></div>}
        </div>
      </section>
    </section>
  );
}

function UpiPaymentDialog({ booking, payment, onClose, onSubmitReference }) {
  const [qrCode, setQrCode] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submittedReference = booking.upiReference || '';

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(payment.upiUrl, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => { if (active) setQrCode(dataUrl); })
      .catch((qrError) => { if (active) setError(`Could not create the payment QR code: ${qrError.message}`); });
    return () => { active = false; };
  }, [payment.upiUrl]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSubmitReference(booking.id, reference);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop upi-payment-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="auth-dialog upi-dialog" role="dialog" aria-modal="true" aria-labelledby="upi-payment-title">
        <button className="icon-button dialog-close close-control" onClick={onClose} aria-label="Close payment dialog">×</button>
        <span className="eyebrow">UPI advance</span>
        <h2 id="upi-payment-title">{booking.priority === 'express' ? 'Express booking' : 'Standard booking'}</h2>
        <div className="upi-payment-summary">
          <div><span>Services (pay at salon)</span><strong>{money(booking.total)}</strong></div>
          <div><span>{booking.priority === 'express' ? 'Express advance (pay now)' : 'Reservation advance (pay now)'}</span><strong>{money(payment.amount)}</strong></div>
          <div className="upi-payment-total"><span>Total booking cost</span><strong>{money(booking.total + payment.amount)}</strong></div>
        </div>
        <p className="muted">The advance payment is non-refundable. Pay the service amount directly to the salon after your visit.</p>
        <p className="upi-payee"><strong>Pay to:</strong> {payment.payeeName}<br /><strong>Reference:</strong> {payment.reference}</p>
        <a className="button button-primary full-width upi-open-button" href={payment.upiUrl}>Open a UPI app and pay {money(payment.amount)}</a>
        <div className="upi-qr-panel"><span className="fine-print">Or scan this QR code from your UPI app</span>{qrCode ? <img src={qrCode} alt="UPI payment QR code" /> : <span className="qr-preparing" role="status"><span className="payment-loader-spinner" aria-hidden="true" />Preparing QR code…</span>}</div>
        {submittedReference ? (
          <div className="alert" role="status">Reference {submittedReference} submitted. Your booking stays pending until an administrator verifies the credit in the bank account. Do not assume the payment is confirmed yet.</div>
        ) : (
          <form className="upi-reference-form" onSubmit={submit}>
            <label>After paying, enter the 12-digit UPI reference number<input value={reference} onChange={(event) => setReference(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" autoComplete="off" pattern="\d{12}" maxLength={12} placeholder="12-digit UPI reference" required /></label>
            <p className="fine-print">Entering a reference does not verify payment. The booking will enter the queue only after the admin checks the actual bank transaction.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary full-width" type="submit" disabled={saving || reference.length !== 12}>{saving ? 'Submitting reference…' : 'Submit reference for verification'}</button>
          </form>
        )}
      </section>
    </div>
  );
}

function OrdersHistoryPage({ user, onBack }) {
  const [bookings, setBookings] = useState([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [salon, setSalon] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    if (page === 1) {
      setBookings([]);
    }
    setError('');
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIST_PAGE_SIZE),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (fromTime) params.set('fromTime', fromTime);
      if (toTime) params.set('toTime', toTime);
      if (salon.trim()) params.set('salon', salon.trim());
      if (status) params.set('status', status);
      try {
        const result = await api(`/api/bookings/history?${params.toString()}`);
        if (requestId !== requestIdRef.current) return;
        if (!Array.isArray(result.bookings)) throw new Error('The server returned an invalid booking history.');
        setBookings((current) => page === 1
          ? result.bookings
          : [...current, ...result.bookings.filter((booking) => !current.some((item) => (item._id || item.id) === (booking._id || booking.id)))]);
        setPages(result.pages || 1);
      } catch (requestError) {
        if (requestId === requestIdRef.current) {
          if (page === 1) setBookings([]);
          setError(requestError.message);
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [fromDate, toDate, fromTime, toTime, salon, status, page]);

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setFromTime('');
    setToTime('');
    setSalon('');
    setStatus('');
    setPage(1);
  };
  const changeFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  return (
    <section className="orders-history-page">
      <div className="orders-history-heading-row">
        <BackArrowButton onClick={onBack} className="section-back-navigation" />
        <div className="orders-history-title">
          <h1>Orders &amp; history</h1>
          <p className="muted">
            {user.role === 'admin'
              ? 'All salons and customer bookings, newest first.'
              : user.role === 'owner'
                ? 'Bookings for your salons, newest first.'
                : 'Your salon bookings, newest first.'}
          </p>
        </div>
        <span aria-hidden="true" />
      </div>

      <div className="panel-box orders-history-filters" aria-label="Filter booking history">
        {user.role !== 'owner' && <label>Salon name<input value={salon} onChange={changeFilter(setSalon)} placeholder="Search salon name" /></label>}
        <label>Booked from<input type="date" value={fromDate} max={toDate || undefined} onChange={changeFilter(setFromDate)} /></label>
        <label>Booked to<input type="date" value={toDate} min={fromDate || undefined} onChange={changeFilter(setToDate)} /></label>
        <label>From time<input type="time" value={fromTime} onChange={changeFilter(setFromTime)} /></label>
        <label>To time<input type="time" value={toTime} onChange={changeFilter(setToTime)} /></label>
        <label>Status<select value={status} onChange={changeFilter(setStatus)}><option value="">All statuses</option><option value="pending_payment">Pending payment</option><option value="waiting">Waiting</option><option value="in_service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="rejected">Rejected</option></select></label>
        <button className="button button-soft button-small" onClick={clearFilters} disabled={!salon && !fromDate && !toDate && !fromTime && !toTime && !status}>Clear filters</button>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}
      {loading && <p className="muted orders-history-message">Loading booking history…</p>}
      {!loading && !error && !bookings.length && <div className="panel-box profile-empty"><h3>No matching orders</h3><p className="muted">Try changing or clearing the filters.</p></div>}
      <div className="orders-history-list">
        {bookings.map((booking) => {
          const salonName = booking.salonId?.name || booking.salonSnapshot?.name || 'Salon';
          const customer = booking.userId;
          const salonOwner = booking.salonId?.ownerId;
          return (
            <article className="panel-box orders-history-card" key={booking._id || booking.id}>
              <div className="orders-history-card-heading">
                <div>
                  <span className={`status-pill status-${booking.status || 'unknown'}`}>{bookingStatusLabel(booking.status)}</span>
                  <h2>{salonName}</h2>
                  <p>{booking.services?.map((service) => `${service.name}${Number.isFinite(service.price) ? ` (${money(service.price)})` : ''}`).join(' · ') || 'Services not recorded'}</p>
                  {(booking.salonId?.city || booking.salonId?.address || booking.salonSnapshot?.city || booking.salonSnapshot?.address) && <p>{[booking.salonId?.address || booking.salonSnapshot?.address, booking.salonId?.city || booking.salonSnapshot?.city].filter(Boolean).join(', ')}</p>}
                </div>
                <strong>{money(booking.total + (booking.expressFee || 0))}</strong>
              </div>
              <div className="orders-history-details">
                <div><span>Booked</span><strong>{new Date(booking.createdAt).toLocaleString()}</strong></div>
                {booking.appointmentDate && <div><span>Appointment</span><strong>{formatAppointmentDate(booking.appointmentDate)}</strong></div>}
                <div><span>Booking type</span><strong>{booking.priority === 'express' ? 'Express' : 'Standard'}</strong></div>
                <div><span>Advance payment</span><strong>{money(booking.paymentAmount)} · {paymentStatusLabel(booking.paymentStatus, booking.status)}</strong></div>
                <div><span>Service total</span><strong>{money(booking.total)}</strong></div>
                {booking.expressFee > 0 && <div><span>Express fee</span><strong>{money(booking.expressFee)}</strong></div>}
                <div><span>Payment method</span><strong>{booking.paymentMethod === 'upi_manual' ? 'UPI' : booking.paymentMethod || 'Not recorded'}</strong></div>
                {booking.estimatedWaitMinutes > 0 && <div><span>Estimated wait</span><strong>{formatWaitDuration(booking.estimatedWaitMinutes)}</strong></div>}
                {booking.userUid && <div><span>Your UID</span><strong>{booking.userUid}</strong></div>}
                {booking.ownerUid && <div><span>Your owner UID</span><strong>{booking.ownerUid}</strong></div>}
                {!['user', 'customer'].includes(user.role) && customer && <div><span>Customer</span><strong>{customer.name || 'Customer'}{customer.uid ? ` · ${customer.uid}` : ''}{customer.contactPhone ? ` · ${customer.contactPhone}` : ''}</strong></div>}
                {user.role === 'admin' && salonOwner && <div><span>Salon owner</span><strong>{salonOwner.name || 'Owner'}{salonOwner.uid ? ` · ${salonOwner.uid}` : ''}</strong></div>}
                {booking.upiReference && <div><span>UPI reference</span><strong>{booking.upiReference}</strong></div>}
                {booking.rejectionReason && <div><span>Rejection reason</span><strong>{booking.rejectionReason}</strong></div>}
                {booking.rejectionFeedback && <div><span>Your feedback</span><strong>{booking.rejectionFeedback}</strong></div>}
              </div>
            </article>
          );
        })}
      </div>

      <div className="orders-history-pagination">
        {page < pages && <button className="button button-soft button-small" disabled={loading} onClick={() => setPage((current) => current + 1)}>{loading ? 'Loading…' : 'Load 10 more'}</button>}
      </div>
    </section>
  );
}

const emptyService = () => ({ name: '', category: '', price: '', durationMinutes: '30' });
const emptySalonDraft = () => ({
  name: '',
  city: '',
  address: '',
  phone: '',
  lat: '',
  lng: '',
  pinCode: '',
  image: '',
  images: [],
  services: [emptyService()],
});
const salonToDraft = (salon) => ({
  name: salon.name || '',
  city: salon.city || '',
  address: salon.address || '',
  phone: salon.phone || '',
  lat: String(salon.lat ?? ''),
  lng: String(salon.lng ?? ''),
  pinCode: salon.pinCode || '',
  image: salon.image || '',
  images: salon.images || [],
  services: (salon.services || []).map((service) => ({
    _id: service._id,
    name: service.name || '',
    category: service.category || '',
    price: String(service.price ?? ''),
    durationMinutes: String(service.durationMinutes ?? 30),
  })),
});

function SalonProfilePage({ salons, loaded, onRefresh, onSalonChanged, onBack, onSignOut }) {
  const [selectedId, setSelectedId] = useState(salons[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptySalonDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openStatusUpdating, setOpenStatusUpdating] = useState(false);
  const [openStatusTarget, setOpenStatusTarget] = useState(null);

  const selectedSalon = salons.find((salon) => salon.id === selectedId);
  const serviceList = useLoadMore(draft.services, `${creating}:${selectedId}`);

  useEffect(() => {
    if (!salons.some((salon) => salon.id === selectedId)) {
      setSelectedId(salons[0]?.id || '');
    }
  }, [salons, selectedId]);

  useEffect(() => {
    setDraft(creating ? emptySalonDraft() : selectedSalon ? salonToDraft(selectedSalon) : emptySalonDraft());
    setError('');
    setMessage('');
  }, [creating, selectedId, selectedSalon]);

  const updateField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const uploadSalonLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const image = await resizeSalonImage(file);
      const totalSize = [image, ...(draft.images || [])].reduce((total, photo) => total + (photo?.length || 0), 0);
      if (totalSize > 1_400_000) throw new Error('The combined image size is too large. Remove a photo or choose a smaller logo.');
      updateField('image', image);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      event.target.value = '';
    }
  };
  const uploadSalonPhotos = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setError('');
    try {
      const newImages = await Promise.all(files.map(resizeSalonImage));
      const images = [...(draft.images || []), ...newImages];
      if (images.length > 5) throw new Error('You can upload up to 5 salon photos.');
      const totalSize = [draft.image, ...images].reduce((total, image) => total + (image?.length || 0), 0);
      if (totalSize > 1_400_000) throw new Error('The combined image size is too large. Remove a photo or choose smaller images.');
      setDraft((current) => ({ ...current, images }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      event.target.value = '';
    }
  };
  const removeSalonPhoto = (index) => setDraft((current) => ({
    ...current,
    images: (current.images || []).filter((_, imageIndex) => imageIndex !== index),
  }));
  const removeSalonLogo = () => updateField('image', '');
  const updateService = (index, field, value) => setDraft((current) => ({
    ...current,
    services: current.services.map((service, serviceIndex) =>
      serviceIndex === index ? { ...service, [field]: value } : service
    ),
  }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    const body = {
      ...draft,
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      services: draft.services.map((service) => ({
        ...(service._id ? { _id: service._id } : {}),
        name: service.name.trim(),
        category: service.category.trim(),
        price: Number(service.price),
        durationMinutes: Number(service.durationMinutes),
      })),
      images: draft.images || [],
    };

    try {
      const result = creating
        ? await api('/api/salons', { method: 'POST', body: JSON.stringify(body) })
        : await api(`/api/salons/mine/${selectedId}`, { method: 'PATCH', body: JSON.stringify(body) });
      await onRefresh();
      await onSalonChanged();
      setCreating(false);
      if (result.salon?.id) setSelectedId(result.salon.id);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const changeOpenStatus = async (isOpen) => {
    if (!selectedSalon || openStatusUpdating) return;
    setOpenStatusUpdating(true);
    setOpenStatusTarget(isOpen);
    setError('');
    try {
      const result = await api(`/api/salons/mine/${selectedSalon.id}/open`, {
        method: 'PATCH',
        body: JSON.stringify({ isOpen }),
      });
      await onRefresh();
      await onSalonChanged();
      setMessage(result.message || `Salon marked ${isOpen ? 'open' : 'closed'}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setOpenStatusUpdating(false);
      setOpenStatusTarget(null);
    }
  };

  const startCreating = () => {
    setCreating(true);
    setMessage('');
    setError('');
  };

  return (
    <section className="profile-page salon-profile-page">
      <div className="salon-profile-header">
        <button className="text-button profile-back back-navigation" onClick={onBack} aria-label="Back to salons" title="Back to salons"><svg className="back-navigation-icon" viewBox="0 0 32 24" aria-hidden="true"><path d="M13 3 3 12l10 9M4 12h25" /></svg></button>
        <div className="profile-page-heading">
          <div><h1>{creating || !selectedSalon ? 'Create your salon profile' : selectedSalon.name}</h1></div>
        </div>
        <button className="button button-soft profile-signout" onClick={onSignOut}>Sign out</button>
      </div>

      {!loaded ? <div className="panel-box profile-empty"><p className="muted">Loading your salons…</p></div> : (
        <>
          <div className="salon-profile-toolbar">
            {salons.length > 0 && !creating && <label>Salon<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMessage(''); setError(''); }}>{salons.map((salon) => <option key={salon.id} value={salon.id}>{salon.name}</option>)}</select></label>}
            <button type="button" className="button button-soft" onClick={startCreating}>+ Add a salon</button>
          </div>

          {!creating && selectedSalon && (
            <div className="salon-profile-status panel-box">
              <div><span className="eyebrow">Salon status</span><strong>{selectedSalon.isApproved ? 'Approved and listed' : 'Awaiting admin approval'}</strong></div>
              <label className={`salon-status-toggle ${selectedSalon.isOpen ? 'is-open' : 'is-closed'} ${openStatusUpdating ? 'is-updating' : ''}`} title={selectedSalon.isApproved ? 'Toggle salon open status' : 'Salon must be approved before opening'} aria-busy={openStatusUpdating}>
                <input type="checkbox" role="switch" aria-label="Salon open status" disabled={!selectedSalon.isApproved || openStatusUpdating} checked={selectedSalon.isOpen} onChange={(event) => changeOpenStatus(event.target.checked)} />
                <span className="salon-status-track" aria-hidden="true"><span /></span>
                <strong>{openStatusUpdating ? <><span className="salon-status-spinner" aria-hidden="true" />Updating {openStatusTarget ? 'open' : 'closed'}…</> : selectedSalon.isOpen ? 'Open' : 'Closed'}</strong>
              </label>
            </div>
          )}

          {creating && <div className="salon-profile-toolbar"><button type="button" className="text-button back-navigation" onClick={() => setCreating(false)} aria-label="Cancel adding salon" title="Cancel adding salon"><svg className="back-navigation-icon" viewBox="0 0 32 24" aria-hidden="true"><path d="M13 3 3 12l10 9M4 12h25" /></svg></button></div>}
          {loaded && !salons.length && !creating && <div className="panel-box profile-empty"><h3>Your salon profile starts here</h3><p className="muted">Add salon details and services to submit your salon for approval.</p><button className="button button-primary" onClick={startCreating}>Create salon profile</button></div>}

          {(creating || selectedSalon) && (
            <form className="salon-profile-form panel-box" onSubmit={submit}>
              <h2>{creating ? 'Salon details' : 'Edit salon details'}</h2>
              <div className="salon-profile-fields">
                <label>Salon name<input value={draft.name} onChange={(event) => updateField('name', event.target.value)} maxLength={100} required /></label>
                <label>City<input value={draft.city} onChange={(event) => updateField('city', event.target.value)} maxLength={80} required /></label>
                <label className="salon-profile-wide">Address<input value={draft.address} onChange={(event) => updateField('address', event.target.value)} maxLength={200} required /></label>
                <label>Salon phone<input type="tel" value={draft.phone} onChange={(event) => updateField('phone', event.target.value)} maxLength={20} /></label>
                <CoordinateFields
                  latitude={draft.lat}
                  longitude={draft.lng}
                  pinCode={draft.pinCode}
                  onChange={updateField}
                  onError={setError}
                  currentLocationLabel="◎ Use my current location for the salon"
                  className="salon-profile-wide"
                />
              </div>

              <div className="salon-image-editor">
                <div className="salon-logo-editor">
                  <div className="salon-logo-preview">{draft.image ? <img src={draft.image} alt="Salon logo preview" /> : <span>{getInitials(draft.name || 'Salon')}</span>}</div>
                  <div className="salon-image-actions">
                    <strong>Salon profile logo</strong>
                    <small>This image is used as your salon’s display photo.</small>
                    <div className="profile-photo-buttons">
                      <label className="button button-soft upload-photo">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadSalonLogo} /></label>
                      {draft.image && <button className="text-button danger-text" type="button" onClick={removeSalonLogo}>Remove logo</button>}
                    </div>
                  </div>
                </div>
                <div className="salon-gallery-editor">
                  <div className="panel-title-row"><div><h3>Salon photos</h3><p className="muted">Upload up to 5 photos of your salon.</p></div><label className="button button-soft button-small upload-photo">Add photos<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={uploadSalonPhotos} disabled={(draft.images || []).length >= 5} /></label></div>
                  {(draft.images || []).length > 0 &&                   <div className="salon-gallery-previews">{draft.images.map((image, index) => <div className="salon-gallery-item" key={`${index}-${image.slice(0, 32)}`}><img src={image} alt={`Salon photo ${index + 1}`} /><button className="close-control" type="button" onClick={() => removeSalonPhoto(index)} aria-label={`Remove salon photo ${index + 1}`}>×</button></div>)}</div>}
                </div>
              </div>

              <div className="salon-services-editor">
                <div className="panel-title-row"><div><h3>Services and prices</h3><p className="muted">Add, edit, or remove services. Keep at least one service on the salon profile.</p></div><button type="button" className="button button-soft button-small" onClick={() => setDraft((current) => ({ ...current, services: [...current.services, emptyService()] }))}>+ Add service</button></div>
                {serviceList.visibleItems.map((service, index) => (
                  <div className="salon-service-edit-row" key={service._id || `new-${index}`}>
                    <label>Service<SalonServiceField id={`salon-service-name-${index}`} service={service} onChange={(value) => setDraft((current) => ({
                      ...current,
                      services: current.services.map((item, serviceIndex) => serviceIndex === index ? value : item),
                    }))} /></label>
                    <label>Price (₹)<input type="number" min="0" step="0.01" value={service.price} onChange={(event) => updateService(index, 'price', event.target.value)} required /></label>
                    <label>Duration (minutes)<input type="number" min="5" max="300" step="1" value={service.durationMinutes} onChange={(event) => updateService(index, 'durationMinutes', event.target.value)} required /></label>
                    <button type="button" className="text-button danger-text salon-service-remove" disabled={draft.services.length === 1} onClick={() => setDraft((current) => ({ ...current, services: current.services.filter((_, serviceIndex) => serviceIndex !== index) }))}>Remove</button>
                  </div>
                ))}
                <LoadMoreButton shown={serviceList.visibleItems.length} total={draft.services.length} onClick={serviceList.loadMore} label="services" />
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="profile-success" role="status">{message}</p>}
              <button className="button button-primary profile-save" type="submit" disabled={saving}>{saving ? 'Saving…' : creating ? 'Submit salon for approval' : 'Save salon profile'}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function SearchableAdminSelect({ label, value, options, placeholder, onChange, showLabel = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const sortedOptions = [...options].sort((left, right) => collator.compare(left.label, right.label));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = sortedOptions.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedSearch)
  );
  const optionList = useLoadMore(filteredOptions, `${open}:${normalizedSearch}`);
  const selectedLabel = sortedOptions.find((option) => option.value === value)?.label || placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    searchInputRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className={`admin-search-select-field ${showLabel ? '' : 'is-compact'}`}>
      {showLabel && <span>{label}</span>}
      <div className="admin-search-select" ref={containerRef}>
        <button
          type="button"
          className="admin-search-select-trigger"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`admin-options-${label.replace(/\W+/g, '-').toLowerCase()}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selectedLabel}</span><span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <div className="admin-search-select-menu" id={`admin-options-${label.replace(/\W+/g, '-').toLowerCase()}`}>
            <input
              ref={searchInputRef}
              type="search"
              className="admin-search-select-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${label.toLocaleLowerCase()}...`}
              aria-label={`Search ${label.toLocaleLowerCase()}`}
            />
            <div className="admin-search-select-options" role="listbox" aria-label={label}>
              {optionList.visibleItems.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === option.value}
                  className={value === option.value ? 'is-selected' : ''}
                  key={option.value || 'all'}
                  onClick={() => selectOption(option.value)}
                >
                  {option.label}
                </button>
              ))}
              {!filteredOptions.length && <span className="admin-search-select-empty">No matches found.</span>}
              <LoadMoreButton shown={optionList.visibleItems.length} total={filteredOptions.length} onClick={optionList.loadMore} label="options" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminManagement({ customers = [], salons = [], onChanged, onConfirm }) {
  const [section, setSection] = useState('customers');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');
  const [bookingCustomer, setBookingCustomer] = useState('');
  const [bookingSalon, setBookingSalon] = useState('');
  const [bookingFromDate, setBookingFromDate] = useState('');
  const [bookingToDate, setBookingToDate] = useState('');
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef(0);
  const createServiceList = useLoadMore(createDraft?.services || [], `create:${section}:${creating}`);
  const editServiceList = useLoadMore(draft?.services || [], `edit:${editingId}`);

  const loadRecords = useCallback(async (requestedPage = page) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(requestedPage), limit: String(LIST_PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      let endpoint = '/api/admin/management/';
      if (section === 'customers') {
        endpoint += 'customers';
        if (activeFilter) params.set('active', activeFilter);
      } else if (section === 'salons') {
        endpoint += 'salons';
        if (activeFilter === 'true' || activeFilter === 'false') params.set('active', activeFilter);
        if (activeFilter === 'pending') params.set('approved', 'false');
        if (activeFilter === 'approved') params.set('approved', 'true');
        if (activeFilter === 'open') params.set('open', 'true');
        if (activeFilter === 'closed') params.set('open', 'false');
      } else {
        endpoint += 'bookings';
        if (bookingStatus) params.set('status', bookingStatus);
        if (bookingCustomer) params.set('customerId', bookingCustomer);
        if (bookingSalon) params.set('salonId', bookingSalon);
        if (bookingFromDate) params.set('fromDate', bookingFromDate);
        if (bookingToDate) params.set('toDate', bookingToDate);
      }
      const result = await api(`${endpoint}?${params.toString()}`);
      const nextRecords = result[section];
      if (!Array.isArray(nextRecords)) {
        throw new Error('The server returned an invalid records response. Please refresh and try again.');
      }
      if (requestId !== requestIdRef.current) return;
      setRecords((current) => requestedPage === 1
        ? nextRecords
        : [...current, ...nextRecords.filter((record) => !current.some((item) => (item.id || item._id) === (record.id || record._id)))]);
      if (requestedPage === 1) setPage(1);
      setPages(result.pages || 1);
    } catch (requestError) {
      if (requestId === requestIdRef.current) {
        if (requestedPage === 1) setRecords([]);
        setError(requestError.message);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [section, search, activeFilter, bookingStatus, bookingCustomer, bookingSalon, bookingFromDate, bookingToDate, page]);

  useEffect(() => {
    const timer = window.setTimeout(loadRecords, 250);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  const switchSection = (nextSection) => {
    requestIdRef.current += 1;
    setSection(nextSection);
    setPage(1);
    setRecords([]);
    setPages(1);
    setLoading(true);
    setError('');
    setEditingId('');
    setDraft(null);
    setCreating(false);
    setMessage('');
    setBookingStatus('');
    setBookingCustomer('');
    setBookingSalon('');
    setBookingFromDate('');
    setBookingToDate('');
  };

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateCreateField = (key, value) => setCreateDraft((current) => ({ ...current, [key]: value }));
  const updateService = (index, key, value) => setDraft((current) => ({
    ...current,
    services: current.services.map((service, itemIndex) => itemIndex === index ? { ...service, [key]: value } : service),
  }));
  const announce = (result) => {
    setMessage(result.message);
    setError('');
    setEditingId('');
    setDraft(null);
    setCreating(false);
    setCreateDraft(null);
    loadRecords(1);
    onChanged();
  };

  const startCreate = () => {
    setMessage('');
    setError('');
    setCreating(true);
    setEditingId('');
    setCreateDraft(section === 'customers'
      ? { name: '', email: '', role: 'user', locationLabel: '', locationLat: '', locationLng: '', locationPinCode: '' }
      : { ownerId: customers.find((customer) => customer.role === 'owner')?.id || '', name: '', city: '', address: '', phone: '', lat: '', lng: '', pinCode: '', services: [{ name: '', category: '', price: '', durationMinutes: 30 }] });
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const endpoint = section === 'customers' ? 'customers' : 'salons';
      let body;
      if (section === 'customers') {
        const hasLocation = createDraft.locationLabel || createDraft.locationLat !== '' || createDraft.locationLng !== '' || createDraft.locationPinCode;
        body = {
          ...createDraft,
          location: hasLocation
            ? {
              label: createDraft.locationLabel,
              pinCode: createDraft.locationPinCode,
              ...(createDraft.locationLat !== '' && createDraft.locationLng !== ''
                ? { lat: Number(createDraft.locationLat), lng: Number(createDraft.locationLng) }
                : {}),
            }
            : null,
        };
        delete body.locationLabel;
        delete body.locationLat;
        delete body.locationLng;
        delete body.locationPinCode;
      } else {
        body = {
          ...createDraft,
          lat: Number(createDraft.lat),
          lng: Number(createDraft.lng),
          services: createDraft.services.map((service) => ({
            name: service.name.trim(),
            category: service.category.trim(),
            price: Number(service.price),
            durationMinutes: Number(service.durationMinutes),
          })),
        };
      }
      const result = await api(`/api/admin/management/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
      announce(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (record) => {
    setMessage('');
    setError('');
    setCreating(false);
    setEditingId(record.id || record._id);
    setDraft(section === 'customers'
      ? {
        name: record.name || '',
        email: record.email || '',
        phone: record.phone || '',
        contactPhone: record.contactPhone || '',
        role: record.role,
        gender: record.gender || '',
        dateOfBirth: record.dateOfBirth ? new Date(record.dateOfBirth).toISOString().slice(0, 10) : '',
        locationLabel: record.location?.label || '',
        locationLat: record.location?.lat ?? '',
        locationLng: record.location?.lng ?? '',
        locationPinCode: record.location?.pinCode || '',
        isActive: record.isActive,
      }
      : {
        ownerId: record.ownerId?.id || record.ownerId?._id || '',
        name: record.name,
        city: record.city,
        address: record.address,
        phone: record.phone || '',
        lat: record.lat,
        lng: record.lng,
        pinCode: record.pinCode || '',
        image: record.image || '',
        isActive: record.isActive,
        isApproved: record.isApproved,
        isOpen: record.isOpen,
        services: record.services.map((service) => ({ _id: service._id, name: service.name, category: service.category, price: service.price, durationMinutes: service.durationMinutes })),
      });
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const endpoint = section === 'customers' ? 'customers' : 'salons';
      let body = draft;
      if (section === 'customers') {
        const hasLocation = draft.locationLabel || draft.locationLat !== '' || draft.locationLng !== '' || draft.locationPinCode;
        const location = hasLocation
          ? {
            label: draft.locationLabel,
            pinCode: draft.locationPinCode,
            ...(draft.locationLat !== '' && draft.locationLng !== ''
              ? { lat: Number(draft.locationLat), lng: Number(draft.locationLng) }
              : {}),
          }
          : null;
        body = {
          ...draft,
          location,
        };
        delete body.locationLabel;
        delete body.locationLat;
        delete body.locationLng;
        delete body.locationPinCode;
      } else {
        body = {
          ...draft,
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          services: draft.services.map((service) => ({
            ...(service._id ? { _id: service._id } : {}),
            name: service.name.trim(),
            category: service.category.trim(),
            price: Number(service.price),
            durationMinutes: Number(service.durationMinutes),
          })),
        };
      }
      const result = await api(`/api/admin/management/${endpoint}/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      announce(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (record) => {
    const label = record.name;
    if (section === 'salons') {
      if (!await onConfirm({
        title: 'Delete salon profile?',
        message: `Delete the entire salon profile "${label}" permanently? Its bookings, orders, and history will be kept.`,
        confirmLabel: 'Continue',
        danger: true,
      })) return;
      if (!await onConfirm({
        title: 'Confirm permanent deletion',
        message: `Permanently remove "${label}" from the database? This cannot be undone. Existing booking and order records will remain.`,
        confirmLabel: 'Delete permanently',
        danger: true,
      })) return;
    } else if (!await onConfirm({
      title: 'Delete this account?',
      message: `Permanently delete "${label}"? This cannot be undone. Accounts with booking or ownership history cannot be deleted.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    })) return;
    const endpoint = section === 'customers' ? 'customers' : 'salons';
    try {
      const result = await api(`/api/admin/management/${endpoint}/${record.id || record._id}`, { method: 'DELETE' });
      announce(result);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const updateBookingStatus = async (booking, status) => {
    try {
      const result = await api(`/api/admin/management/bookings/${booking._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage(result.message);
      setError('');
      await loadRecords(1);
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const confirmUpiPayment = async (booking) => {
    const confirmed = await onConfirm({
      title: 'Confirm payment received?',
      message: `Confirm that ₹${booking.paymentAmount} was actually credited to the platform account for UPI reference ${booking.upiReference}. Only confirm after checking the bank transaction.`,
      confirmLabel: 'Confirm payment',
    });
    if (!confirmed) return;
    try {
      const result = await api(`/api/admin/management/bookings/${booking._id}/payment-confirmation`, {
        method: 'PATCH',
      });
      setMessage(result.message);
      setError('');
      await loadRecords(1);
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const rejectUpiPayment = async (booking) => {
    if (!await onConfirm({
      title: 'Reject payment reference?',
      message: `Reject UPI reference ${booking.upiReference} and cancel this booking? First check that the transaction is not credited to the platform account.`,
      confirmLabel: 'Reject reference',
      danger: true,
    })) return;
    try {
      const result = await api(`/api/admin/management/bookings/${booking._id}/payment-rejection`, {
        method: 'PATCH',
      });
      setMessage(result.message);
      setError('');
      await loadRecords(1);
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const addCreateService = () => setCreateDraft((current) => ({ ...current, services: [...current.services, { name: '', category: '', price: '', durationMinutes: 30 }] }));
  const updateCreateService = (index, key, value) => setCreateDraft((current) => ({
    ...current,
    services: current.services.map((service, itemIndex) => itemIndex === index ? { ...service, [key]: value } : service),
  }));

  return (
    <section className="admin-management">
      <div className="admin-management-heading"><div><span className="eyebrow">Platform records</span><h2>Manage customers, salons &amp; bookings</h2><p className="muted">Search records, edit details, block access, or manage booking queues. Passwords are never exposed; verify UPI credits against the actual bank transaction before confirming.</p></div></div>
      <div className="segmented admin-management-tabs" role="tablist">
        <button type="button" className={section === 'customers' ? 'active' : ''} onClick={() => switchSection('customers')}>Customers</button>
        <button type="button" className={section === 'salons' ? 'active' : ''} onClick={() => switchSection('salons')}>Salons &amp; services</button>
        <button type="button" className={section === 'bookings' ? 'active' : ''} onClick={() => switchSection('bookings')}>Bookings</button>
      </div>
      <div className="admin-management-filters">
        <label className="admin-record-search">Search {section === 'customers' ? 'UID, name, email, phone, or location' : section === 'salons' ? 'salon, owner UID/name/email, city, address, or service' : 'customer or salon UID, name, or service'}<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Type to search..." /></label>
        {section === 'customers' && <>
          <label>Access<select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1); }}><option value="">All</option><option value="true">Active</option><option value="false">Blocked</option></select></label>
        </>}
        {section === 'salons' && <label>Salon status<select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="true">Active</option><option value="false">Blocked</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="open">Open</option><option value="closed">Closed</option></select></label>}
        {section === 'bookings' && <>
          <label>Booking status<select value={bookingStatus} onChange={(event) => { setBookingStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="pending_payment">Pending payment</option><option value="waiting">Waiting</option><option value="in_service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="rejected">Rejected</option></select></label>
          <SearchableAdminSelect
            label="People"
            value={bookingCustomer}
            placeholder="All people"
            options={[
              { value: '', label: 'All people' },
              ...customers.map((customer) => ({
                value: customer.id,
                label: `${customer.name || 'Customer'}${customer.email ? ` · ${customer.email}` : ''}${customer.uid ? ` · ${customer.uid}` : ''}`,
              })),
            ]}
            onChange={(value) => { setBookingCustomer(value); setPage(1); }}
          />
          <SearchableAdminSelect
            label="Salon"
            value={bookingSalon}
            placeholder="All salons"
            options={[
              { value: '', label: 'All salons' },
              ...salons.map((salon) => ({
                value: salon.id,
                label: `${salon.name || 'Salon'}${salon.ownerName ? ` · ${salon.ownerName}` : ''}${salon.ownerEmail ? ` · ${salon.ownerEmail}` : ''}${salon.ownerUid ? ` · ${salon.ownerUid}` : ''}`,
              })),
            ]}
            onChange={(value) => { setBookingSalon(value); setPage(1); }}
          />
          <label>Booked from<input type="date" value={bookingFromDate} max={bookingToDate || undefined} onChange={(event) => { setBookingFromDate(event.target.value); setPage(1); }} /></label>
          <label>Booked to<input type="date" value={bookingToDate} min={bookingFromDate || undefined} onChange={(event) => { setBookingToDate(event.target.value); setPage(1); }} /></label>
        </>}
        {section !== 'bookings' && <button className="button button-primary admin-create-button" onClick={startCreate}>+ Add {section === 'customers' ? 'account' : 'salon'}</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="profile-success" role="status">{message}</p>}

      {creating && (
        <form className="panel-box admin-record-editor" onSubmit={submitCreate}>
          <div className="panel-title-row"><h3>{section === 'customers' ? 'Create account' : 'Create salon'}</h3><button type="button" className="text-button" onClick={() => setCreating(false)}>Cancel</button></div>
          {section === 'customers' ? (
            <div className="admin-editor-grid">
              <label>Full name<input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required /></label>
              <label>Email<input type="email" value={createDraft.email} onChange={(event) => setCreateDraft((current) => ({ ...current, email: event.target.value }))} required /></label>
              <label>Account type<select value={createDraft.role} onChange={(event) => setCreateDraft((current) => ({ ...current, role: event.target.value }))}><option value="user">Customer</option><option value="owner">Salon owner</option></select></label>
              <label>Location / area<input value={createDraft.locationLabel} onChange={(event) => updateCreateField('locationLabel', event.target.value)} maxLength={160} /></label>
              <CoordinateFields latitude={createDraft.locationLat} longitude={createDraft.locationLng} pinCode={createDraft.locationPinCode} onChange={(field, value) => updateCreateField(field === 'lat' ? 'locationLat' : field === 'lng' ? 'locationLng' : 'locationPinCode', value)} onError={setError} required={false} />
              <p className="fine-print admin-editor-note">A random initial password is generated. The account holder must use Forgot password to set their own password.</p>
            </div>
          ) : (
            <>
              <div className="admin-editor-grid">
                <label>Salon owner<select value={createDraft.ownerId} onChange={(event) => setCreateDraft((current) => ({ ...current, ownerId: event.target.value }))} required><option value="">Choose an owner</option>{customers.filter((customer) => customer.role === 'owner').map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.email} · {owner.uid}</option>)}</select></label>
                <label>Salon name<input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
                <label>City<input value={createDraft.city} onChange={(event) => updateCreateField('city', event.target.value)} required /></label>
                <label>Address<input value={createDraft.address} onChange={(event) => updateCreateField('address', event.target.value)} required /></label>
                <CoordinateFields latitude={createDraft.lat} longitude={createDraft.lng} pinCode={createDraft.pinCode} onChange={updateCreateField} onError={setError} currentLocationLabel="◎ Use my current location for the salon" />
                <label>Phone<input value={createDraft.phone} onChange={(event) => setCreateDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
              </div>
              <div className="admin-service-editor"><div className="panel-title-row"><h4>Services</h4><button type="button" className="button button-soft button-small" onClick={addCreateService}>+ Add service</button></div>
                {createServiceList.visibleItems.map((service, index) => <div className="admin-service-row" key={index}>{[['name','Service'],['category','Category'],['price','Price'],['durationMinutes','Minutes']].map(([key,label]) => <label key={key}>{label}<input type={key === 'price' || key === 'durationMinutes' ? 'number' : 'text'} min={key === 'durationMinutes' ? 5 : 0} value={service[key]} onChange={(event) => updateCreateService(index, key, event.target.value)} required /></label>)}<button type="button" className="text-button danger-text" disabled={createDraft.services.length === 1} onClick={() => setCreateDraft((current) => ({ ...current, services: current.services.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button></div>)}
                <LoadMoreButton shown={createServiceList.visibleItems.length} total={createDraft.services.length} onClick={createServiceList.loadMore} label="services" />
              </div>
            </>
          )}
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : `Create ${section === 'customers' ? 'account' : 'salon'}`}</button>
        </form>
      )}

      {loading && <p className="muted admin-loading">Loading records…</p>}
      {!loading && !records.length && <div className="panel-box profile-empty"><p className="muted">No matching records.</p></div>}
      <div className="admin-record-list">
        {records.map((record) => {
          if (!record || typeof record !== 'object') return null;
          const recordId = record.id || record._id;
          const isEditing = editingId === recordId;
          return (
            <article className="panel-box admin-record-card" key={recordId}>
              {section === 'customers' && <>
                <div className="admin-record-summary"><div><strong>{record.name}</strong><span>UID: {record.uid || 'Pending assignment'}</span><span>{record.email || 'No email'}{record.phone ? ` · ${record.phone}` : ''}{record.contactPhone ? ` · Contact ${record.contactPhone}` : ''}</span><span>Account created: {record.createdAt ? new Date(record.createdAt).toLocaleString() : 'Unknown'}</span><span>Last updated: {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : 'Unknown'}</span></div><div className="admin-record-badges"><span className="status-pill">Customer</span><span className={`status-pill ${record.isActive ? 'status-waiting' : 'status-cancelled'}`}>{record.isActive ? 'Active' : 'Blocked'}</span></div></div>
                {isEditing ? (
                  <form className="admin-record-editor" onSubmit={submitEdit}>
                    <div className="admin-editor-grid">
                      <label>Name<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} required /></label>
                      <label>Email<input type="email" value={draft.email} onChange={(event) => updateDraft('email', event.target.value)} required /></label>
                      <label>Profile image (data URL)<input value={draft.profileImage || ''} onChange={(event) => updateDraft('profileImage', event.target.value)} /></label>
                      <label>Verified phone<input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} placeholder="+country code or blank" /></label>
                      <label>Contact phone<input value={draft.contactPhone} onChange={(event) => updateDraft('contactPhone', event.target.value)} /></label>
                      <label>Account type<select value={draft.role} onChange={(event) => updateDraft('role', event.target.value)}><option value="user">Customer</option><option value="owner">Salon owner</option></select></label>
                      <label>Gender<input value={draft.gender} onChange={(event) => updateDraft('gender', event.target.value)} /></label>
                      <label>Date of birth<input type="date" value={draft.dateOfBirth} onChange={(event) => updateDraft('dateOfBirth', event.target.value)} /></label>
                      <label>Location<input value={draft.locationLabel} onChange={(event) => updateDraft('locationLabel', event.target.value)} /></label>
                      <CoordinateFields latitude={draft.locationLat} longitude={draft.locationLng} pinCode={draft.locationPinCode} onChange={(field, value) => updateDraft(field === 'lat' ? 'locationLat' : field === 'lng' ? 'locationLng' : 'locationPinCode', value)} onError={setError} required={false} />
                      <label className="admin-check"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft('isActive', event.target.checked)} /> Account active (uncheck to block)</label>
                    </div>
                    <div className="admin-editor-actions"><button className="button button-primary button-small" disabled={saving}>Save customer</button><button type="button" className="text-button" onClick={() => { setEditingId(''); setDraft(null); }}>Cancel</button></div>
                  </form>
                ) : <div className="admin-record-actions"><button className="button button-soft button-small" onClick={() => startEdit(record)}>Edit</button><button className="button button-soft button-small" onClick={async () => { try { const result = await api(`/api/admin/management/customers/${recordId}`, { method: 'PATCH', body: JSON.stringify({ isActive: !record.isActive }) }); announce(result); } catch (requestError) { setError(requestError.message); } }}>{record.isActive ? 'Block account' : 'Unblock account'}</button><button className="text-button danger-text" onClick={() => deleteRecord(record)}>Delete</button></div>}
              </>}

              {section === 'salons' && <>
                <div className="admin-record-summary"><div><strong>{record.name}</strong><span>{record.address}, {record.city}</span><span>Owner account: {record.ownerId?.name || 'No linked owner'}{record.ownerId?.email ? ` · ${record.ownerId.email}` : ''}{record.ownerId?.uid ? ` · UID: ${record.ownerId.uid}` : ''}</span><span>Owner account created: {record.ownerId?.createdAt ? new Date(record.ownerId.createdAt).toLocaleString() : 'Unknown'} · Last updated: {record.ownerId?.updatedAt ? new Date(record.ownerId.updatedAt).toLocaleString() : 'Unknown'}</span><span>Salon account created: {record.createdAt ? new Date(record.createdAt).toLocaleString() : 'Unknown'} · Last updated: {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : 'Unknown'}</span><span>{(Array.isArray(record.services) ? record.services : []).map((service) => `${service.name} ${money(service.price)}`).join(' · ')}</span></div><div className="admin-record-badges"><span className="status-pill">{record.isApproved ? 'Approved' : 'Pending'}</span><span className={`status-pill ${record.isActive ? 'status-waiting' : 'status-cancelled'}`}>{record.isActive ? 'Active' : 'Blocked'}</span><span className="status-pill">{record.isOpen ? 'Open' : 'Closed'}</span></div></div>
                {isEditing ? (
                  <form className="admin-record-editor" onSubmit={submitEdit}>
                    <div className="admin-editor-grid">
                      <label>Name<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} required /></label>
                      <label>Salon owner<select value={draft.ownerId} onChange={(event) => updateDraft('ownerId', event.target.value)} required><option value="">Select owner</option>{customers.filter((customer) => customer.role === 'owner').map((customer) => <option value={customer.id} key={customer.id}>{customer.name}{customer.email ? ` · ${customer.email}` : ''}{customer.uid ? ` · ${customer.uid}` : ''}</option>)}</select></label>
                      <label>City<input value={draft.city} onChange={(event) => updateDraft('city', event.target.value)} required /></label>
                      <label>Address<input value={draft.address} onChange={(event) => updateDraft('address', event.target.value)} required /></label>
                      <CoordinateFields latitude={draft.lat} longitude={draft.lng} pinCode={draft.pinCode} onChange={updateDraft} onError={setError} currentLocationLabel="◎ Use my current location for the salon" />
                      <label>Phone<input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} /></label>
                      <label>Image URL<input value={draft.image} onChange={(event) => updateDraft('image', event.target.value)} /></label>
                      <label className="admin-check"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft('isActive', event.target.checked)} /> Active (uncheck to block)</label>
                      <label className="admin-check"><input type="checkbox" checked={draft.isApproved} onChange={(event) => updateDraft('isApproved', event.target.checked)} /> Approved for discovery</label>
                      <label className="admin-check"><input type="checkbox" checked={draft.isOpen} onChange={(event) => updateDraft('isOpen', event.target.checked)} /> Open for booking</label>
                    </div>
                    <div className="admin-service-editor"><div className="panel-title-row"><h4>Services &amp; prices</h4><button type="button" className="button button-soft button-small" onClick={() => setDraft((current) => ({ ...current, services: [...current.services, { name: '', category: '', price: '', durationMinutes: 30 }] }))}>+ Add service</button></div>
                      {editServiceList.visibleItems.map((service, index) => <div className="admin-service-row" key={service._id || `new-${index}`}>{[['name','Service'],['category','Category'],['price','Price'],['durationMinutes','Minutes']].map(([key,label]) => <label key={key}>{label}<input type={key === 'price' || key === 'durationMinutes' ? 'number' : 'text'} min={key === 'durationMinutes' ? 5 : 0} value={service[key]} onChange={(event) => updateService(index, key, event.target.value)} required /></label>)}<button type="button" className="text-button danger-text" disabled={draft.services.length === 1} onClick={() => setDraft((current) => ({ ...current, services: current.services.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button></div>)}
                      <LoadMoreButton shown={editServiceList.visibleItems.length} total={draft.services.length} onClick={editServiceList.loadMore} label="services" />
                    </div>
                    <div className="admin-editor-actions"><button className="button button-primary button-small" disabled={saving}>Save salon</button><button type="button" className="text-button" onClick={() => { setEditingId(''); setDraft(null); }}>Cancel</button></div>
                  </form>
                ) : <div className="admin-record-actions"><button className="button button-soft button-small" onClick={() => startEdit(record)}>Edit</button><button className="button button-soft button-small" onClick={async () => { try { const result = await api(`/api/admin/management/salons/${recordId}`, { method: 'PATCH', body: JSON.stringify({ isActive: !record.isActive }) }); announce(result); } catch (requestError) { setError(requestError.message); } }}>{record.isActive ? 'Block salon' : 'Unblock salon'}</button><button className="text-button danger-text" onClick={() => deleteRecord(record)}>Delete</button></div>}
              </>}

              {section === 'bookings' && <>
                <div className="admin-record-summary"><div><strong>{record.userId?.name || 'Customer'} · {record.salonId?.name || record.salonSnapshot?.name || 'Salon'}</strong><span>{record.userId?.email || 'No email'}{record.userId?.uid ? ` · Customer UID: ${record.userId.uid}` : ''}{record.salonId?.ownerId?.uid ? ` · Owner UID: ${record.salonId.ownerId.uid}` : ''} · {(Array.isArray(record.services) ? record.services : []).map((service) => service.name).join(', ')}</span>{record.appointmentDate && <span>Appointment: {formatAppointmentDate(record.appointmentDate)}</span>}{record.paymentMethod === 'upi_manual' && <span>UPI advance payment: {money(record.paymentAmount)} · platform payee {record.upiPayeeName || 'not recorded'} · Ref: {record.upiReference || 'not submitted'}</span>}<span>Services payable at salon: {money(record.total)} · Booked: {new Date(record.createdAt).toLocaleString()} · {record.priority}</span></div><div className="admin-record-badges"><span className={`status-pill status-${record.status || 'unknown'}`}>{bookingStatusLabel(record.status)}</span><span className="status-pill">{paymentStatusLabel(record.paymentStatus, record.status)}</span></div></div>
                <div className="admin-record-actions"><span className="admin-booking-amount">{record.status === 'cancelled' ? `${money(record.paymentAmount)} advance payment cancelled · services ${money(record.total)}` : record.paymentStatus === 'paid' ? `${money(record.paymentAmount)} advance payment received · services ${money(record.total)}` : `${money(record.paymentAmount)} advance payment pending · services ${money(record.total)}`}</span>{record.paymentMethod === 'upi_manual' && record.status === 'pending_payment' && record.upiReference && <><button className="button button-primary button-small" onClick={() => confirmUpiPayment(record)}>Confirm bank credit</button><button className="button button-soft button-small" onClick={() => rejectUpiPayment(record)}>Reject reference</button></>}{record.status === 'waiting' && <button className="button button-primary button-small" onClick={() => updateBookingStatus(record, 'in_service')}>Start service</button>}{record.status === 'in_service' && <button className="button button-soft button-small" onClick={() => updateBookingStatus(record, 'completed')}>Complete service</button>}</div>
              </>}
            </article>
          );
        })}
      </div>
      <div className="admin-pagination">
        {page < pages && <button className="button button-soft button-small" disabled={loading} onClick={() => setPage((current) => current + 1)}>{loading ? 'Loading…' : 'Load 10 more'}</button>}
      </div>
      <p className="fine-print admin-safety-note">Passwords and payment data are never editable. Permanent deletion asks for confirmation and is blocked when historical bookings or ownership links must be retained. Blocked accounts and salons are excluded from normal access and discovery.</p>
    </section>
  );
}

async function prepareContactImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file to attach.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.45, 0.82 - attempt * 0.06));
      if (dataUrl.length <= 1_200_000) return dataUrl;
      scale *= 0.78;
    }
    throw new Error('This image is too large to attach. Choose a smaller image.');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function ContactAdminDialog({ user, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const issueType = user.role === 'owner' ? 'Salon Owner Issue' : 'Customer issue';
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      setAttachment(await prepareContactImage(file));
      setAttachmentName(file.name);
    } catch (imageError) {
      setAttachment('');
      setAttachmentName('');
      setError(imageError.message);
    }
    event.target.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          message,
          ...(attachment ? { attachment: { dataUrl: attachment } } : {}),
        }),
      });
      onSent(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop auth-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="auth-dialog contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-admin-title">
        <button className="icon-button dialog-close close-control" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog">×</button>
        <span className="eyebrow">SalonFlow support</span>
        <h2 id="contact-admin-title">Contact admin</h2>
        <p className="muted">Your message will be sent securely to the SalonFlow admin.</p>
        <form className="contact-admin-form" onSubmit={submit}>
          <label>
            Subject
            <input value={issueType} readOnly aria-readonly="true" />
          </label>
          <label>
            Your issue or feedback
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} rows={5} required disabled={busy} placeholder="Describe the issue or feedback…" />
          </label>
          <div className="contact-admin-upload">
            <label className="button button-soft button-small" htmlFor="contact-admin-image">＋ Attach screenshot or image</label>
            <input id="contact-admin-image" type="file" accept="image/*" onChange={selectImage} disabled={busy} />
            {attachmentName && <span className="fine-print" title={attachmentName}>{attachmentName}</span>}
            {attachment && <button className="text-button" type="button" disabled={busy} onClick={() => { setAttachment(''); setAttachmentName(''); }}>Remove image</button>}
          </div>
          {attachment && <img className="contact-admin-preview" src={attachment} alt="Screenshot attachment preview" />}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="contact-admin-actions">
            <button className="button button-soft" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AuthDialog({ onClose, onSignedIn, notify }) {
  const [mode, setMode] = useState('login');
  const [accountType, setAccountType] = useState('user');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const otpInputs = useRef([]);

  const contactBody = { email: contact.trim() };
  const resetVerification = () => {
    setSent(false);
    setVerified(false);
    setVerificationToken('');
    setOtpDigits(['', '', '', '', '', '']);
    setPassword('');
    setConfirmation('');
    setError('');
  };
  const switchMode = (nextMode) => {
    setMode(nextMode);
    setContact('');
    setName('');
    resetVerification();
  };

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      const purpose = mode === 'reset' ? 'reset_password' : 'register';
      const result = await api('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ ...contactBody, purpose }),
      });
      setSent(true);
      setVerified(false);
      setVerificationToken('');
      setOtpDigits(['', '', '', '', '', '']);
      notify(result.message);
      window.setTimeout(() => otpInputs.current[0]?.focus(), 0);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setError('');
    try {
      const purpose = mode === 'reset' ? 'reset_password' : 'register';
      const result = await api('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ ...contactBody, purpose, otp: otpDigits.join('') }),
      });
      setVerified(true);
      setVerificationToken(result.verificationToken);
      setError('');
      notify(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const updateOtpDigit = (index, value) => {
    const enteredDigits = value.replace(/\D/g, '');
    if (enteredDigits.length > 1) {
      const digits = Array.from({ length: 6 }, (_, digitIndex) => enteredDigits[digitIndex] || '');
      setOtpDigits(digits);
      otpInputs.current[Math.min(enteredDigits.length, 5)]?.focus();
      setError('');
      return;
    }
    const digit = enteredDigits;
    setOtpDigits((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    setError('');
    if (digit && index < 5) otpInputs.current[index + 1]?.focus();
  };

  const handleOtpPaste = (event) => {
    const pastedDigits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedDigits) return;
    event.preventDefault();
    const digits = Array.from({ length: 6 }, (_, index) => pastedDigits[index] || '');
    setOtpDigits(digits);
    otpInputs.current[Math.min(pastedDigits.length, 5)]?.focus();
  };

  const handleOtpKeyDown = (event, index) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      otpInputs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      otpInputs.current[index + 1]?.focus();
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ ...contactBody, password }),
        });
        onSignedIn(result.user);
        onClose();
        return;
      }
      if (!verified) throw new Error('Verify your contact before continuing.');
      if (password !== confirmation) throw new Error('Passwords do not match.');

      const path = mode === 'reset' ? '/api/auth/reset-password' : '/api/auth/register';
      const body = mode === 'reset'
        ? { ...contactBody, password, verificationToken }
        : { ...contactBody, name, password, accountType, verificationToken };
      const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
      onSignedIn(result.user);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop auth-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button dialog-close close-control" onClick={onClose} aria-label="Close dialog">×</button>
        <span className="eyebrow">SalonFlow account</span>
        <h2 id="auth-title">{mode === 'login' ? 'Welcome back' : mode === 'reset' ? 'Reset your password' : 'Create your account'}</h2>
        <p className="muted">Your next great salon visit starts here.</p>
        <div className="segmented auth-tabs" role="tablist">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Sign in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Create account</button>
        </div>
        <form className="stack-form" onSubmit={submit}>
          {mode === 'login' ? (
            <>
              <label>Email address
                <input type="email" autoComplete="email" placeholder="you@example.com" value={contact} onChange={(event) => setContact(event.target.value)} required />
              </label>
              <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <button type="button" className="text-button" onClick={() => switchMode('reset')}>Forgot password?</button>
            </>
          ) : !verified ? (
            <>
              <label>Email address
                <input type="email" autoComplete="email" placeholder="you@example.com" value={contact} onChange={(event) => { setContact(event.target.value); resetVerification(); }} required />
              </label>
              {!sent ? (
                <>
              <button type="button" className="button button-primary full-width" onClick={sendCode} disabled={busy || !contact.trim()}>{busy ? 'Sending…' : 'Send OTP'}</button>
                </>
              ) : (
                <>
                  <p className="otp-instruction">Enter the 6-digit code sent to {contact.trim()}.</p>
                  <div className="otp-digit-group" role="group" aria-label="6-digit verification code">
                    {otpDigits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => { otpInputs.current[index] = element; }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        aria-label={`OTP digit ${index + 1}`}
                        maxLength={1}
                        value={digit}
                        onChange={(event) => updateOtpDigit(index, event.target.value)}
                        onKeyDown={(event) => handleOtpKeyDown(event, index)}
                        onPaste={handleOtpPaste}
                        required
                      />
                    ))}
                  </div>
                  <button type="button" className="button button-primary full-width" onClick={verifyCode} disabled={busy || otpDigits.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify OTP'}</button>
                  <button type="button" className="text-button" onClick={sendCode} disabled={busy}>{busy ? 'Please wait…' : 'Resend OTP'}</button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="otp-verified" role="status">✓ Email verified: {contact.trim()}</p>
              <button type="button" className="text-button" onClick={resetVerification}>Change email</button>
              {mode === 'register' && (
                <>
                  <label>Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
                  <label>Account type<select value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="user">Customer</option><option value="owner">Salon owner</option></select></label>
                </>
              )}
              <label>{mode === 'reset' ? 'New password' : 'Password'}<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {(mode === 'login' || verified) && <button className="button button-primary full-width" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : mode === 'reset' ? 'Update password' : 'Create account'}</button>}
        </form>
        <p className="fine-print">{mode === 'login' ? 'Passwords are never sent back to your browser.' : 'Passwords are never sent back to your browser. Verification codes expire after five minutes.'}</p>
      </section>
    </div>
  );
}

function MessageComposer({ recipient, onSend, onClose }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      await onSend(message);
      setSent(true);
      setMessage('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="message-composer" onSubmit={submit}>
      <label>Message {recipient}<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={2000} required placeholder="Write your message..." /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {sent && <p className="profile-success" role="status">Message sent.</p>}
      <div className="message-composer-actions"><button className="button button-primary button-small" type="submit" disabled={sending || !message.trim()}>{sending ? 'Sending…' : 'Send message'}</button><button className="text-button" type="button" onClick={onClose}>Close</button></div>
    </form>
  );
}

export function RejectionFeedbackPage() {
  const token = new URLSearchParams(window.location.search).get('rejection-feedback') || '';
  const [details, setDetails] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [customFeedback, setCustomFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This feedback link is invalid or expired.');
      setLoading(false);
      return;
    }
    api(`/api/bookings/rejection-feedback?token=${encodeURIComponent(token)}`)
      .then(setDetails)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submitFeedback = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api('/api/bookings/rejection-feedback', {
        method: 'POST',
        body: JSON.stringify({ token, feedback, customFeedback }),
      });
      setSubmitted(true);
      setDetails((current) => ({ ...current, message: result.message }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell feedback-shell">
      <header className="topbar feedback-topbar"><a className="brand" href="/"><span className="brand-mark">S</span>SalonFlow</a></header>
      <main className="feedback-main">
        <section className="panel-box rejection-feedback-card">
          <span className="eyebrow">Customer feedback</span>
          <h1>Tell us what happened</h1>
          {loading && <p className="muted">Checking your secure feedback link…</p>}
          {details && !submitted && <form className="stack-form" onSubmit={submitFeedback}>
            <p>Your booking at <strong>{details.salonName}</strong> was rejected.</p>
            <p className="feedback-rejection-reason"><strong>Salon’s reason:</strong> {details.rejectionReason}</p>
            <fieldset className="feedback-options">
              <legend>What best describes your experience?</legend>
              {details.options.map((option) => <label key={option}>
                <input type="radio" name="rejection-feedback" value={option} checked={feedback === option} onChange={() => setFeedback(option)} />
                <span>{option}</span>
              </label>)}
            </fieldset>
            <label>Additional comments (optional)<textarea value={customFeedback} onChange={(event) => setCustomFeedback(event.target.value)} maxLength={500} rows={4} placeholder="Share any details you would like the salon to know." /></label>
            {feedback === 'Other' && !customFeedback.trim() && <small className="muted">Please add a short explanation for “Other”.</small>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary" type="submit" disabled={submitting || !feedback || (feedback === 'Other' && !customFeedback.trim())}>{submitting ? 'Submitting…' : 'Submit feedback'}</button>
          </form>}
          {submitted && <p className="profile-success" role="status">{details?.message || 'Thank you. Your feedback has been saved.'}</p>}
          {!loading && error && !details && <p className="form-error" role="alert">{error}</p>}
        </section>
      </main>
    </div>
  );
}

function SalonQrDialog({ salon, onClose }) {
  const [cardUrl, setCardUrl] = useState('');
  const [cardBlob, setCardBlob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let cardObjectUrl = '';
    setCardUrl('');
    setCardBlob(null);
    setError('');
    createSalonVisitingCard(salon)
      .then((blob) => {
        if (active) {
          cardObjectUrl = URL.createObjectURL(blob);
          setCardBlob(blob);
          setCardUrl(cardObjectUrl);
        }
      })
      .catch((cardError) => {
        if (active) setError(`Could not create this salon visiting card: ${cardError.message}`);
      });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      if (cardObjectUrl) URL.revokeObjectURL(cardObjectUrl);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, salon]);

  const downloadName = `${salon.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-visiting-card.png`;
  const salonLocation = [salon.address, salon.city, salon.pinCode && `PIN ${salon.pinCode}`].filter(Boolean).join(' · ');

  return (
    <div className="dialog-backdrop salon-qr-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="auth-dialog salon-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="salon-qr-title">
        <button className="icon-button close-control salon-qr-close" type="button" onClick={onClose} aria-label="Close salon QR code">×</button>
        <span className="eyebrow">Share your salon</span>
        <h2 id="salon-qr-title">{salon.name}</h2>
        <p className="salon-qr-location">{salonLocation}</p>
        <div className="salon-qr-image-frame">
          {cardUrl ? <img className="salon-qr-visiting-card" src={cardUrl} alt={`${salon.name} visiting card with salon profile QR code`} /> : error ? <p className="form-error" role="alert">{error}</p> : <p className="muted" role="status">Creating your visiting card and QR code…</p>}
        </div>
        <p className="fine-print">Scan the QR code on the card to open this salon’s profile on SalonFlow.</p>
        <div className="salon-qr-actions">
          <button className="button button-soft" type="button" onClick={onClose}>Close</button>
          <a className={`button button-primary ${cardBlob ? '' : 'is-disabled'}`} href={cardUrl || undefined} download={downloadName} aria-disabled={!cardBlob} onClick={(event) => {
            if (!cardBlob) event.preventDefault();
          }}>↓ Download visiting card</a>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [salons, setSalons] = useState([]);
  const [salonImageIndexes, setSalonImageIndexes] = useState({});
  const [mySalonRatings, setMySalonRatings] = useState({});
  const [ratingSavingFor, setRatingSavingFor] = useState('');
  const [salonsReady, setSalonsReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [bootLoaderVisible, setBootLoaderVisible] = useState(true);
  const [selectedSalon, setSelectedSalon] = useState(null);
  const [bookingPanelOpen, setBookingPanelOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(getPageFromLocation);
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [maxWait, setMaxWait] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const locationFixRef = useRef(null);
  const [location, setLocation] = useState(() => {
    const storedFix = readStoredLocationFix();
    locationFixRef.current = storedFix;
    return storedFix ? { lat: storedFix.lat, lng: storedFix.lng } : null;
  });
  const [locationStatus, setLocationStatus] = useState(() => locationFixRef.current ? 'ready' : 'detecting');
  const [selectedServices, setSelectedServices] = useState([]);
  const [priority, setPriority] = useState('standard');
  const [appointmentDate, setAppointmentDate] = useState(() => getLocalDateString());
  const [bookings, setBookings] = useState([]);
  const [upiPayment, setUpiPayment] = useState(null);
  const [nonRefundableNoticeOpen, setNonRefundableNoticeOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationResolverRef = useRef(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReturnPage, setAuthReturnPage] = useState('profile');
  const [contactAdminOpen, setContactAdminOpen] = useState(false);
  const [announcementInfo, setAnnouncementInfo] = useState({ hasActiveAnnouncement: false, announcement: null });
  const [announcementLoadError, setAnnouncementLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [period, setPeriod] = useState('month');
  const [reportSalon, setReportSalon] = useState('');
  const [reportCustomer, setReportCustomer] = useState('');
  const [serviceCategory, setServiceCategory] = useState('');
  const [pendingSalons, setPendingSalons] = useState([]);
  const [adminSalons, setAdminSalons] = useState([]);
  const [adminCustomers, setAdminCustomers] = useState([]);
  const [ownerSalons, setOwnerSalons] = useState([]);
  const [salonOpenUpdates, setSalonOpenUpdates] = useState({});
  const [ownerSalonsLoaded, setOwnerSalonsLoaded] = useState(false);
  const [ownerSalonId, setOwnerSalonId] = useState('');
  const [queue, setQueue] = useState([]);
  const [blockedCustomers, setBlockedCustomers] = useState([]);
  const [rejectingBookingId, setRejectingBookingId] = useState('');
  const [rejectionReasonCode, setRejectionReasonCode] = useState('no_show');
  const [rejectionDetails, setRejectionDetails] = useState('');
  const [ownerBookingHistory, setOwnerBookingHistory] = useState([]);
  const [ownerAccountUid, setOwnerAccountUid] = useState('');
  const [showSalonForm, setShowSalonForm] = useState(false);
  const [messageSalonId, setMessageSalonId] = useState('');
  const [messageBookingId, setMessageBookingId] = useState('');
  const [newSalon, setNewSalon] = useState({
    name: '', city: '', address: '', phone: '', lat: '', lng: '', pinCode: '',
    serviceName: 'Hair Cut', serviceCategory: 'Haircut', servicePrice: '299', serviceDuration: '30',
  });
  const bookingWaits = useRef(new Map());
  const salonRequestIdRef = useRef(0);
  const bookingTriggerRef = useRef(null);
  const bookingCloseRef = useRef(null);
  const contactAfterAuthRef = useRef(false);
  const toastTimerRef = useRef(null);
  const requestedSalonIdRef = useRef(new URLSearchParams(window.location.search).get('salon') || '');
  const [salonQr, setSalonQr] = useState(null);

  const applyLocationFix = useCallback((position, userRequested = false) => {
    const candidate = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp || Date.now(),
    };
    const validFix = shouldAcceptLocationFix(null, candidate) &&
      candidate.timestamp <= Date.now() + 5_000 &&
      Date.now() - candidate.timestamp <= 60_000;
    if (!validFix || (!userRequested && !shouldAcceptLocationFix(locationFixRef.current, candidate))) {
      if (!locationFixRef.current) setLocationStatus('imprecise');
      return false;
    }
    locationFixRef.current = candidate;
    storeLocationFix(candidate);
    salonRequestIdRef.current += 1;
    setLocation({ lat: candidate.lat, lng: candidate.lng });
    setLocationStatus('ready');
    return true;
  }, []);

  const closeBookingPanel = useCallback(() => {
    setBookingPanelOpen(false);
    bookingTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!bookingPanelOpen) return undefined;
    if (!window.matchMedia('(max-width: 900px)').matches) {
      setBookingPanelOpen(false);
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeBookingPanel();
    };
    const handleResize = () => {
      if (!window.matchMedia('(max-width: 900px)').matches) setBookingPanelOpen(false);
    };
    document.body.style.overflow = 'hidden';
    bookingCloseRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [bookingPanelOpen, closeBookingPanel]);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3500);
  }, []);

  const refreshAnnouncement = useCallback(async () => {
    try {
      const result = await api('/api/announcements/active');
      if (typeof result?.hasActiveAnnouncement !== 'boolean') {
        throw new Error('The server returned an invalid announcement response.');
      }
      setAnnouncementInfo(result);
      setAnnouncementLoadError('');
    } catch (requestError) {
      setAnnouncementInfo({ hasActiveAnnouncement: false, announcement: null });
      setAnnouncementLoadError(requestError.message);
    }
  }, []);

  const openAdminContact = () => {
    if (!user) {
      contactAfterAuthRef.current = true;
      setAuthReturnPage(page);
      setAuthOpen(true);
      return;
    }
    if (!['user', 'owner'].includes(user.role)) {
      notify('Contact admin is available to customer and salon owner accounts.');
      return;
    }
    setContactAdminOpen(true);
  };

  const closeAuth = () => {
    contactAfterAuthRef.current = false;
    setAuthOpen(false);
  };

  const handleSignedIn = (nextUser) => {
    setUser(nextUser);
    setPage(authReturnPage);
    notify(`Welcome, ${nextUser.name}.`);
    if (contactAfterAuthRef.current) {
      contactAfterAuthRef.current = false;
      if (['user', 'owner'].includes(nextUser.role)) setContactAdminOpen(true);
      else notify('Contact admin is available to customer and salon owner accounts.');
    }
  };

  const requestConfirmation = useCallback((options) => new Promise((resolve) => {
    confirmationResolverRef.current = resolve;
    setConfirmation({
      title: options.title || 'Please confirm',
      message: options.message,
      confirmLabel: options.confirmLabel || 'Continue',
      cancelLabel: options.cancelLabel || 'Cancel',
      danger: Boolean(options.danger),
    });
  }), []);

  const resolveConfirmation = useCallback((confirmed) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const loadSalons = useCallback(async () => {
    const requestId = ++salonRequestIdRef.current;
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (openOnly) params.set('openNow', 'true');
    if (maxWait) params.set('maxWait', maxWait);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (maxDistance && location) params.set('maxDistanceKm', maxDistance);
    if (location) {
      params.set('lat', String(location.lat));
      params.set('lng', String(location.lng));
    }
    try {
      const result = await api(`/api/salons?${params.toString()}`);
      if (requestId !== salonRequestIdRef.current) return;
      setSalons(result.salons);
      const requestedSalonId = requestedSalonIdRef.current;
      let linkedSalon = requestedSalonId && result.salons.find((salon) => salon.id === requestedSalonId);
      if (requestedSalonId && !linkedSalon) {
        try {
          const salonResult = await api(`/api/salons/${encodeURIComponent(requestedSalonId)}`);
          linkedSalon = salonResult.salon;
        } catch (requestError) {
          if (requestId === salonRequestIdRef.current) {
            requestedSalonIdRef.current = '';
            setError(requestError.message);
            const url = new URL(window.location.href);
            url.searchParams.delete('salon');
            window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
          }
        }
      }
      if (requestId !== salonRequestIdRef.current) return;
      if (linkedSalon) {
        requestedSalonIdRef.current = '';
        setSelectedSalon(linkedSalon);
        setSelectedServices([]);
        setPage('home');
        setBookingPanelOpen(window.matchMedia('(max-width: 900px)').matches);
        const url = new URL(window.location.href);
        url.searchParams.delete('salon');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } else if (!requestedSalonId) {
        setSelectedSalon((previous) => result.salons.find((salon) => salon.id === previous?.id) || result.salons[0] || null);
      }
      if (linkedSalon || !requestedSalonId) setError('');
    } catch (requestError) {
      if (requestId === salonRequestIdRef.current) setError(requestError.message);
    } finally {
      if (requestId === salonRequestIdRef.current) setSalonsReady(true);
    }
  }, [search, openOnly, maxWait, maxPrice, maxDistance, location]);

  const submitSalonRating = async (salonId, rating) => {
    if (!user) {
      setAuthReturnPage('home');
      setAuthOpen(true);
      return;
    }
    if (user.role !== 'user') {
      notify('Only customer accounts can rate salons.');
      return;
    }
    setRatingSavingFor(salonId);
    try {
      const result = await api(`/api/salons/${salonId}/rating`, {
        method: 'POST',
        body: JSON.stringify({ rating }),
      });
      setMySalonRatings((current) => ({ ...current, [salonId]: result.rating }));
      setSalons((current) => current.map((salon) => salon.id === salonId
        ? { ...salon, rating: result.average, ratingCount: result.ratingCount }
        : salon));
      notify(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRatingSavingFor('');
    }
  };

  const loadBookings = useCallback(async () => {
    if (!user) return;
    try {
      const result = await api('/api/bookings/my-bookings');
      for (const booking of result.bookings) {
        const previousWait = bookingWaits.current.get(booking.id);
        const currentWait = booking.estimatedWaitMinutes;
        if (
          booking.status === 'waiting' &&
          Number.isFinite(currentWait) &&
          currentWait <= 10 &&
          (previousWait === undefined || previousWait > 10)
        ) {
          notify(`Your turn at ${booking.salonId?.name || 'the salon'} is coming up in about ${currentWait} minutes.`);
        }
        bookingWaits.current.set(booking.id, currentWait);
      }
      setBookings(result.bookings);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [user, notify]);

  const loadReport = useCallback(async () => {
    if (!user || !['admin', 'owner'].includes(user.role)) return;
    const params = new URLSearchParams({ period });
    if (reportSalon) params.set('salonId', reportSalon);
    if (user.role === 'admin' && reportCustomer) params.set('customerId', reportCustomer);
    if (serviceCategory) params.set('serviceCategory', serviceCategory);
    const endpoint = user.role === 'admin' ? '/api/admin/reports' : '/api/bookings/owner/report';
    try {
      const result = await api(`${endpoint}?${params.toString()}`);
      setReport(result.report);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [user, period, reportSalon, reportCustomer, serviceCategory]);

  const loadOwnerSalons = useCallback(async () => {
    if (user?.role !== 'owner') return;
    try {
      const result = await api('/api/salons/mine');
      setOwnerSalons(result.salons);
      setOwnerSalonId((current) => result.salons.some((salon) => salon.id === current) ? current : result.salons[0]?.id || '');
      setOwnerSalonsLoaded(true);
    } catch (requestError) {
      setOwnerSalonsLoaded(true);
      setError(requestError.message);
    }
  }, [user]);

  const loadQueue = useCallback(async () => {
    if (!ownerSalonId) return;
    try {
      const result = await api(`/api/bookings/owner/${ownerSalonId}/queue`);
      setQueue(result.queue);
      setBlockedCustomers(Array.isArray(result.blockedCustomers) ? result.blockedCustomers : []);
      setOwnerBookingHistory(Array.isArray(result.bookings) ? result.bookings : []);
      setOwnerAccountUid(result.accountUid || '');
      setError((current) => current.includes('/api/bookings/owner/') && current.endsWith('/history') ? '' : current);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [ownerSalonId]);

  useEffect(() => {
    api('/api/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => {})
      .finally(() => setSessionReady(true));
  }, []);

  useEffect(() => {
    if (!sessionReady) return undefined;
    refreshAnnouncement();
    const timer = window.setInterval(refreshAnnouncement, 15_000);
    return () => window.clearInterval(timer);
  }, [sessionReady, user?.id, user?.role, refreshAnnouncement]);

  useEffect(() => {
    if (!announcementInfo.announcement) return undefined;
    const expiryDelay = new Date(announcementInfo.announcement.expiresAt).getTime() - Date.now();
    if (expiryDelay <= 0) {
      refreshAnnouncement();
      return undefined;
    }
    const timer = window.setTimeout(refreshAnnouncement, expiryDelay + 25);
    return () => window.clearTimeout(timer);
  }, [announcementInfo, refreshAnnouncement]);

  useEffect(() => {
    const expectedHash = PAGE_HASHES[page];
    if (window.location.hash === expectedHash) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${expectedHash}`);
  }, [page]);

  useEffect(() => {
    if (!sessionReady) return;
    const pageAllowed = page === 'home' ||
      (Boolean(user) && (page === 'orders' || page === 'profile')) ||
      (page === 'salon' && user?.role === 'owner') ||
      (page === 'admin' && user?.role === 'admin');
    if (!pageAllowed) setPage('home');
  }, [page, sessionReady, user]);

  useEffect(() => {
    if (!salonsReady || !sessionReady) return undefined;
    const timer = window.setTimeout(() => setBootLoaderVisible(false), 450);
    return () => window.clearTimeout(timer);
  }, [salonsReady, sessionReady]);

  useEffect(() => {
    if (!bootLoaderVisible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [bootLoaderVisible]);

  useEffect(() => {
    if (user?.role !== 'user') {
      setMySalonRatings({});
      return undefined;
    }
    let active = true;
    api('/api/salons/my-ratings')
      .then((result) => {
        if (active) setMySalonRatings(result.ratings || {});
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      applyLocationFix,
      () => {
        if (!locationFixRef.current) setLocationStatus('unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [applyLocationFix]);

  useEffect(() => {
    const timer = window.setTimeout(loadSalons, 250);
    return () => window.clearTimeout(timer);
  }, [loadSalons]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadSalons();
      loadBookings();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadSalons, loadBookings]);

  useEffect(() => {
    loadBookings();
    loadReport();
    loadOwnerSalons();
  }, [loadBookings, loadReport, loadOwnerSalons]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api('/api/admin/management/salon-options').then((result) => setAdminSalons(result.salons)).catch((requestError) => setError(requestError.message));
    api('/api/admin/salons/pending').then((result) => setPendingSalons(result.salons)).catch((requestError) => setError(requestError.message));
    api('/api/admin/management/customer-options').then((result) => setAdminCustomers(result.customers)).catch((requestError) => setError(requestError.message));
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'owner' || !ownerSalonId) return undefined;
    loadQueue();
    const timer = window.setInterval(loadQueue, 20_000);
    return () => window.clearInterval(timer);
  }, [user, ownerSalonId, loadQueue]);

  const fastest = useMemo(() => salons.filter((salon) => salon.isOpen).sort((a, b) => a.waitMinutes - b.waitMinutes)[0], [salons]);
  const selectedTotal = (selectedSalon?.services || [])
    .filter((service) => selectedServices.includes(service._id))
    .reduce((sum, service) => sum + service.price, 0);
  const advanceAmount = priority === 'express' ? 25 : 1;
  const bookingTotal = selectedTotal + advanceAmount;

  const locateMe = () => {
    if (!navigator.geolocation) {
      notify('Location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (applyLocationFix(position, true)) notify('Your current location is updated now.');
        else notify('Could not update your location with a reliable fix. Please try again in an open area.');
      },
      (locationError) => {
        if (!locationFixRef.current) setLocationStatus('unavailable');
        notify(locationError.code === 3
          ? 'Could not get a precise location in time. Please try again in an open area.'
          : 'Location permission was not granted. Allow location access in your browser to show distances.');
      },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 }
    );
  };

  const toggleService = (serviceId) => {
    setSelectedServices((current) => current.includes(serviceId)
      ? current.filter((id) => id !== serviceId)
      : [...current, serviceId]);
  };

  const bookNow = async () => {
    if (!user) {
      setAuthReturnPage('home');
      setAuthOpen(true);
      return;
    }
    if (!selectedSalon || !selectedServices.length) {
      notify('Choose at least one service to continue.');
      return;
    }
    if (!appointmentDate || appointmentDate < getLocalDateString()) {
      notify('Choose an appointment date today or later.');
      return;
    }
    setBusy(true);
    try {
      const result = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          salonId: selectedSalon.id,
          serviceIds: selectedServices,
          priority,
          appointmentDate,
          appointmentTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      });
      if (!result.payment?.upiUrl || !result.booking) {
        throw new Error('The server did not return valid UPI payment instructions. Your booking was not completed.');
      }
      setSelectedServices([]);
      setUpiPayment({ booking: result.booking, payment: result.payment });
      await loadBookings();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const requestBooking = () => {
    if (!user) {
      bookNow();
      return;
    }
    setNonRefundableNoticeOpen(true);
  };

  const submitUpiReference = async (bookingId, upiReference) => {
    const result = await api(`/api/bookings/${bookingId}/upi-reference`, {
      method: 'POST',
      body: JSON.stringify({ upiReference }),
    });
    setUpiPayment((current) => current && current.booking.id === bookingId
      ? { ...current, booking: { ...current.booking, upiReference } }
      : current);
    await loadBookings();
    return result;
  };

  const openUpiPayment = (booking, payment = booking.upiPayment) => {
    if (!payment?.upiUrl) {
      setError('UPI payment instructions are unavailable for this booking. Contact support before paying.');
      return;
    }
    setUpiPayment({ booking, payment });
  };

  const cancelBooking = async (bookingId) => {
    try {
      const result = await api(`/api/bookings/${bookingId}/cancel`, { method: 'POST' });
      if (result.walletCreditReturned) {
        setUser((current) => current && ({
          ...current,
          walletCredits: (current.walletCredits || 0) + result.walletCreditReturned,
        }));
      }
      notify(result.message);
      await loadBookings();
      await loadSalons();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const signOut = async () => {
    const confirmed = await requestConfirmation({
      title: 'Sign out?',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setBookings([]);
      setOwnerSalons([]);
      setOwnerSalonId('');
      setOwnerSalonsLoaded(false);
      setPage('home');
      notify('You have signed out.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const sendMessage = async (path, message) => {
    const result = await api(path, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    notify(result.message);
  };

  const setQueueStatus = async (bookingId, status, extra = {}) => {
    try {
      const result = await api(`/api/bookings/${bookingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...extra }),
      });
      setRejectingBookingId('');
      setRejectionDetails('');
      if (result.warning) setError(result.warning);
      else if (status === 'rejected') notify('Booking rejected and removed from the queue. A feedback email was sent.');
      await loadQueue();
      await loadReport();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const setCustomerBlocked = async (salonId, customerId, blocked) => {
    if (!await requestConfirmation({
      title: blocked ? 'Block this customer?' : 'Unblock this customer?',
      message: blocked
        ? 'Block this customer from making future bookings at this salon? Their current booking will not be changed.'
        : 'Allow this customer to make new bookings at this salon again?',
      confirmLabel: blocked ? 'Block customer' : 'Unblock customer',
      danger: blocked,
    })) return;
    try {
      const result = await api(`/api/salons/mine/${salonId}/customers/${customerId}/block`, {
        method: 'PATCH',
        body: JSON.stringify({ blocked }),
      });
      notify(result.message);
      await loadQueue();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const retryRejectionEmail = async (bookingId) => {
    try {
      const result = await api(`/api/bookings/${bookingId}/rejection-email`, { method: 'POST' });
      notify(result.message);
      await loadQueue();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const setSalonApproval = async (salonId, isApproved) => {
    try {
      await api(`/api/admin/salons/${salonId}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ isApproved }),
      });
      setPendingSalons((current) => current.filter((salon) => salon.id !== salonId));
      await loadSalons();
      const result = await api('/api/admin/management/salon-options');
      setAdminSalons(result.salons);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const downloadReport = async () => {
    const params = new URLSearchParams({ period });
    if (reportSalon) params.set('salonId', reportSalon);
    if (user?.role === 'admin' && reportCustomer) params.set('customerId', reportCustomer);
    if (serviceCategory) params.set('serviceCategory', serviceCategory);
    const path = user?.role === 'admin' ? '/api/admin/reports.csv' : '/api/bookings/owner/report.csv';
    try {
      const response = await fetch(`${API_BASE}${path}?${params}`, { credentials: 'include' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Could not download report.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'salonflow-activity.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const clearReportFilters = () => {
    setReportSalon('');
    setReportCustomer('');
    setServiceCategory('');
  };

  const createSalon = async (event) => {
    event.preventDefault();
    try {
      const form = newSalon;
      const result = await api('/api/salons', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          city: form.city,
          address: form.address,
          phone: form.phone,
          lat: Number(form.lat),
          lng: Number(form.lng),
          pinCode: form.pinCode,
          services: [{
            name: form.serviceName,
            category: form.serviceCategory,
            price: Number(form.servicePrice),
            durationMinutes: Number(form.serviceDuration),
          }],
        }),
      });
      notify(result.message);
      setShowSalonForm(false);
      await loadOwnerSalons();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const setSalonOpen = async (salon, isOpen) => {
    if (salonOpenUpdates[salon.id]) return;
    setSalonOpenUpdates((current) => ({ ...current, [salon.id]: true }));
    try {
      await api(`/api/salons/mine/${salon.id}/open`, {
        method: 'PATCH',
        body: JSON.stringify({ isOpen }),
      });
      await loadOwnerSalons();
      await loadSalons();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSalonOpenUpdates((current) => {
        const next = { ...current };
        delete next[salon.id];
        return next;
      });
    }
  };

  const reportPathForOwner = user?.role === 'owner' && page === 'salon';
  const salonList = useLoadMore(salons, JSON.stringify([search, openOnly, maxWait, maxPrice, maxDistance]));
  const ownerSalonList = useLoadMore(ownerSalons, user?.id || '');
  const queueList = useLoadMore(queue, ownerSalonId);
  const blockedCustomerList = useLoadMore(blockedCustomers, ownerSalonId);
  const ownerHistoryList = useLoadMore(ownerBookingHistory, ownerSalonId);
  const pendingSalonList = useLoadMore(pendingSalons, 'admin-pending-salons');
  const reportServiceList = useLoadMore(report?.services || [], JSON.stringify([reportSalon, reportCustomer, serviceCategory, period]));
  const bookingServiceList = useLoadMore(selectedSalon?.services || [], selectedSalon?.id || '');
  const reportSalons = user?.role === 'admin' ? adminSalons : ownerSalons;
  const qrSalon = ownerSalons.find((salon) => salon.id === ownerSalonId) || ownerSalons[0] || null;
  const reportCategories = [...new Set([
    'Haircut',
    'Beard',
    'Color',
    'Spa',
    'Skin Care',
    ...(user?.role === 'admin' ? adminSalons : ownerSalons).flatMap((salon) =>
      salon.services.map((service) => service.category)
    ),
  ])].sort();
  const visibleWait = selectedSalon?.waitMinutes || 0;
  const selectSalon = (salon, event) => {
    bookingTriggerRef.current = event.currentTarget;
    setSelectedSalon(salon);
    setSelectedServices([]);
    setBookingPanelOpen(window.matchMedia('(max-width: 900px)').matches);
  };

  return (
    <div className={`app-shell ${bootLoaderVisible ? 'is-boot-loading' : ''}`} aria-busy={bootLoaderVisible}>
      <header className="topbar topbar-no-search">
        <a className="brand" href="#home" onClick={() => setPage('home')} aria-label="SalonFlow home"><span className="brand-mark">S</span>SalonFlow</a>
        <nav className="nav">
          <a className={page === 'orders' ? 'active' : ''} aria-current={page === 'orders' ? 'page' : undefined} href="#orders" onClick={(event) => {
            event.preventDefault();
            if (user) setPage('orders');
            else {
              setAuthReturnPage('orders');
              setAuthOpen(true);
            }
          }}>Orders &amp; history</a>
          {user?.role === 'admin' && <a className={page === 'admin' ? 'active' : ''} aria-current={page === 'admin' ? 'page' : undefined} href="#dashboard" onClick={() => setPage('admin')}>Admin</a>}
          {user?.role === 'owner' && <a className={page === 'salon' ? 'active' : ''} aria-current={page === 'salon' ? 'page' : undefined} href="#owner" onClick={() => setPage('salon')}>My salon</a>}
          <button
            className={`profile-avatar ${user?.profileImage ? 'has-photo' : ''}`}
            onClick={() => {
              if (user) setPage('profile');
              else {
                setAuthReturnPage('profile');
                setAuthOpen(true);
              }
            }}
            aria-label={user ? user.role === 'owner' ? 'Open salon management profile' : `Open ${user.name}'s profile` : 'Sign in to your profile'}
            title={user?.role === 'owner' ? 'Manage your salon' : user ? 'Your profile' : 'Sign in'}
          >
            {user?.role === 'owner' && ownerSalons[0]?.image
              ? <img src={ownerSalons[0].image} alt="" />
              : user?.role === 'owner'
                ? <span>{getInitials(ownerSalons[0]?.name || 'Salon')}</span>
                : user?.profileImage
              ? <img src={user.profileImage} alt="" />
              : <span>{getInitials(user?.name || '')}</span>}
          </button>
        </nav>
      </header>
      {announcementLoadError && sessionReady && <div className="announcement-load-error" role="alert">Could not load the admin announcement. {announcementLoadError}</div>}
      {announcementInfo.announcement && sessionReady && <aside className="admin-announcement-banner" aria-live="polite">
        <span className="announcement-alert-symbol" aria-hidden="true">⚠</span>
        <div><strong>Important message from admin</strong><p>{announcementInfo.announcement.message}</p></div>
      </aside>}
      {!user && announcementInfo.hasActiveAnnouncement && sessionReady && <button className="admin-announcement-teaser" type="button" onClick={() => {
        setAuthReturnPage(page);
        setAuthOpen(true);
      }}>
        <span className="announcement-alert-symbol" aria-hidden="true">⚠</span>
        <span><strong>Important message from admin</strong><small>Sign in or create an account to view it.</small></span>
        <span className="announcement-teaser-arrow" aria-hidden="true">→</span>
      </button>}

      <main id="home">
        {page === 'orders' && user ? (
          <OrdersHistoryPage key={`${user.id}-${user.role}`} user={user} onBack={() => setPage('home')} />
        ) : page === 'profile' && user ? (
          user.role === 'owner' ? (
            <SalonProfilePage
              key={user.id}
              salons={ownerSalons}
              loaded={ownerSalonsLoaded}
              onRefresh={loadOwnerSalons}
              onSalonChanged={loadSalons}
              onBack={() => setPage('home')}
              onSignOut={signOut}
            />
          ) : (
            <ProfilePage
              key={user.id}
              user={user}
              bookings={bookings}
              onUserUpdated={setUser}
              onBack={() => setPage('home')}
              onSignOut={signOut}
              onCancelBooking={cancelBooking}
              onOpenUpiPayment={openUpiPayment}
              onAnnouncementChanged={refreshAnnouncement}
            />
          )
        ) : (
          <>
        {/* <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Your time, beautifully booked</span>
            <h1>Good hair days.<br /><span>Without the wait.</span></h1>
            <p>Find a nearby barber, see the live wait estimate, and save your place before you arrive.</p>
            <div className="hero-trust"><span>✦ Real-time queue estimates</span><span>✦ Book in a few taps</span></div>
          </div>
          <div className="hero-art" aria-label="Salon booking illustration">
            <div className="art-glow" />
            <div className="art-circle"><span className="art-scissors">✂</span></div>
            <div className="floating-card floating-top"><span className="live-dot" /> LIVE QUEUE <strong>{salons.reduce((sum, salon) => sum + salon.queueCount, 0)} waiting</strong></div>
            <div className="floating-card floating-bottom"><span className="sparkle">✦</span><div><small>QUICKEST NEAR YOU</small><strong>{fastest?.name || 'Find your favourite'}</strong><small>{fastest ? `${formatWaitDuration(fastest.waitMinutes)} estimated wait` : 'Turn on location to get started'}</small></div></div>
            <div className="art-caption">Look sharp.<br />Feel like you.</div>
          </div>
        </section> */}

        {page !== 'salon' && page !== 'admin' && <section className="filter-section" id="discover">
          {page === 'home' && <div className="home-search">
            <div className="search-box">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Salon name, street, or area" aria-label="Search salons" />
              {search && <button className="search-clear-button close-control" type="button" onClick={() => setSearch('')} aria-label="Clear salon search" title="Clear search">×</button>}
              <button className="search-submit-button" type="button" onClick={loadSalons} aria-label="Search salons" title="Search salons">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
              </button>
            </div>
            <button className="location-button" onClick={locateMe}>
              <svg className="location-map-icon" viewBox="0 0 24 24" aria-hidden="true">
                <defs>
                  <clipPath id="location-pin-clip">
                    <path d="M12 2.25a7 7 0 0 0-7 7c0 5.2 7 12.5 7 12.5s7-7.3 7-12.5a7 7 0 0 0-7-7Z" />
                  </clipPath>
                </defs>
                <g clipPath="url(#location-pin-clip)">
                  <path fill="#4285f4" d="M4 2h16v20H4z" />
                  <path fill="#ea4335" d="M4 2h8v8H4z" />
                  <path fill="#fbbc04" d="M12 2h8v8h-8z" />
                  <path fill="#34a853" d="M4 10h8v12H4z" />
                </g>
                <circle cx="12" cy="9.25" r="3" fill="#fff" />
              </svg>
              {location ? 'Update my location' : 'Use my current location'}
            </button>
          </div>}
          {/* <div className="section-heading">
            <div><span className="eyebrow">Made for your neighbourhood</span><h2>Find your next favourite Salon</h2></div>
            <span className="result-count">{salons.length} salon{salons.length === 1 ? '' : 's'} nearby</span>
          </div> */}
          <div className="filter-bar">
            <label className="check-filter"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} /><span>Open now</span></label>
            <select className="filter-select wait-filter" aria-label="Wait time filter" value={maxWait} onChange={(event) => setMaxWait(event.target.value)}><option value="">Waiting time</option><option value="10">Up to 10 min</option><option value="15">Up to 15 min</option><option value="20">Up to 20 min</option><option value="30">Up to 30 min</option><option value="45">Up to 45 min</option><option value="60">Up to 60 min</option><option value="90">Up to 90 min</option><option value="120">Up to 2 hours</option></select>
            <select className="filter-select" aria-label="Service price filter" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="">Any price</option><option value="100">Up to ₹100</option><option value="150">Up to ₹150</option><option value="200">Up to ₹200</option><option value="250">Up to ₹250</option><option value="300">Up to ₹300</option><option value="350">Up to ₹350</option><option value="400">Up to ₹400</option><option value="500">Up to ₹500</option><option value="1000">Up to ₹1,000</option></select>
            <select className="filter-select" aria-label="Distance filter" value={maxDistance} onChange={(event) => { setMaxDistance(event.target.value); if (event.target.value && !location) locateMe(); }}><option value="">Any distance</option><option value="2">2 km</option><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option></select>
          </div>
          {!location && <p className="fine-print">{locationStatus === 'detecting' ? 'Detecting your location automatically. Allow the browser location prompt to calculate nearby distances and directions.' : locationStatus === 'imprecise' ? 'Getting a usable location fix. Distances will appear when the device provides one.' : 'Location is unavailable. Allow location access in your browser to calculate distances and directions; you can still search by area.'}{maxDistance ? ' The distance filter will apply when location is available.' : ''}</p>}
          {error && <div className="alert" role="alert"><span>{error}</span><button className="icon-button close-control" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
          <div className={`discover-grid ${bookingPanelOpen ? 'booking-open' : ''}`}>
            <div className="salon-list">
              {!salons.length && !error && <div className="empty-state"><span>✦</span><h3>No salons match just yet</h3><p>Try a wider search or remove one of your filters.</p></div>}
              {salonList.visibleItems.map((salon) => {
                const index = salons.findIndex((item) => item.id === salon.id);
                const salonImages = [salon.image, ...(salon.images || [])].filter(Boolean);
                const imageIndex = salonImageIndexes[salon.id] || 0;
                const displayedImage = salonImages[imageIndex] || salonImages[0];
                return (
                <article
                  className={`salon-card ${selectedSalon?.id === salon.id ? 'selected' : ''}`}
                  key={salon.id}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => selectSalon(salon, event)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      selectSalon(salon, event);
                    }
                  }}
                >
                  <div className={`salon-cover cover-${index % 3}`} style={displayedImage ? { backgroundImage: `linear-gradient(180deg, transparent, rgba(33,24,24,.34)), url("${displayedImage}")` } : undefined}>
                    <span className={`open-pill ${salon.isOpen ? 'is-open' : 'is-closed'}`}><i />{salon.isOpen ? 'Open now' : 'Closed'}</span>
                    {salonImages.length > 1 && <>
                      <button className="salon-image-nav salon-image-prev" type="button" aria-label={`Previous photo of ${salon.name}`} onClick={(event) => {
                        event.stopPropagation();
                        setSalonImageIndexes((current) => ({ ...current, [salon.id]: (imageIndex - 1 + salonImages.length) % salonImages.length }));
                      }}>‹</button>
                      <button className="salon-image-nav salon-image-next" type="button" aria-label={`Next photo of ${salon.name}`} onClick={(event) => {
                        event.stopPropagation();
                        setSalonImageIndexes((current) => ({ ...current, [salon.id]: (imageIndex + 1) % salonImages.length }));
                      }}>›</button>
                    </>}
                  </div>
                  <div className="salon-card-body">
                    <div className="title-row"><h3>{salon.name}</h3><span className="rating">{salon.ratingCount ? `★ ${salon.rating.toFixed(1)} (${salon.ratingCount})` : 'New'}</span></div>
                    <div className="salon-rating-row">
                      <span>{mySalonRatings[salon.id] ? `Your rating: ${mySalonRatings[salon.id]}/5` : 'Rate this salon'}</span>
                      <div className="salon-rating-stars" role="group" aria-label={`Rate ${salon.name}`}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            className={star <= (mySalonRatings[salon.id] || 0) ? 'is-selected' : ''}
                            aria-label={`Rate ${salon.name} ${star} out of 5 stars`}
                            aria-pressed={mySalonRatings[salon.id] === star}
                            disabled={ratingSavingFor === salon.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              submitSalonRating(salon.id, star);
                            }}
                          >★</button>
                        ))}
                      </div>
                    </div>
                    <p className="salon-address">{salon.address}, {salon.city}</p>
                    <div className="salon-metrics"><span>◷ {formatWaitDuration(salon.waitMinutes)} wait</span><span title={locationFixRef.current ? `Straight-line distance; location accuracy is about ±${Math.round(locationFixRef.current.accuracy)} m. Google Maps provides the road route distance.` : 'Straight-line distance; Google Maps provides the road route distance'}>{formatSalonDistance(salon.distanceKm, locationFixRef.current?.accuracy)}</span><span>{salon.queueCount} waiting</span></div>
                    <div className="service-tags">{salon.services.slice(0, 3).map((service) => <span key={service._id}>{service.name} · {money(service.price)}</span>)}</div>
                    <div className="salon-card-quick-actions">
                      <MapsLocateLink salon={salon} location={location} stopPropagation />
                      <SalonVisitingCardButton salon={salon} />
                    </div>
                  </div>
                </article>
                );
              })}
              <LoadMoreButton shown={salonList.visibleItems.length} total={salons.length} onClick={salonList.loadMore} label="salons" />
            </div>

            {bookingPanelOpen && <button className="booking-modal-backdrop" type="button" onClick={closeBookingPanel} aria-label="Close booking details" />}
            <aside className={`booking-panel ${bookingPanelOpen ? 'is-mobile-open' : ''}`} id="booking" role={bookingPanelOpen ? 'dialog' : undefined} aria-modal={bookingPanelOpen ? 'true' : undefined} aria-labelledby="booking-panel-title">
              <div className="booking-panel-head"><span className="eyebrow">Book Your Slot</span><button ref={bookingCloseRef} className="icon-button booking-mobile-close close-control" type="button" onClick={closeBookingPanel} aria-label="Close booking details">×</button><h2 id="booking-panel-title">{selectedSalon?.name || 'Choose a salon'}</h2><p>{selectedSalon ? `${selectedSalon.address}, ${selectedSalon.city}` : 'Select a salon to see its services and queue.'}</p></div>
              {selectedSalon && (
                <>
                  <div className="booking-salon-status" role="status"><span className="booking-status-label">Status</span><strong className={`booking-status-badge ${selectedSalon.isOpen ? 'is-open' : 'is-closed'}`}>{selectedSalon.isOpen ? 'OPEN' : 'CLOSED'}</strong></div>
                  <div className="salon-contact">
                    {selectedSalon.phone && <a href={`tel:${selectedSalon.phone}`}>☎ Call salon</a>}
                    <button type="button" onClick={() => user ? setMessageSalonId((current) => current === selectedSalon.id ? '' : selectedSalon.id) : setAuthOpen(true)}>✉ Message</button>
                    <MapsLocateLink salon={selectedSalon} location={location} className="booking-map-link" />
                  </div>
                  {messageSalonId === selectedSalon.id && <MessageComposer recipient={`the owner of ${selectedSalon.name}`} onClose={() => setMessageSalonId('')} onSend={(message) => sendMessage(`/api/salons/${selectedSalon.id}/message`, message)} />}
                  <div className="queue-spotlight"><span className="queue-icon">◷</span><div><small>ESTIMATED WAIT</small><strong>{formatWaitDuration(visibleWait)}</strong></div><span className="queue-live"><i /> Live</span></div>
                  <label className="appointment-date-field">Appointment date<input type="date" value={appointmentDate} min={getLocalDateString()} onChange={(event) => setAppointmentDate(event.target.value)} required /><small>Choose today, tomorrow, or another available day.</small></label>
                  <div className="service-picker"><h3>Choose your services</h3>{bookingServiceList.visibleItems.map((service) => (
                    <label className="service-option" key={service._id}>
                      <input type="checkbox" checked={selectedServices.includes(service._id)} onChange={() => toggleService(service._id)} />
                      <span className="service-check" />
                      <span className="service-info"><strong>{service.name}</strong><small>{service.durationMinutes} min · {service.category}</small></span>
                      <strong className="service-price">{money(service.price)}</strong>
                    </label>
                  ))}<LoadMoreButton shown={bookingServiceList.visibleItems.length} total={selectedSalon.services.length} onClick={bookingServiceList.loadMore} label="services" /></div>
                  <div className="option-group"><span>Choose your booking type</span><div className="segmented"><button type="button" className={priority === 'standard' ? 'active' : ''} onClick={() => setPriority('standard')}>Standard · Pay ₹1</button><button type="button" className={priority === 'express' ? 'active' : ''} onClick={() => setPriority('express')}>Express · Pay ₹25</button></div></div>
                  <div className="upi-price-breakdown">
                    <div><span>Selected services (pay at salon)</span><strong>{money(selectedTotal)}</strong></div>
                    <div><span>{priority === 'express' ? 'Express advance (pay now)' : 'Reservation advance (pay now)'}</span><strong>{money(advanceAmount)}</strong></div>
                    <div className="upi-payment-total"><span>Total booking cost</span><strong>{money(bookingTotal)}</strong></div>
                  </div>
                  {priority === 'express' && <p className="fine-print">Express bookings are placed ahead of waiting standard bookings; customers already in service are not interrupted.</p>}
                  <p className="fine-print">The advance is paid to the platform account. Pay the selected service charges directly to the salon after your visit. Your queue place is confirmed only after the advance is verified.</p>
                  <button className="button button-primary full-width book-button" disabled={busy || !selectedSalon.isOpen || !selectedServices.length} onClick={requestBooking}>{busy ? 'Preparing UPI payment…' : selectedSalon.isOpen ? `Continue · Pay ${money(advanceAmount)}` : 'Salon currently closed'}</button>
                  <p className="secure-note">UPI intent and a locally generated QR are provided. The booking stays pending until payment is verified.</p>
                </>
              )}
            </aside>
          </div>
        </section>}

        {user?.role === 'owner' && page === 'salon' && (
          <section className="dashboard-section" id="owner">
            <div className="owner-studio-heading">
              <BackArrowButton onClick={() => setPage('home')} className="section-back-navigation" />
              <strong className="owner-studio-title">Owner studio</strong>
              <div className="owner-studio-actions">
                <button
                  className="salon-qr-top-button"
                  type="button"
                  onClick={() => qrSalon && setSalonQr(qrSalon)}
                  disabled={!qrSalon?.isApproved}
                  title={qrSalon?.isApproved ? `Create and download a QR code for ${qrSalon.name}` : 'A QR code is available after a salon is approved'}
                  aria-label={qrSalon ? `Show QR code for ${qrSalon.name}` : 'Add a salon to create a QR code'}
                >
                  <svg className="salon-qr-top-icon" viewBox="0 0 32 32" aria-hidden="true">
                    <path d="M3 3h10v10H3zM19 3h10v10H19zM3 19h10v10H3zM19 19h4v4h-4zM26 19h3v3h-3zM26 26h3v3h-3zM19 26h4v3h-4z" />
                    <path d="M6 6h4v4H6zM22 6h4v4h-4zM6 22h4v4H6z" className="salon-qr-icon-cutout" />
                  </svg>
                  <span className="salon-qr-top-copy"><strong>Show QR</strong></span>
                </button>
                <button className="button button-soft" onClick={() => setShowSalonForm((visible) => !visible)}>{showSalonForm ? 'Close form' : '+ Add a salon'}</button>
              </div>
            </div>
            {showSalonForm && (
              <form className="salon-setup panel-box" onSubmit={createSalon}>
                <h3>Submit a salon for approval</h3>
                <div className="form-grid">
                  {[
                    ['name', 'Salon name'], ['city', 'City'], ['address', 'Street address'], ['phone', 'Phone'],
                    ['serviceName', 'First service'], ['serviceCategory', 'Service category'],
                    ['servicePrice', 'Price in ₹'], ['serviceDuration', 'Duration in minutes'],
                  ].map(([key, label]) => <label key={key}>{label}<input required value={newSalon[key]} onChange={(event) => setNewSalon((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
                  <CoordinateFields latitude={newSalon.lat} longitude={newSalon.lng} pinCode={newSalon.pinCode} onChange={(field, value) => setNewSalon((current) => ({ ...current, [field]: value }))} onError={setError} currentLocationLabel="◎ Use my current location for the salon" />
                </div>
                <button className="button button-primary" type="submit">Submit for review</button>
              </form>
            )}
            <div className="owner-grid">
              <div className="panel-box">
                <div className="panel-title-row"><h3>Salon operations</h3></div>
                {!ownerSalons.length && <p className="muted">Add a salon to start managing its queue. New salons need admin approval before customers can book.</p>}
                {ownerSalonList.visibleItems.map((salon) => <div className="owner-salon-row" key={salon.id}>
                  <div><strong>{salon.name}</strong><small>{salon.city} · {salon.isApproved ? 'Approved' : 'Awaiting approval'}</small></div>
                  <label className={`salon-status-toggle ${salon.isOpen ? 'is-open' : 'is-closed'} ${salonOpenUpdates[salon.id] ? 'is-updating' : ''}`} title={salon.isApproved ? 'Toggle salon open status' : 'Salon must be approved before opening'} aria-busy={Boolean(salonOpenUpdates[salon.id])}>
                    <input type="checkbox" role="switch" aria-label={`${salon.name} open status`} disabled={!salon.isApproved || Boolean(salonOpenUpdates[salon.id])} checked={salon.isOpen} onChange={(event) => setSalonOpen(salon, event.target.checked)} />
                    <span className="salon-status-track" aria-hidden="true"><span /></span>
                    <strong>{salonOpenUpdates[salon.id] ? <><span className="salon-status-spinner" aria-hidden="true" />Updating…</> : salon.isOpen ? 'Open' : 'Closed'}</strong>
                  </label>
                </div>)}
                <LoadMoreButton shown={ownerSalonList.visibleItems.length} total={ownerSalons.length} onClick={ownerSalonList.loadMore} label="salons" />
              </div>
              <div className="panel-box queue-panel">
                <div className="panel-title-row"><h3>Live queue</h3><select value={ownerSalonId} onChange={(event) => setOwnerSalonId(event.target.value)} aria-label="Choose salon"><option value="">Choose salon</option>{ownerSalons.map((salon) => <option key={salon.id} value={salon.id}>{salon.name}</option>)}</select></div>
                {!queue.length && <p className="muted">No customers are waiting right now.</p>}
                {blockedCustomers.length > 0 && <section className="blocked-customers">
                  <h4>Blocked customers ({blockedCustomers.length})</h4>
                  {blockedCustomerList.visibleItems.map((customer) => <div className="blocked-customer-row" key={customer.id}>
                    <span><strong>{customer.name}</strong><small>{customer.uid || customer.email || customer.contactPhone || 'Customer'}</small></span>
                    <button className="button button-soft button-small" onClick={() => setCustomerBlocked(ownerSalonId, customer.id, false)}>Unblock</button>
                  </div>)}
                  <LoadMoreButton shown={blockedCustomerList.visibleItems.length} total={blockedCustomers.length} onClick={blockedCustomerList.loadMore} label="customers" />
                </section>}
                {queueList.visibleItems.map((booking) => <div className="queue-row" key={booking.id}>
                  <span className="queue-number">{booking.status === 'in_service' ? '✂' : `#${booking.queuePosition}`}</span>
                  <div className="queue-customer"><strong>{booking.user?.name || 'Customer'}</strong><small>{booking.services.map((service) => service.name).join(' + ')} · {booking.priority}</small>{booking.user?.contactPhone && <a className="queue-phone" href={`tel:${booking.user.contactPhone}`}>☎ {booking.user.contactPhone}</a>}</div>
                  <button className="button button-soft button-small" onClick={() => setMessageBookingId((current) => current === booking.id ? '' : booking.id)}>Message</button>
                  {booking.status === 'waiting' && <>
                    <button className="button button-primary button-small" onClick={() => setQueueStatus(booking.id, 'in_service')}>Start</button>
                    <button className="button button-soft button-small reject-queue-button" onClick={() => { setRejectingBookingId((current) => current === booking.id ? '' : booking.id); setRejectionDetails(''); }}>Reject</button>
                  </>}
                  {booking.status === 'in_service' && <button className="button button-soft button-small" onClick={() => setQueueStatus(booking.id, 'completed')}>Complete</button>}
                  {booking.user?._id && <button className="button button-soft button-small" onClick={() => setCustomerBlocked(ownerSalonId, booking.user._id, !booking.customerBlocked)}>{booking.customerBlocked ? 'Unblock customer' : 'Block customer'}</button>}
                  {rejectingBookingId === booking.id && <form className="queue-rejection-form" onSubmit={(event) => {
                    event.preventDefault();
                    setQueueStatus(booking.id, 'rejected', { rejectionReasonCode, rejectionDetails });
                  }}>
                    <label>Reason for rejection<select value={rejectionReasonCode} onChange={(event) => setRejectionReasonCode(event.target.value)} required>
                      <option value="no_show">Customer did not arrive</option>
                      <option value="late_arrival">Customer arrived after their queue slot</option>
                      <option value="declined_service">Customer declined the service</option>
                      <option value="payment_issue">Customer could not complete payment</option>
                      <option value="other">Other</option>
                    </select></label>
                    <label>Additional details{rejectionReasonCode === 'other' ? ' (required)' : ' (optional)'}<textarea value={rejectionDetails} onChange={(event) => setRejectionDetails(event.target.value)} maxLength={500} rows={2} placeholder="Add a brief, factual explanation." required={rejectionReasonCode === 'other'} /></label>
                    <p className="fine-print">This removes the booking from the queue and emails the reason to the customer. Payment records are not changed.</p>
                    <div className="queue-rejection-actions"><button className="button button-primary button-small" type="submit" disabled={rejectionReasonCode === 'other' && !rejectionDetails.trim()}>Confirm rejection</button><button className="button button-soft button-small" type="button" onClick={() => setRejectingBookingId('')}>Keep in queue</button></div>
                  </form>}
                  {messageBookingId === booking.id && <MessageComposer recipient={booking.user?.name || 'customer'} onClose={() => setMessageBookingId('')} onSend={(message) => sendMessage(`/api/bookings/${booking.id}/message`, message)} />}
                </div>)}
                <LoadMoreButton shown={queueList.visibleItems.length} total={queue.length} onClick={queueList.loadMore} label="bookings" />
              </div>
            </div>
            <section className="panel-box owner-booking-history">
              <div className="panel-title-row"><div><h3>Booking history</h3>{ownerAccountUid && <span className="fine-print">Your UID: {ownerAccountUid}</span>}</div></div>
              {!ownerBookingHistory.length && <p className="muted">No booking history for this salon yet.</p>}
              {ownerHistoryList.visibleItems.map((booking) => <article className="owner-booking-history-row" key={booking._id}>
                <div><strong>{booking.userId?.name || 'Customer'} · {booking.services.map((service) => service.name).join(', ')}</strong><small>{booking.userId?.uid ? `Customer UID: ${booking.userId.uid} · ` : ''}{booking.appointmentDate ? `Appointment: ${formatAppointmentDate(booking.appointmentDate)} · ` : ''}Booked: {new Date(booking.createdAt).toLocaleString()}</small>{booking.status === 'rejected' && booking.rejectionReason && <small>Rejection reason: {booking.rejectionReason}</small>}{booking.rejectionFeedback && <small>Customer feedback: {booking.rejectionFeedback}</small>}{booking.status === 'rejected' && !booking.rejectionEmailSentAt && booking.userId?.email && <button className="button button-soft button-small" onClick={() => retryRejectionEmail(booking._id)}>Retry rejection email</button>}{booking.userId?._id && <button className="button button-soft button-small owner-history-block-button" onClick={() => setCustomerBlocked(ownerSalonId, booking.userId._id, !booking.customerBlocked)}>{booking.customerBlocked ? 'Unblock customer' : 'Block customer'}</button>}</div>
                <span className={`status-pill status-${booking.status}`}>{bookingStatusLabel(booking.status)}</span>
              </article>)}
              <LoadMoreButton shown={ownerHistoryList.visibleItems.length} total={ownerBookingHistory.length} onClick={ownerHistoryList.loadMore} label="bookings" />
            </section>
          </section>
        )}

        {user?.role === 'admin' && page === 'admin' && (
          <section className="dashboard-section" id="dashboard">
            <div className="admin-dashboard-heading">
              <BackArrowButton onClick={() => setPage('home')} className="section-back-navigation" />
              <strong className="owner-studio-title">Admin dashboard</strong>
              <span aria-hidden="true" />
            </div>
            <div className="report-controls admin-dashboard-controls"><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select><SearchableAdminSelect label="Salon" showLabel={false} value={reportSalon} placeholder="All salons" options={[{ value: '', label: 'All salons' }, ...reportSalons.map((salon) => ({ value: salon.id, label: `${salon.name || 'Salon'}${salon.ownerName ? ` · ${salon.ownerName}` : ''}${salon.ownerEmail ? ` · ${salon.ownerEmail}` : ''}${salon.ownerUid ? ` · ${salon.ownerUid}` : ''}` }))]} onChange={setReportSalon} /><SearchableAdminSelect label="Customer" showLabel={false} value={reportCustomer} placeholder="All customers" options={[{ value: '', label: 'All customers' }, ...adminCustomers.map((customer) => ({ value: customer.id, label: `${customer.name || 'Customer'}${customer.email ? ` · ${customer.email}` : ''}${customer.uid ? ` · ${customer.uid}` : ''}` }))]} onChange={setReportCustomer} /><select value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}><option value="">All services</option>{reportCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select><button className="button button-soft" onClick={clearReportFilters} disabled={!reportSalon && !reportCustomer && !serviceCategory}>Clear filters</button><button className="button button-soft" onClick={downloadReport}>↓ Export CSV</button></div>
            <ReportCards report={report} />
            <div className="panel-box report-breakdown"><h3>Service performance</h3>{report?.services?.length ? reportServiceList.visibleItems.map((service) => <div className="report-row" key={service.category}><span>{service.category}<small>{service.orders} services booked</small></span><strong>{money(service.revenue)}</strong></div>) : <p className="muted">No paid bookings in this period yet.</p>}<LoadMoreButton shown={reportServiceList.visibleItems.length} total={(report?.services || []).length} onClick={reportServiceList.loadMore} label="service categories" /></div>
            <div className="panel-box approvals"><div className="panel-title-row"><h3>Salon applications</h3><span className="result-count">{pendingSalons.length} pending</span></div>{!pendingSalons.length && <p className="muted">All caught up.</p>}{pendingSalonList.visibleItems.map((salon) => <div className="owner-salon-row" key={salon.id}><div><strong>{salon.name}</strong><small>{salon.address}, {salon.city} · {salon.ownerId?.name || 'Owner'}{salon.ownerId?.uid ? ` · UID: ${salon.ownerId.uid}` : ''}</small></div><div className="approval-actions"><button className="button button-primary button-small" onClick={() => setSalonApproval(salon.id, true)}>Approve</button><button className="button button-soft button-small" onClick={() => setSalonApproval(salon.id, false)}>Keep pending</button></div></div>)}<LoadMoreButton shown={pendingSalonList.visibleItems.length} total={pendingSalons.length} onClick={pendingSalonList.loadMore} label="salon applications" /></div>
            <AdminManagement
              customers={adminCustomers}
              salons={adminSalons}
              onConfirm={requestConfirmation}
              onChanged={() => {
                loadSalons();
                loadReport();
                api('/api/admin/management/customer-options')
                  .then((result) => setAdminCustomers(result.customers))
                  .catch((requestError) => setError(requestError.message));
                api('/api/admin/management/salon-options')
                  .then((result) => setAdminSalons(result.salons))
                  .catch((requestError) => setError(requestError.message));
              }}
            />
          </section>
        )}

        {reportPathForOwner && page === 'salon' && <section className="dashboard-section owner-report"><div className="section-heading"><div><span className="eyebrow">Your ledger</span><h2>Sales &amp; activity</h2></div><div className="report-controls"><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select><select value={reportSalon} onChange={(event) => setReportSalon(event.target.value)}><option value="">All my salons</option>{reportSalons.map((salon) => <option value={salon.id} key={salon.id}>{salon.name}</option>)}</select><select value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}><option value="">All services</option>{reportCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select><button className="button button-soft" onClick={clearReportFilters} disabled={!reportSalon && !serviceCategory}>Clear filters</button><button className="button button-soft" onClick={downloadReport}>↓ Export CSV</button></div></div><ReportCards report={report} /><div className="panel-box report-breakdown"><h3>Service performance</h3>{reportServiceList.visibleItems.map((service) => <div className="report-row" key={service.category}><span>{service.category}<small>{service.orders} services booked</small></span><strong>{money(service.revenue)}</strong></div>)}<LoadMoreButton shown={reportServiceList.visibleItems.length} total={(report?.services || []).length} onClick={reportServiceList.loadMore} label="service categories" /></div></section>}
          </>
        )}
      </main>

      <footer className="footer">
        <div className="footer-brand-group">
          <a className="brand" href="#home" onClick={() => setPage('home')}><span className="brand-mark">S</span>SalonFlow</a>
          <p>A little more time for the things you love.</p>
        </div>
        <button className="footer-contact" type="button" onClick={openAdminContact}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m5 7 7 5.5L19 7" /></svg>
          <span>Contact admin</span>
        </button>
        <span className="footer-copyright">© {new Date().getFullYear()} SalonFlow</span>
      </footer>
      {toast && <div className="toast" role="status">{toast}</div>}
      <ConfirmationDialog confirmation={confirmation} onResolve={resolveConfirmation} />
      {salonQr && <SalonQrDialog salon={salonQr} onClose={() => setSalonQr(null)} />}
      {contactAdminOpen && user && <ContactAdminDialog user={user} onClose={() => setContactAdminOpen(false)} onSent={(message) => {
        setContactAdminOpen(false);
        notify(message);
      }} />}
      {busy && !upiPayment && <div className="payment-preparing-backdrop" role="status" aria-live="polite">
        <div className="payment-preparing-card">
          <span className="payment-loader-spinner" aria-hidden="true" />
          <strong>Preparing your payment</strong>
          <span>Creating your UPI payment QR code…</span>
        </div>
      </div>}
      {nonRefundableNoticeOpen && <div className="dialog-backdrop booking-payment-notice-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setNonRefundableNoticeOpen(false);
      }}>
        <section className="auth-dialog booking-payment-notice" role="alertdialog" aria-modal="true" aria-labelledby="non-refundable-title" aria-describedby="non-refundable-description">
          <h2 id="non-refundable-title">Before you pay</h2>
          <p id="non-refundable-description">The {money(advanceAmount)} booking advance is non-refundable.</p>
          <div className="booking-payment-notice-actions">
            <button className="button button-soft" type="button" onClick={() => setNonRefundableNoticeOpen(false)}>Go back</button>
            <button className="button button-primary" type="button" onClick={() => {
              setNonRefundableNoticeOpen(false);
              bookNow();
            }}>Continue to payment</button>
          </div>
        </section>
      </div>}
      {upiPayment && <UpiPaymentDialog booking={upiPayment.booking} payment={upiPayment.payment} onClose={() => setUpiPayment(null)} onSubmitReference={submitUpiReference} />}
      {authOpen && <AuthDialog onClose={closeAuth} onSignedIn={handleSignedIn} notify={notify} />}
      {bootLoaderVisible && <div className="global-loader" role="status" aria-label="Loading SalonFlow" />}
    </div>
  );
}

function ReportCards({ report }) {
  return (
    <div className="stats-grid">
      <div className="stat-card stat-highlight"><span>Service value</span><strong>{money(report?.totalRevenue)}</strong><small>Paid bookings in selected period</small></div>
      <div className="stat-card"><span>Online collected</span><strong>{money(report?.onlineCollected)}</strong><small>Verified online payments and advances</small></div>
      <div className="stat-card"><span>Paid bookings</span><strong>{Number(report?.paidOrders || 0).toLocaleString('en-IN')}</strong><small>{report?.from ? `${new Date(report.from).toLocaleDateString()} — ${new Date(report.to).toLocaleDateString()}` : 'Selected period'}</small></div>
      <div className="stat-card"><span>Salons with sales</span><strong>{Number(report?.salons?.length || 0).toLocaleString('en-IN')}</strong><small>Based on successful payments</small></div>
    </div>
  );
}

export default App;
