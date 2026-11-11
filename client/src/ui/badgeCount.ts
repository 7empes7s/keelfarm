// A count badge's text (#514): past 99 it says 99+, so a long unread chat keeps the badge on its icon.

export const badgeCount = (n: number): string => (n > 99 ? '99+' : String(n));
