// Icon paths on a 24×24 grid, stroke-drawn. Shared by pins, chips and cards.
export const ICON_PATHS = {
  drop: 'M12 3c3 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.5 6-11z',
  egg: 'M12 3c3.5 0 6 5.2 6 10a6 6 0 0 1-12 0c0-4.8 2.5-10 6-10z',
  paw: 'M12 12.5c-3 0-5.5 3-5.5 5.2 0 1.7 1.6 2.3 3 2.3h5c1.4 0 3-.6 3-2.3 0-2.2-2.5-5.2-5.5-5.2zM6 7.5a2 2.4 0 1 0 0 .01zM18 7.5a2 2.4 0 1 0 0 .01zM9.5 4a2 2.4 0 1 0 0 .01zM14.5 4a2 2.4 0 1 0 0 .01z',
  fish: 'M3 12c3-4 7-5.5 11-5.5 3 0 5.5 2.5 7 5.5-1.5 3-4 5.5-7 5.5-4 0-8-1.5-11-5.5zM3 12L1.5 8.5M3 12l-1.5 3.5M16 11v.01',
  hex: 'M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3zM12 8l3.5 2v4L12 16l-3.5-2v-4z',
  leaf: 'M5 19C5 11 11 5 19 5c0 8-6 14-14 14zM5 19l8-8',
  fruit: 'M12 8.5c-4 0-6.5 2.6-6.5 6S8 21 12 21s6.5-3 6.5-6.5-2.5-6-6.5-6zM12 8.5C12 6 13.5 4 16 3.5',
  grain:
    'M12 21V8M12 8c-1.8-.8-3-2.6-3-5 1.8.4 3 1.6 3 3.6 0-2 1.2-3.2 3-3.6 0 2.4-1.2 4.2-3 5zM12 13c-2-.4-3.8-1.8-4.2-4 2 .2 3.6 1.4 4.2 3M12 13c2-.4 3.8-1.8 4.2-4-2 .2-3.6 1.4-4.2 3M12 18c-2-.4-3.8-1.8-4.2-4 2 .2 3.6 1.4 4.2 3M12 18c2-.4 3.8-1.8 4.2-4-2 .2-3.6 1.4-4.2 3',
  sprout: 'M12 21v-9M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 14c0-3.4-2.5-5.5-6-5.5 0 3.4 2.6 5.5 6 5.5z',
  sack: 'M9 3.5h6L13.5 7c3 1.4 5 4.6 5 8 0 3.4-2.6 5.5-6 5.5h-1c-3.4 0-6-2.1-6-5.5 0-3.4 2-6.6 5-8z',
  cross: 'M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z',
  book: 'M3.5 5.5h6a2.5 2.5 0 0 1 2.5 2.5v12a2 2 0 0 0-2-2H3.5zM20.5 5.5h-6A2.5 2.5 0 0 0 12 8v12a2 2 0 0 1 2-2h6.5z',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  inbox: 'M4 5h16v14H4zM4 13h5l1.5 2.5h3L15 13h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  back: 'M15 5l-7 7 7 7',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  share: 'M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v6.5h14V13',
  phone: 'M6.5 3.5h3l1.5 4-2 1.5c1 2.2 2.8 4 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2C10.5 18 6 13.5 4.5 5.7a2 2 0 0 1 2-2.2z',
  chat: 'M4.5 19.5l1.2-3.6A8 8 0 1 1 8.4 18.6z',
  pin: 'M12 21s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21zM12 7.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  route: 'M6 19a2 2 0 1 0 0-.01zM18 7a2 2 0 1 0 0-.01zM6 17V9.5A3.5 3.5 0 0 1 9.5 6H13M18 9v5.5a3.5 3.5 0 0 1-3.5 3.5H11',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6',
  badge:
    'M12 3l2.4 1.8 3 .1.9 2.9 2.2 2-1 2.9.4 3-2.6 1.5-1.3 2.7-3-.4L12 21l-2.4-1.5-3 .4-1.3-2.7L2.7 15.7l.4-3-1-2.9 2.2-2 .9-2.9 3-.1zM8.5 12l2.5 2.5 4.5-5',
  clipboard: 'M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  trend: 'M3.5 17l5.5-5.5 4 4 7.5-8M15 7.5h5.5V13',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
  bag: 'M5 8h14l-1.2 12.5H6.2zM9 8V6.5a3 3 0 0 1 6 0V8',
  wallet: 'M4 7.5h15.5v12H4zM4 7.5l11-3.5v3.5M15.5 13.5h.01',
  send: 'M4 12l16-7.5-6 15.5-2.5-6.5z',
  minus: 'M5 12h14',
  lock: 'M6.5 11h11v9.5h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  megaphone: 'M4 10v4h3l8 4.5v-13L7 10zM18 9.5a3.5 3.5 0 0 1 0 5M7 14l1.5 5h2.5l-1-5',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const CATEGORY_ICON: Record<string, IconName> = {
  dairy: 'drop',
  poultry: 'egg',
  goats: 'paw',
  sheep: 'paw',
  pigs: 'paw',
  beef: 'paw',
  rabbits: 'paw',
  fish: 'fish',
  bees: 'hex',
  vegetables: 'leaf',
  fruits: 'fruit',
  grains: 'grain',
  seedlings: 'sprout',
  inputs: 'sack',
  'vet-services': 'cross',
  training: 'book',
};

export const CATEGORY_HUE: Record<string, number> = {
  dairy: 200,
  poultry: 38,
  goats: 26,
  sheep: 30,
  pigs: 345,
  beef: 15,
  rabbits: 300,
  fish: 192,
  bees: 45,
  vegetables: 140,
  fruits: 90,
  grains: 48,
  seedlings: 128,
  inputs: 30,
  'vet-services': 160,
  training: 260,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
      className={className}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
