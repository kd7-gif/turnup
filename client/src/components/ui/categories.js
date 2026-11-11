import {
  IconBriefcase, IconConfetti, IconDeviceGamepad2, IconGlass, IconMoodSmileBeam, IconMusic, IconPalette, IconRun, IconSparkles,
} from '@tabler/icons-react';

// Each category gets an icon and a soft colour pair from the Sunset pop palette
const MAP = {
  Music: { icon: IconMusic, bg: '#ffe1d1', fg: '#d63f06' },
  Parties: { icon: IconConfetti, bg: '#e4e8ff', fg: '#1a2fd1' },
  'Food and drink': { icon: IconGlass, bg: '#fff1bf', fg: '#7a5200' },
  Comedy: { icon: IconMoodSmileBeam, bg: '#ffdcec', fg: '#b0175f' },
  'Art and culture': { icon: IconPalette, bg: '#e2f4e9', fg: '#0f6b3d' },
  'Tech and business': { icon: IconBriefcase, bg: '#e6eef7', fg: '#244b78' },
  Fitness: { icon: IconRun, bg: '#ddf3f1', fg: '#0d6a62' },
  'Games and hangouts': { icon: IconDeviceGamepad2, bg: '#efe3ff', fg: '#6a2bc2' },
};
export const ORDER = Object.keys(MAP);
export const categoryOf = (name) => MAP[name] || { icon: IconSparkles, bg: '#ffefdd', fg: '#6b5a44' };
