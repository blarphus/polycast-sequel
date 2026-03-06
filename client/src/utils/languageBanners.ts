// ---------------------------------------------------------------------------
// utils/languageBanners.ts -- Shared language banner images & fallback colors
// ---------------------------------------------------------------------------

// Banner images by language (Wikimedia Commons)
export const LANGUAGE_BANNERS: Record<string, string> = {
  en: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg/960px-London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg',
  es: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amanecer_en_Barcelona_2012.JPG/960px-Amanecer_en_Barcelona_2012.JPG',
  pt: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg/960px-Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg',
  fr: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg/960px-Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg',
  ja: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG/960px-Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG',
  de: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg/960px-Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg',
};

// Fallback colors when no language banner is available
export const BANNER_COLORS = [
  '#1e88e5', '#0d9488', '#7c3aed', '#c2410c', '#0891b2',
  '#4f46e5', '#b45309', '#0f766e', '#6d28d9', '#1d4ed8',
];

export function bannerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return BANNER_COLORS[Math.abs(hash) % BANNER_COLORS.length];
}
