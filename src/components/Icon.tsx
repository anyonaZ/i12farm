import { createElement } from 'react';
import {
  Add01Icon,
  AppleIcon,
  ArrowLeft01Icon,
  BookOpen01Icon,
  CallIcon,
  Camera01Icon,
  Cancel01Icon,
  ChartHistogramIcon,
  ChartIncreaseIcon,
  CheckmarkBadge01Icon,
  ClipboardIcon,
  CompassIcon,
  EggsIcon,
  FishIcon,
  GlobeIcon,
  HeartIcon,
  Honey01Icon,
  InboxIcon,
  LeafyGreenIcon,
  Location01Icon,
  LockKeyIcon,
  Megaphone01Icon,
  Message01Icon,
  MilkIcon,
  MinusSignIcon,
  PackageIcon,
  PawPrintIcon,
  Plant01Icon,
  Route01Icon,
  Search01Icon,
  SentIcon,
  Share01Icon,
  Shield01Icon,
  ShoppingBag01Icon,
  StarIcon,
  StethoscopeIcon,
  Tick02Icon,
  UserIcon,
  Wallet01Icon,
  WheatIcon,
} from '@hugeicons/core-free-icons';

// Icons: Hugeicons Stroke Rounded (free set, MIT licence), chosen with the
// Emerald Fresh look on 12 Nov 2026. Each icon is a list of SVG shapes on a
// 24×24 grid; only the icons named here end up in the app bundle.
type Shape = readonly [string, Readonly<Record<string, string | number>>];
export const ICONS = {
  drop: MilkIcon,
  egg: EggsIcon,
  paw: PawPrintIcon,
  fish: FishIcon,
  hex: Honey01Icon,
  leaf: LeafyGreenIcon,
  fruit: AppleIcon,
  grain: WheatIcon,
  sprout: Plant01Icon,
  sack: PackageIcon,
  cross: StethoscopeIcon,
  book: BookOpen01Icon,
  compass: CompassIcon,
  inbox: InboxIcon,
  search: Search01Icon,
  back: ArrowLeft01Icon,
  heart: HeartIcon,
  share: Share01Icon,
  phone: CallIcon,
  chat: Message01Icon,
  pin: Location01Icon,
  plus: Add01Icon,
  check: Tick02Icon,
  close: Cancel01Icon,
  camera: Camera01Icon,
  route: Route01Icon,
  user: UserIcon,
  badge: CheckmarkBadge01Icon,
  clipboard: ClipboardIcon,
  chart: ChartHistogramIcon,
  trend: ChartIncreaseIcon,
  star: StarIcon,
  bag: ShoppingBag01Icon,
  wallet: Wallet01Icon,
  send: SentIcon,
  minus: MinusSignIcon,
  lock: LockKeyIcon,
  megaphone: Megaphone01Icon,
  shield: Shield01Icon,
  globe: GlobeIcon,
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

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

/** The icon's shapes, for drawing inside another SVG (farm covers). */
export function IconShapes({ name }: { name: IconName }) {
  return (
    <>
      {(ICONS[name] as readonly Shape[]).map(([tag, attrs], i) => {
        const { key: _key, ...props } = attrs as Record<string, string | number>;
        return createElement(tag, { ...props, key: i });
      })}
    </>
  );
}

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-icon={name}
      className={className}
    >
      <IconShapes name={name} />
    </svg>
  );
}
