/** Build a DiceBear Toon Head avatar URL. Falls back to name-based initials style if no seed chosen. */
export function getAvatarUrl(name: string, avatarSeed?: string | null, size = 96): string {
  if (avatarSeed) {
    return `https://api.dicebear.com/9.x/toon-head/svg?seed=${encodeURIComponent(avatarSeed)}&size=${size}&backgroundColor=eef2ff,e0f2fe,ecfdf5,fef3c7,fce7f3,f3e8ff`;
  }
  // Default: initials style based on name
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name || "?")}&size=${size}&backgroundColor=0ea5e9,8b5cf6,f59e0b,10b981,ef4444,6366f1&backgroundType=gradientLinear&fontWeight=600`;
}
