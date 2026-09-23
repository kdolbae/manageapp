import {
  Gauge, Inbox, FileText, FilePlus, CalendarCheck, Wrench, Wallet, Users, Package, Warehouse,
  Image, ChartBar, Landmark, Building, Settings, Menu, MapPin, Shield, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  inbox: Inbox,
  "file-text": FileText,
  "file-plus": FilePlus,
  "calendar-check": CalendarCheck,
  wrench: Wrench,
  wallet: Wallet,
  users: Users,
  package: Package,
  warehouse: Warehouse,
  image: Image,
  "bar-chart": ChartBar,
  landmark: Landmark,
  building: Building,
  settings: Settings,
  menu: Menu,
  "map-pin": MapPin,
  shield: Shield,
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const C = ICONS[name] ?? Gauge;
  return <C size={size} className={className} aria-hidden strokeWidth={1.75} />;
}
