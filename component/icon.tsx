export type IconName =
  | "activity"
  | "arrow-down"
  | "arrow-up"
  | "bell"
  | "cell"
  | "chevron-down"
  | "close"
  | "compass"
  | "download"
  | "expand"
  | "filter"
  | "globe"
  | "layers"
  | "locate"
  | "map"
  | "menu"
  | "plus"
  | "search"
  | "settings"
  | "signal"
  | "sliders"
  | "spark"
  | "tower"
  | "users"
  | "zoom-in"
  | "zoom-out";

const iconPaths: Record<IconName, string[]> = {
  activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  "arrow-down": ["M12 5v14", "m19 12-7 7-7-7"],
  "arrow-up": ["M12 19V5", "m5 12 7-7 7 7"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  cell: ["M7 3h10v18H7z", "M10 7h4", "M10 17h4"],
  "chevron-down": ["m6 9 6 6 6-6"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  compass: ["m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  expand: ["M8 3H5a2 2 0 0 0-2 2v3", "M16 3h3a2 2 0 0 1 2 2v3", "M8 21H5a2 2 0 0 1-2-2v-3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  filter: ["M4 4h16l-6.5 7.5V19l-3 1v-8.5L4 4Z"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"],
  layers: ["m12 2 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  locate: ["M12 22s8-4 8-12a8 8 0 0 0-16 0c0 8 8 12 8 12Z", "M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  map: ["m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z", "M9 3v15", "M15 6v15"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["m21 21-4.3-4.3", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.8.2l-.2.1h-3.2l-.1-.2a1.7 1.7 0 0 0-1.5-.9h-.3a1.7 1.7 0 0 0-1.5.9l-.1.2H6.1l-.2-.1a1.7 1.7 0 0 0-1.8-.2l-.2.1-1.6-2.8.1-.1a1.7 1.7 0 0 0 .3-1.9l-.1-.2v-3.2l.2-.1a1.7 1.7 0 0 0 .9-1.5v-.3a1.7 1.7 0 0 0-.9-1.5l-.2-.1 1.6-2.8.2.1a1.7 1.7 0 0 0 1.8-.2l.2-.1h3.2l.1.2a1.7 1.7 0 0 0 1.5.9h.3a1.7 1.7 0 0 0 1.5-.9l.1-.2h3.2l.2.1a1.7 1.7 0 0 0 1.8.2l.2-.1 1.6 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.2v3.2l-.2.1a1.7 1.7 0 0 0-.9 1.5v.3a1.7 1.7 0 0 0 .9 1.5l.2.1Z"],
  signal: ["M2 20h.01", "M7 20v-4", "M12 20V9", "M17 20V4", "M22 20v-8"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M2 14h4", "M10 8h4", "M18 16h4"],
  spark: ["m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z", "m19 14 1 2.5 2 1-2 1-1 2.5-1-2.5-2-1 2-1 1-2.5Z"],
  tower: ["M12 22V8", "m8 22 4-14 4 14", "M8 11H5a7 7 0 0 1 14 0h-3", "M6 7H3a10 10 0 0 1 18 0h-3", "M10 22h4"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M20 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  "zoom-in": ["M11 11h6", "M14 8v6", "M21 21l-4.3-4.3", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  "zoom-out": ["M11 11h6", "M21 21l-4.3-4.3", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
};

export default function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}
