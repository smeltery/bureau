"use client";

import type React from "react";

export function handleMarketingScroll(e: React.MouseEvent<HTMLAnchorElement>, targetId: string, afterScroll?: () => void) {
  e.preventDefault();
  document.querySelector(targetId)?.scrollIntoView({ behavior: "smooth" });
  afterScroll?.();
}
