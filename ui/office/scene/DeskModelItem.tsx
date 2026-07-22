import { BOOK_VARIANTS } from "./deskSpriteData.ts";
import { styleForModel } from "../../model-styles.ts";

export function DeskModelItem({ modelFamily, deskIndex }: { modelFamily?: string; deskIndex: number }) {
  const deskProp = styleForModel(modelFamily).deskProp;
  if (deskProp === "crayons") return <HaikuDeskItem />;
  if (deskProp === "book") return modelFamily === "fable" ? <FableDeskItem /> : <OpusDeskItem deskIndex={deskIndex} />;
  return null;
}

function HaikuDeskItem() {
  return (
    <g transform="translate(100, 68)">
      <rect x="0" y="0" width="14" height="3" rx="1" fill="#E85D75" transform="rotate(-15 7 1.5)" />
      <rect x="4" y="5" width="14" height="3" rx="1" fill="#4A9AE8" transform="rotate(10 11 6.5)" />
      <rect x="-2" y="9" width="12" height="3" rx="1" fill="#F5C040" transform="rotate(-5 4 10.5)" />
      <path d="M13.5 -0.8 L16 0.8 L13.5 2.3" fill="#C44050" transform="rotate(-15 7 1.5)" />
      <path d="M17.5 4.5 L20 6 L17.5 7.5" fill="#3A80C8" transform="rotate(10 11 6.5)" />
      <path d="M9.5 8.5 L12 10 L9.5 11.5" fill="#D8A030" transform="rotate(-5 4 10.5)" />
    </g>
  );
}

function OpusDeskItem({ deskIndex }: { deskIndex: number }) {
  const [bookFront, bookBack, bookSpine] = BOOK_VARIANTS[deskIndex % BOOK_VARIANTS.length];
  const isGreen = deskIndex % BOOK_VARIANTS.length === 0;
  return (
    <g transform="translate(102.5, 69.5) scale(0.8)">
      <path d="M-4 8 L15 -1.5 L29 5.5 L10 15 Z" fill={bookBack} />
      <path d="M-4 8 L10 15 L10 16 L-4 9 Z" fill={bookSpine} />
      <path d="M-2 4 L10 10 L10 14 L-2 8 Z" fill="#F0EDE4" />
      <path d="M10 16 L29 6.5 L29 -0.5 L10 9 Z" fill={bookSpine} />
      <path d="M-4 2 L15 -7.5 L29 -0.5 L10 9 Z" fill={bookFront} />
      <path d="M-4 2 L10 9 L10 10 L-4 3 Z" fill={bookBack} />
      <line x1="0.95" y1="1.63" x2="10.75" y2="6.53" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.82" y1="0.84" x2="11.12" y2="3.99" stroke="#1a1a1a" strokeWidth="0.9" strokeLinecap="round" />
      {isGreen && <BookClock />}
    </g>
  );
}

function BookClock() {
  return (
    <g transform="matrix(4.02,-2.01,4.02,2.01,15.35,-0.68)">
      <circle cx="0" cy="0" r="1" fill="#C0C0C0" stroke="#888" strokeWidth="0.1" />
      <circle cx="0" cy="0" r="0.88" fill="#D8D8D8" stroke="#A0A0A0" strokeWidth="0.04" />
      <line x1="0" y1="-0.78" x2="0" y2="-0.6" stroke="#444" strokeWidth="0.07" />
      <line x1="0.78" y1="0" x2="0.6" y2="0" stroke="#444" strokeWidth="0.07" />
      <line x1="0" y1="0.78" x2="0" y2="0.6" stroke="#444" strokeWidth="0.07" />
      <line x1="-0.78" y1="0" x2="-0.6" y2="0" stroke="#444" strokeWidth="0.07" />
      <line x1="0" y1="0" x2="-0.33" y2="-0.48" stroke="#333" strokeWidth="0.1" strokeLinecap="round" />
      <line x1="0" y1="0" x2="0.28" y2="-0.62" stroke="#333" strokeWidth="0.07" strokeLinecap="round" />
      <circle cx="0" cy="0" r="0.08" fill="#555" />
    </g>
  );
}

function FableDeskItem() {
  return (
    <g transform="translate(99, 72) scale(0.78)">
      <path d="M0 2 L24 -10 L29 -7.5 L5 4.5 Z" fill="rgba(0,0,0,0.12)" />
      <path d="M0 0 L24 -12 L29 -9.5 L5 2.5 Z" fill="#EAE0C6" />
      <path d="M0 0 L5 2.5 L5 4 L0 1.5 Z" fill="#D2C29C" />
      <path d="M5 2.5 L29 -9.5 L29 -8 L5 4 Z" fill="#DCCEA8" />
      <ellipse cx="1.2" cy="0.6" rx="1.3" ry="2.6" fill="#D2C29C" transform="rotate(-26.5 1.2 0.6)" />
      <ellipse cx="27" cy="-11.4" rx="1.3" ry="2.6" fill="#F2EAD4" transform="rotate(-26.5 27 -11.4)" />
      <line x1="7" y1="-1.4" x2="22" y2="-8.9" stroke="#9c7a4a" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="9" y1="-0.4" x2="21" y2="-6.4" stroke="#9c7a4a" strokeWidth="0.6" strokeLinecap="round" />
    </g>
  );
}
