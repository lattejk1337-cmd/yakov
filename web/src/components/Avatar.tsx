import { useState } from 'react';
import { initials } from '../lib/format';

/** Telegram profile photo with a gradient-initials fallback (no photo, privacy settings, load error). */
export function Avatar({ name, photoUrl, size = 40, ring = false }: { name: string; photoUrl?: string | null; size?: number; ring?: boolean }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;
  return (
    <div
      className={`avatar${ring ? ' avatar--ring' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-label={name}
      role="img"
    >
      {showPhoto ? (
        <img src={photoUrl!} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
