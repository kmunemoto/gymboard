export interface EmoteCatalogItem {
  item_key: string;
  name: string;
  price: number;
  src: string;
}

export const getEmoteVideoSrc = (itemKey?: string | null): string | null => {
  // Temporarily disabled: legacy 3D emote videos are incompatible with the new
  // pixel-art avatar system. Always return null until pixel-art emotes ship.
  void itemKey;
  return null;
};