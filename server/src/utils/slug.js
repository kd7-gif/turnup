/** "Sunset Rooftop Sessions!" -> "sunset-rooftop-sessions" (accents removed, so Café becomes cafe). */
export const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
